export const BASE_CHAIN_ID = 8453
export const BASE_NATIVE = '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee'
export const BASE_USDC = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913'
export const BASE_ALLOWANCE_HOLDER = '0x0000000000001ff3684f28c67538d4d072c22734'
export const SUPPORTED_ROUTERS = ['ZEROX_ALLOWANCE_HOLDER'] as const

export type AutoBuyState = 'DRAFT'|'ARMED'|'MONITORING'|'LIQUIDITY_DETECTED'|'VALIDATING'|'EXECUTING'|'CONFIRMED'|'FAILED'|'CANCELLED'
export type AutoBuyOrder = {
  id: string; chainId: number; tokenAddress: string; sellToken: string; spendAmount: string
  maxSlippageBps: number; maxPriceImpactBps: number; maxGasCostWei: string; minPoolLiquidityUsd: number
  transactionDeadlineSecs: number; retryLimit: number; permittedRouters: string[]; autoBuyEnabled: boolean
  state: AutoBuyState; idempotencyKey: string; armedAt: Date|null; expiresAt: Date|null; monitorAttempts: number
  executionAttempts: number; lastReason: string|null; poolAddress: string|null; poolRouter: string|null
  currentLiquidityUsd: number|null; expectedOutput: string|null; estimatedPriceImpactBps: number|null
  transactionHash: string|null; createdAt: Date; updatedAt: Date
}
export type PoolObservation = { tokenAddress: string; poolAddress: string; dex: string; liquidityUsd: number; tokenPriceUsd: number; observedAt: string }
export type SwapQuote = { router: string; sellAmount: bigint; buyAmount: bigint; minBuyAmount: bigint; gasLimit: bigint; gasPrice: bigint; gasCostWei: bigint; priceImpactBps: number; transaction: { to: string; data: string; value: bigint; gasLimit: bigint; gasPrice: bigint }; raw?: unknown }
export type DraftInput = { tokenAddress: string; sellToken: 'ETH'|'USDC'; spendAmount: string; maxSlippageBps: number; maxPriceImpactBps: number; maxGasCostEth: string; minPoolLiquidityUsd: number; transactionDeadlineSecs: number; retryLimit: number; permittedRouters: string[]; autoBuyEnabled: boolean }

export interface AutoBuyStore {
  create(input: Omit<AutoBuyOrder,'id'|'armedAt'|'expiresAt'|'monitorAttempts'|'executionAttempts'|'lastReason'|'poolAddress'|'poolRouter'|'currentLiquidityUsd'|'expectedOutput'|'estimatedPriceImpactBps'|'transactionHash'|'createdAt'|'updatedAt'>): Promise<AutoBuyOrder>
  get(id: string): Promise<AutoBuyOrder|null>; list(): Promise<AutoBuyOrder[]>; update(id: string, data: Partial<AutoBuyOrder>): Promise<AutoBuyOrder>
  claimExecution(id: string): Promise<boolean>; recoverInterrupted(): Promise<void>
}
export interface AutoBuyAudit { record(orderId: string, eventType: string, message: string, metadata?: Record<string, unknown>): Promise<void>; list(orderId: string): Promise<unknown[]> }
export interface AutoBuyRuntime {
  verifyContract(address: string): Promise<void>; observe(address: string): Promise<PoolObservation|null>; validatePool(observation: PoolObservation, order: AutoBuyOrder): Promise<void>
  quote(order: AutoBuyOrder, observation: PoolObservation): Promise<SwapQuote>; guard(order: AutoBuyOrder, observation: PoolObservation, quote: SwapQuote): void
  simulate(order: AutoBuyOrder, quote: SwapQuote): Promise<void>; execute(order: AutoBuyOrder, quote: SwapQuote, onBroadcast?: (hash:string)=>Promise<void>): Promise<{ hash: string; status: number|null }>
  receipt(hash: string): Promise<{ status: number|null }|null>
}
