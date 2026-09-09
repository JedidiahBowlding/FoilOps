import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LiquidityAutoBuyService } from '../src/lib/liquidity-auto-buy/service'
import { RiskGuard } from '../src/lib/liquidity-auto-buy/base-runtime'
import type { AutoBuyAudit, AutoBuyOrder, AutoBuyRuntime, AutoBuyStore, PoolObservation, SwapQuote } from '../src/lib/liquidity-auto-buy/types'

const now=()=>new Date()
const baseOrder=(overrides:Partial<AutoBuyOrder>={}):AutoBuyOrder=>({id:'order-1',chainId:8453,tokenAddress:'0x1111111111111111111111111111111111111111',sellToken:'ETH',spendAmount:'0.01',maxSlippageBps:100,maxPriceImpactBps:300,maxGasCostWei:'3000000000000000',minPoolLiquidityUsd:10000,transactionDeadlineSecs:3600,retryLimit:2,permittedRouters:['ZEROX_ALLOWANCE_HOLDER'],autoBuyEnabled:true,state:'ARMED',idempotencyKey:'key-1',armedAt:now(),expiresAt:new Date(Date.now()+3600000),monitorAttempts:0,executionAttempts:0,lastReason:null,poolAddress:null,poolRouter:null,currentLiquidityUsd:null,expectedOutput:null,estimatedPriceImpactBps:null,transactionHash:null,createdAt:now(),updatedAt:now(),...overrides})
const observation=(overrides:Partial<PoolObservation>={}):PoolObservation=>({tokenAddress:'0x1111111111111111111111111111111111111111',poolAddress:'0x2222222222222222222222222222222222222222',dex:'uniswap-v3',liquidityUsd:50000,tokenPriceUsd:0.01,observedAt:new Date().toISOString(),...overrides})
const quote=(overrides:Partial<SwapQuote>={}):SwapQuote=>({router:'ZEROX_ALLOWANCE_HOLDER',sellAmount:BigInt(10),buyAmount:BigInt(1000),minBuyAmount:BigInt(900),gasLimit:BigInt(100000),gasPrice:BigInt(1000000000),gasCostWei:BigInt(100000000000000),priceImpactBps:100,transaction:{to:'0x0000000000001ff3684f28c67538d4d072c22734',data:'0x1234',value:BigInt(10),gasLimit:BigInt(100000),gasPrice:BigInt(1000000000)},...overrides})

class MemoryStore implements AutoBuyStore{
  orders=new Map<string,AutoBuyOrder>();claims=0;control=true
  constructor(order?:AutoBuyOrder){if(order)this.orders.set(order.id,order)}
  async create(input:any){const order=baseOrder({...input,id:`order-${this.orders.size+1}`,createdAt:now(),updatedAt:now()});this.orders.set(order.id,order);return order}
  async get(id:string){return this.orders.get(id)||null}async list(){return [...this.orders.values()]}
  async update(id:string,data:Partial<AutoBuyOrder>){const order={...this.orders.get(id)!,...data,updatedAt:now()};this.orders.set(id,order);return order}
  async claimExecution(id:string){const order=this.orders.get(id)!;if(order.state!=='VALIDATING'||order.transactionHash)return false;this.claims++;await this.update(id,{state:'EXECUTING',executionAttempts:order.executionAttempts+1});return true}
  async recoverInterrupted(){for(const o of this.orders.values()){if(['MONITORING','LIQUIDITY_DETECTED','VALIDATING'].includes(o.state))await this.update(o.id,{state:'ARMED'});else if(o.state==='EXECUTING'&&!o.transactionHash)await this.update(o.id,{state:'FAILED'})}}
  async getControl(){return{enabled:this.control}}async setControl(enabled:boolean){this.control=enabled;return{enabled}}
}
class MemoryAudit implements AutoBuyAudit{events:any[]=[];async record(orderId:string,eventType:string,message:string,metadata?:Record<string,unknown>){this.events.push({orderId,eventType,message,metadata})}async list(orderId:string){return this.events.filter(x=>x.orderId===orderId)}}
class FakeRuntime implements AutoBuyRuntime{
  obs:PoolObservation|null=observation();q=quote();verifyError?:Error;poolError?:Error;quoteError?:Error;simulateError?:Error;executeError?:Error;executions=0;receiptValue:{status:number|null}|null=null
  async verifyContract(){if(this.verifyError)throw this.verifyError}async observe(){return this.obs}async validatePool(){if(this.poolError)throw this.poolError}async quote(){if(this.quoteError)throw this.quoteError;return this.q}guard(order:AutoBuyOrder,obs:PoolObservation,q:SwapQuote){new RiskGuard().enforce(order,obs,q)}async simulate(){if(this.simulateError)throw this.simulateError}
  async execute(_o:AutoBuyOrder,_q:SwapQuote,onBroadcast?:(h:string)=>Promise<void>){this.executions++;if(onBroadcast)await onBroadcast('0xabc');if(this.executeError)throw this.executeError;return{hash:'0xabc',status:1}}
  async receipt(){return this.receiptValue}
}
const service=(order=baseOrder())=>{const store=new MemoryStore(order),audit=new MemoryAudit(),runtime=new FakeRuntime();return{store,audit,runtime,svc:new LiquidityAutoBuyService(store,audit,runtime)}}

beforeEach(()=>{process.env.BASE_AUTO_BUY_ENABLED='true';process.env.BASE_AUTO_BUY_HARD_KILL_SWITCH='false';process.env.BASE_AUTO_BUY_MAX_ETH='0.12';process.env.BASE_AUTO_BUY_MIN_LIQUIDITY_USD='10000'})

describe('LiquidityAutoBuyService safety matrix',()=>{
  it('keeps an order armed when no liquidity exists',async()=>{const x=service();x.runtime.obs=null;await x.svc.poll();expect((await x.store.get('order-1'))?.state).toBe('ARMED');expect(x.runtime.executions).toBe(0)})
  it('rejects a fake pool token even when the symbol could match',async()=>{const x=service();x.runtime.obs=observation({tokenAddress:'0x3333333333333333333333333333333333333333'});await x.svc.poll();expect((await x.store.get('order-1'))?.lastReason).toMatch(/Exact token-address|exactly match/i);expect(x.runtime.executions).toBe(0)})
  it('rejects the wrong chain',()=>expect(()=>new RiskGuard().enforce(baseOrder({chainId:1}),observation(),quote())).toThrow(/not Base/))
  it('keeps negligible-liquidity pools armed',async()=>{const x=service();x.runtime.poolError=new Error('Pool liquidity $5 is below configured minimum');await x.svc.poll();expect((await x.store.get('order-1'))?.state).toBe('ARMED')})
  it('executes once for valid usable liquidity',async()=>{const x=service();await x.svc.poll();expect((await x.store.get('order-1'))?.state).toBe('CONFIRMED');expect(x.runtime.executions).toBe(1)})
  it('blocks excessive price impact',async()=>{const x=service();x.runtime.q=quote({priceImpactBps:301});await x.svc.poll();expect((await x.store.get('order-1'))?.lastReason).toMatch(/Price impact/);expect(x.runtime.executions).toBe(0)})
  it('rejects excessive configured slippage',async()=>{const x=service(baseOrder({state:'DRAFT'}));await expect(x.svc.create({tokenAddress:baseOrder().tokenAddress,sellToken:'ETH',spendAmount:'0.01',maxSlippageBps:301,maxPriceImpactBps:300,maxGasCostEth:'0.003',minPoolLiquidityUsd:10000,transactionDeadlineSecs:3600,retryLimit:2,permittedRouters:['ZEROX_ALLOWANCE_HOLDER'],autoBuyEnabled:true})).rejects.toThrow(/slippage/)})
  it('blocks gas above the configured limit',async()=>{const x=service();x.runtime.q=quote({gasCostWei:BigInt('3000000000000001')});await x.svc.poll();expect((await x.store.get('order-1'))?.lastReason).toMatch(/gas cost/);expect(x.runtime.executions).toBe(0)})
  it('blocks a reverted simulation',async()=>{const x=service();x.runtime.simulateError=new Error('execution reverted');await x.svc.poll();expect((await x.store.get('order-1'))?.state).toBe('ARMED');expect(x.runtime.executions).toBe(0)})
  it('fails closed on RPC failure',async()=>{const x=service();x.runtime.quoteError=new Error('RPC unavailable');await x.svc.poll();expect((await x.store.get('order-1'))?.lastReason).toMatch(/RPC unavailable/);expect(x.runtime.executions).toBe(0)})
  it('holds a broadcast but dropped transaction for reconciliation',async()=>{const x=service();x.runtime.executeError=new Error('receipt timeout');await x.svc.poll();const o=await x.store.get('order-1');expect(o?.state).toBe('EXECUTING');expect(o?.transactionHash).toBe('0xabc')})
  it('does not duplicate a confirmed trigger',async()=>{const x=service();await x.svc.poll();await x.svc.poll();expect(x.runtime.executions).toBe(1);expect(x.store.claims).toBe(1)})
  it('recovers monitoring state after application restart',async()=>{const x=service(baseOrder({state:'VALIDATING'}));x.runtime.obs=null;await x.svc.start();await vi.waitFor(async()=>expect((await x.store.get('order-1'))?.state).toBe('ARMED'));expect(x.runtime.executions).toBe(0)})
  it('honors emergency cancellation',async()=>{const x=service();await x.svc.cancel('order-1');await x.svc.poll();expect((await x.store.get('order-1'))?.state).toBe('CANCELLED');expect(x.runtime.executions).toBe(0)})
  it('honors the global hard kill switch',async()=>{process.env.BASE_AUTO_BUY_HARD_KILL_SWITCH='true';const x=service();await x.svc.poll();expect(x.runtime.executions).toBe(0);expect((await x.store.get('order-1'))?.state).toBe('ARMED')})
  it('persists the frontend master switch and stops execution when off',async()=>{const x=service();await x.svc.setMasterEnabled(false);expect(x.store.control).toBe(false);await x.svc.poll();expect(x.runtime.executions).toBe(0);expect((await x.svc.status()).masterEnabled).toBe(false)})
})
