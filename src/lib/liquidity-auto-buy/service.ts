import { randomUUID } from 'crypto'
import { isAddress, parseEther } from 'ethers'
import type { AutoBuyAudit, AutoBuyOrder, AutoBuyRuntime, AutoBuyStore, DraftInput } from './types'
import { BASE_CHAIN_ID, SUPPORTED_ROUTERS } from './types'

const activeStates = new Set(['ARMED','MONITORING','LIQUIDITY_DETECTED','VALIDATING'])

export class LiquidityAutoBuyService {
  private timer?: NodeJS.Timeout
  private polling=false
  constructor(private readonly store:AutoBuyStore,private readonly audit:AutoBuyAudit,private readonly runtime:AutoBuyRuntime){}

  status(){return {enabled:process.env.BASE_AUTO_BUY_ENABLED==='true',killSwitch:process.env.BASE_AUTO_BUY_KILL_SWITCH!=='false',chainId:BASE_CHAIN_ID,supportedRouters:[...SUPPORTED_ROUTERS],executionMode:'explicitly-armed-auto-buy',defaultDisabled:true}}
  async start(){await this.store.recoverInterrupted();await this.reconcile();const interval=Math.max(10_000,Number(process.env.BASE_AUTO_BUY_INTERVAL_MS||15_000));this.timer=setInterval(()=>void this.poll(),interval);this.timer.unref?.();void this.poll()}
  async list(){return this.store.list()}
  async get(id:string){const order=await this.store.get(id);if(!order)throw new Error('Auto-buy order not found');return order}
  async history(id:string){await this.get(id);return this.audit.list(id)}

  async create(input:DraftInput){
    const tokenAddress=String(input.tokenAddress||'').trim().toLowerCase()
    if(!isAddress(tokenAddress))throw new Error('A valid exact Base token contract is required')
    await this.runtime.verifyContract(tokenAddress)
    const sellToken=String(input.sellToken||'ETH').toUpperCase()
    if(!['ETH','USDC'].includes(sellToken))throw new Error('Spend token must be ETH or USDC')
    if(!/^\d+(\.\d+)?$/.test(String(input.spendAmount))||Number(input.spendAmount)<=0)throw new Error('Authorized spend must be positive')
    const configuredMax=sellToken==='ETH'?Number(process.env.BASE_AUTO_BUY_MAX_ETH||0.12):Number(process.env.BASE_AUTO_BUY_MAX_USDC||500)
    if(Number(input.spendAmount)>configuredMax)throw new Error(`Authorized spend exceeds server maximum of ${configuredMax} ${sellToken}`)
    const maxSlippageBps=this.integer(input.maxSlippageBps,1,Number(process.env.BASE_AUTO_BUY_MAX_SLIPPAGE_BPS||300),'slippage')
    const maxPriceImpactBps=this.integer(input.maxPriceImpactBps,1,Number(process.env.BASE_AUTO_BUY_MAX_PRICE_IMPACT_BPS||500),'price impact')
    const transactionDeadlineSecs=this.integer(input.transactionDeadlineSecs,60,604800,'transaction deadline')
    const retryLimit=this.integer(input.retryLimit,1,10,'retry limit')
    const minPoolLiquidityUsd=Number(input.minPoolLiquidityUsd)
    if(!Number.isFinite(minPoolLiquidityUsd)||minPoolLiquidityUsd<Number(process.env.BASE_AUTO_BUY_MIN_LIQUIDITY_USD||10_000))throw new Error('Minimum liquidity is below the server safety floor')
    const routers=(input.permittedRouters||[]).map(String)
    if(!routers.length||routers.some(x=>!SUPPORTED_ROUTERS.includes(x as any)))throw new Error('At least one supported router must be explicitly permitted')
    if(!/^\d+(\.\d+)?$/.test(String(input.maxGasCostEth))||Number(input.maxGasCostEth)<=0)throw new Error('Maximum gas cost must be positive')
    const serverMaxGasEth=Number(process.env.BASE_AUTO_BUY_MAX_GAS_ETH||0.01)
    if(Number(input.maxGasCostEth)>serverMaxGasEth)throw new Error(`Maximum gas exceeds the server safety ceiling of ${serverMaxGasEth} ETH`)
    const order=await this.store.create({chainId:BASE_CHAIN_ID,tokenAddress,sellToken,spendAmount:String(input.spendAmount),maxSlippageBps,maxPriceImpactBps,maxGasCostWei:parseEther(String(input.maxGasCostEth)).toString(),minPoolLiquidityUsd,transactionDeadlineSecs,retryLimit,permittedRouters:routers,autoBuyEnabled:input.autoBuyEnabled===true,state:'DRAFT',idempotencyKey:randomUUID()})
    await this.audit.record(order.id,'CONFIGURED','Draft created and exact Base contract verified',{tokenAddress,sellToken,spendAmount:order.spendAmount,limits:{maxSlippageBps,maxPriceImpactBps,maxGasCostWei:order.maxGasCostWei,minPoolLiquidityUsd,transactionDeadlineSecs,retryLimit},routers})
    return order
  }

  async arm(id:string){
    const order=await this.get(id)
    if(order.state!=='DRAFT')throw new Error('Only a DRAFT order can be armed')
    if(!order.autoBuyEnabled)throw new Error('AUTO BUY toggle must be explicitly enabled in the reviewed draft')
    if(process.env.BASE_AUTO_BUY_ENABLED!=='true')throw new Error('Server AUTO BUY feature flag is disabled')
    if(process.env.BASE_AUTO_BUY_KILL_SWITCH!=='false')throw new Error('Emergency kill switch is active')
    await this.runtime.verifyContract(order.tokenAddress)
    const now=new Date(),armed=await this.store.update(id,{state:'ARMED',armedAt:now,expiresAt:new Date(now.getTime()+order.transactionDeadlineSecs*1000),lastReason:'Armed; waiting for validated usable liquidity'})
    await this.audit.record(id,'ARMED','User explicitly armed AUTO BUY',{expiresAt:armed.expiresAt?.toISOString()})
    void this.poll();return armed
  }

  async cancel(id:string){const order=await this.get(id);if(['CONFIRMED','CANCELLED'].includes(order.state))throw new Error(`Order is already ${order.state}`);const cancelled=await this.store.update(id,{state:'CANCELLED',lastReason:'Emergency cancellation requested by user'});await this.audit.record(id,'CANCELLED','Emergency cancellation requested');return cancelled}

  async poll(){if(this.polling||process.env.BASE_AUTO_BUY_KILL_SWITCH!=='false')return;this.polling=true;try{for(const order of (await this.store.list()).filter(x=>activeStates.has(x.state)))await this.process(order)}finally{this.polling=false}}

  private async process(initial:AutoBuyOrder){
    let order=await this.get(initial.id)
    if(!activeStates.has(order.state)||order.transactionHash)return
    if(!order.expiresAt||order.expiresAt.getTime()<=Date.now()){await this.fail(order,'Order deadline expired');return}
    try{
      order=await this.store.update(order.id,{state:'MONITORING',monitorAttempts:order.monitorAttempts+1,lastReason:'Checking exact contract for usable liquidity'})
      const observation=await this.runtime.observe(order.tokenAddress)
      if(!observation){await this.hold(order,'No supported pool with actual liquidity observed');return}
      await this.store.update(order.id,{state:'LIQUIDITY_DETECTED',poolAddress:observation.poolAddress,poolRouter:observation.dex,currentLiquidityUsd:observation.liquidityUsd,lastReason:'Candidate liquidity detected; validating pool'})
      await this.audit.record(order.id,'LIQUIDITY_OBSERVED','Candidate Base pool observed',{poolAddress:observation.poolAddress,dex:observation.dex,liquidityUsd:observation.liquidityUsd})
      order=await this.get(order.id);await this.runtime.validatePool(observation,order)
      order=await this.store.update(order.id,{state:'VALIDATING',lastReason:'Pool valid; requesting exact constrained route'})
      const quote=await this.runtime.quote(order,observation);this.runtime.guard(order,observation,quote)
      await this.store.update(order.id,{expectedOutput:quote.buyAmount.toString(),estimatedPriceImpactBps:quote.priceImpactBps,lastReason:'Limits passed; exact swap simulation pending'})
      await this.audit.record(order.id,'VALIDATED','Pool, route, output, price impact, slippage and gas limits passed',{poolAddress:observation.poolAddress,router:quote.router,buyAmount:quote.buyAmount.toString(),minBuyAmount:quote.minBuyAmount.toString(),priceImpactBps:quote.priceImpactBps,gasCostWei:quote.gasCostWei.toString()})
      order=await this.get(order.id);await this.runtime.simulate(order,quote);await this.audit.record(order.id,'SIMULATED','Initial exact swap eth_call simulation succeeded',{minBuyAmount:quote.minBuyAmount.toString()})
      const freshObservation=await this.runtime.observe(order.tokenAddress)
      if(!freshObservation)throw new Error('Liquidity disappeared during final pre-broadcast check')
      await this.runtime.validatePool(freshObservation,order)
      const freshQuote=await this.runtime.quote(order,freshObservation);this.runtime.guard(order,freshObservation,freshQuote)
      await this.runtime.simulate(order,freshQuote)
      await this.audit.record(order.id,'FINAL_VALIDATION','Liquidity, impact, gas, amountOutMinimum and exact simulation rechecked immediately before execution',{poolAddress:freshObservation.poolAddress,liquidityUsd:freshObservation.liquidityUsd,priceImpactBps:freshQuote.priceImpactBps,minBuyAmount:freshQuote.minBuyAmount.toString()})
      if(!(await this.store.claimExecution(order.id)))return
      order=await this.get(order.id);await this.audit.record(order.id,'EXECUTING','Idempotent execution claim acquired')
      const result=await this.runtime.execute(order,freshQuote,async hash=>{await this.store.update(order.id,{transactionHash:hash});await this.audit.record(order.id,'BROADCAST','Transaction broadcast',{transactionHash:hash})})
      if(result.status!==1)throw new Error('Transaction receipt was not successful')
      await this.store.update(order.id,{state:'CONFIRMED',transactionHash:result.hash,lastReason:'Base transaction confirmed'})
      await this.audit.record(order.id,'CONFIRMED','Auto-buy transaction confirmed',{transactionHash:result.hash})
    }catch(error){
      const message=error instanceof Error?error.message:'Unknown validation failure';order=await this.get(initial.id)
      if(order.transactionHash){await this.store.update(order.id,{state:'EXECUTING',lastReason:`Broadcast transaction requires reconciliation: ${message}`});await this.audit.record(order.id,'RECONCILIATION_REQUIRED',message,{transactionHash:order.transactionHash});return}
      if(order.executionAttempts>=order.retryLimit){await this.fail(order,`Retry limit reached: ${message}`);return}
      await this.hold(order,message)
    }
  }

  private async hold(order:AutoBuyOrder,reason:string){if((await this.get(order.id)).state==='CANCELLED')return;await this.store.update(order.id,{state:'ARMED',lastReason:reason.slice(0,500)});await this.audit.record(order.id,'CONDITION_BLOCKED',reason)}
  private async fail(order:AutoBuyOrder,reason:string){await this.store.update(order.id,{state:'FAILED',lastReason:reason.slice(0,500)});await this.audit.record(order.id,'FAILED',reason)}
  private async reconcile(){for(const order of (await this.store.list()).filter(x=>x.state==='EXECUTING'&&x.transactionHash)){try{const receipt=await this.runtime.receipt(order.transactionHash!);if(receipt?.status===1){await this.store.update(order.id,{state:'CONFIRMED',lastReason:'Confirmed during startup reconciliation'});await this.audit.record(order.id,'CONFIRMED','Transaction confirmed during startup reconciliation',{transactionHash:order.transactionHash})}else if(receipt?.status===0)await this.fail(order,'Broadcast transaction reverted')}catch(error){await this.audit.record(order.id,'RECONCILIATION_PENDING',error instanceof Error?error.message:'RPC reconciliation failed')}}}
  private integer(value:number,min:number,max:number,label:string){const n=Math.floor(Number(value));if(!Number.isFinite(n)||n<min||n>max)throw new Error(`${label} must be between ${min} and ${max}`);return n}
}
