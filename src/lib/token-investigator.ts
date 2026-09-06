import {
  ConfirmedSignatureInfo,
  ParsedAccountData,
  ParsedInstruction,
  ParsedTransactionWithMeta,
  PartiallyDecodedInstruction,
  PublicKey,
  TokenBalance,
} from '@solana/web3.js'
import axios from 'axios'
import { KNOWN_PLATFORM_PROGRAMS, KNOWN_PLATFORM_WALLETS } from '../constants/trace-platforms'
import { RpcConnectionManager } from '../providers/solana'
import { FundFlowTracer, FlowTraceResult } from './fund-flow-tracer'
import { ValidTransactions } from './valid-transactions'
import { TokenInfoPump } from '../types/pumpfun-types'
import { PumpDetail } from '../types/gmgn-ai-types'
import { ChainRegistry } from './chains'
import { SupportedChain } from './chains/types'

type DexScreenerPair = {
  chainId?: string
  dexId?: string
  pairCreatedAt?: number
  info?: {
    websites?: Array<{ label?: string; url?: string }>
    socials?: Array<{ type?: string; url?: string }>
  }
}

type DexScreenerResponse = {
  pairs?: DexScreenerPair[]
}

export type DeveloperResolutionSource =
  | 'enrichmentCreator'
  | 'mintAuthority'
  | 'freezeAuthority'
  | 'txAuthority'
  | 'firstSigner'

export type TokenEnrichmentData = {
  name?: string
  symbol?: string
  description?: string
  twitter?: string
  telegram?: string
  website?: string
  createdTimestamp?: number
  bondingCurve?: string
  bondingCurveTokenAccount?: string
  raydiumPool?: string
  graduated?: boolean
  currentMarketCapUsd?: number
  liquidityUsd?: number
  rugRatio?: number
  holderRuggedNum?: number
  holderTokenNum?: number
  ruggedTokens?: { address: string; name: string; symbol: string }[]
  creatorBalance?: number
  creatorPercentage?: string
  creatorTokenStatus?: string
  top10HolderRate?: number
  burnStatus?: string
  isHoneypot?: boolean | null
  renounced?: boolean | null
  launchpad?: string
  creatorAddress?: string
}

export type TokenInvestigationResult = {
  tokenMint: string
  developerWallet: string
  resolutionSource: DeveloperResolutionSource
  initialFundingSource: WalletFundingSource | null
  relatedTokens: string[]
  trace: FlowTraceResult
  poolTrace: FlowTraceResult | null
  alerts: string[]
  enrichment: TokenEnrichmentData
}

export type WalletFundingSource = {
  funderWallet: string
  fundedWallet: string
  signature: string
  fundedAt?: string
  asset: 'SOL' | 'TOKEN'
  amount: string
  tokenMint?: string
  label?: string
}

export class TokenInvestigator {
  private fundFlowTracer: FundFlowTracer
  private chainRegistry: ChainRegistry
  private static readonly RPC_CALL_TIMEOUT_MS = 8_000

  constructor() {
    this.fundFlowTracer = new FundFlowTracer()
    this.chainRegistry = new ChainRegistry()
  }

  async investigateWalletOnChain(wallet: string, chain: SupportedChain) {
    const adapter = this.chainRegistry.getAdapter(chain)
    const normalizedWallet = adapter.normalizeWallet(wallet)
    const transactions = await adapter.getRecentTransactions(normalizedWallet, 25)

    return {
      chain,
      wallet: normalizedWallet,
      transactions,
    }
  }

  async investigateToken(tokenMint: string): Promise<TokenInvestigationResult | null> {
    const enrichment = await this.withTimeout(this.fetchTokenEnrichment(tokenMint), 12_000, {} as TokenEnrichmentData)

    const developer = await this.resolveDeveloperWallet(tokenMint, enrichment)
    if (!developer) {
      return null
    }

    const [relatedTokens, devTrace, initialFundingSource] = await Promise.all([
      this.withTimeout(this.getDeveloperTokenHistory(developer.wallet, tokenMint), 15_000, [tokenMint]),
      this.withTimeout(
        this.fundFlowTracer.traceWalletFlow(developer.wallet, 4, 12, {
          followAllRecipients: true,
          maxVisitedWallets: 120,
        }),
        30_000,
        this.emptyTrace(developer.wallet, 4),
      ),
      this.withTimeout(this.findInitialFundingSource(developer.wallet), 12_000, null),
    ])

    let poolTrace: FlowTraceResult | null = null
    const poolAddress = enrichment.raydiumPool || enrichment.bondingCurve
    if (poolAddress && poolAddress !== developer.wallet) {
      poolTrace = await this.withTimeout(
        this.fundFlowTracer.traceWalletFlow(poolAddress, 3, 10, {
          followAllRecipients: true,
          maxVisitedWallets: 80,
        }),
        20_000,
        null,
      )
    }

    const alerts = [...devTrace.alerts, ...(poolTrace?.alerts || [])]

    if (relatedTokens.length > 1) {
      alerts.push(`Developer wallet is linked to ${relatedTokens.length} token mints including ${tokenMint}`)
    }
    if (enrichment.rugRatio && enrichment.rugRatio > 0.5) {
      alerts.push(`High rug ratio: ${(enrichment.rugRatio * 100).toFixed(1)}% of holders were rugged`)
    }
    if (enrichment.holderRuggedNum && enrichment.holderRuggedNum > 0) {
      alerts.push(`${enrichment.holderRuggedNum} holders previously rugged by this developer`)
    }
    if (enrichment.ruggedTokens && enrichment.ruggedTokens.length > 0) {
      enrichment.ruggedTokens.slice(0, 3).forEach((t) => {
        alerts.push(`Prior rug: ${t.symbol} (${t.address})`)
      })
    }
    if (enrichment.isHoneypot) {
      alerts.push('Token flagged as honeypot by GMGN')
    }

    return {
      tokenMint,
      developerWallet: developer.wallet,
      resolutionSource: developer.source,
      initialFundingSource,
      relatedTokens,
      trace: devTrace,
      poolTrace,
      alerts: Array.from(new Set(alerts)),
      enrichment,
    }
  }

  async fetchTokenEnrichment(tokenMint: string): Promise<TokenEnrichmentData> {
    const [pump, gmgn, dex] = await Promise.allSettled([
      this.fetchPumpFunData(tokenMint),
      this.fetchGmgnData(tokenMint),
      this.fetchDexScreenerData(tokenMint),
    ])

    const pumpData = pump.status === 'fulfilled' ? pump.value : null
    const gmgnData = gmgn.status === 'fulfilled' ? gmgn.value : null
    const dexData = dex.status === 'fulfilled' ? dex.value : null

    const createdTimestamp =
      gmgnData?.creation_timestamp ||
      gmgnData?.open_timestamp ||
      pumpData?.created_timestamp ||
      (dexData?.pairCreatedAt ? Math.floor(dexData.pairCreatedAt / 1000) : undefined)

    const launchpad =
      gmgnData?.launchpad ||
      (pumpData ? 'Pump.fun' : undefined) ||
      (dexData?.dexId ? `${dexData.dexId}${dexData.chainId ? ` (${dexData.chainId})` : ''}` : undefined)

    return {
      name: pumpData?.name,
      symbol: pumpData?.symbol,
      description: pumpData?.description,
      twitter:
        pumpData?.twitter || dexData?.info?.socials?.find((link) => link.type?.toLowerCase() === 'twitter')?.url,
      telegram:
        pumpData?.telegram || dexData?.info?.socials?.find((link) => link.type?.toLowerCase() === 'telegram')?.url,
      website: pumpData?.website || dexData?.info?.websites?.find((link) => link.url)?.url,
      createdTimestamp,
      bondingCurve: pumpData?.bonding_curve,
      bondingCurveTokenAccount: pumpData?.associated_bonding_curve,
      raydiumPool: pumpData?.raydium_pool || undefined,
      graduated: pumpData?.complete,
      currentMarketCapUsd: gmgnData?.market_cap ?? pumpData?.usd_market_cap,
      liquidityUsd: gmgnData?.liquidity,
      rugRatio: gmgnData?.rug_ratio,
      holderRuggedNum: gmgnData?.holder_rugged_num,
      holderTokenNum: gmgnData?.holder_token_num,
      ruggedTokens: gmgnData?.rugged_tokens,
      creatorBalance: gmgnData?.creator_balance,
      creatorPercentage: gmgnData?.creator_percentage,
      creatorTokenStatus: gmgnData?.creator_token_status,
      top10HolderRate: gmgnData?.top_10_holder_rate,
      burnStatus: gmgnData?.burn_status,
      isHoneypot: gmgnData?.is_honeypot,
      renounced: gmgnData?.renounced,
      launchpad,
      creatorAddress: gmgnData?.creator_address || pumpData?.creator || undefined,
    }
  }

  private async fetchPumpFunData(tokenMint: string): Promise<TokenInfoPump | null> {
    try {
      const response = await axios.get(`https://frontend-api.pump.fun/coins/${tokenMint}`, {
        timeout: 8000,
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0',
          Accept: '*/*',
          Referer: 'https://www.pump.fun/',
          Origin: 'https://www.pump.fun',
        },
      })
      return response.status === 200 ? (response.data as TokenInfoPump) : null
    } catch {
      return null
    }
  }

  private async fetchGmgnData(tokenMint: string): Promise<PumpDetail | null> {
    try {
      const res = await fetch(`https://gmgn.ai/defi/quotation/v1/tokens/sol/${tokenMint}`, {
        signal: AbortSignal.timeout(8000),
      })
      const data = await res.json()
      return data?.code === 0 ? (data.data.token as PumpDetail) : null
    } catch {
      return null
    }
  }

  private async fetchDexScreenerData(tokenMint: string): Promise<DexScreenerPair | null> {
    try {
      const res = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${tokenMint}`, {
        signal: AbortSignal.timeout(8000),
      })
      if (!res.ok) return null

      const data = (await res.json()) as DexScreenerResponse
      if (!Array.isArray(data.pairs) || data.pairs.length === 0) return null

      const pairsWithCreatedAt = data.pairs.filter((pair) => typeof pair.pairCreatedAt === 'number')
      if (pairsWithCreatedAt.length > 0) {
        return pairsWithCreatedAt.sort((a, b) => (a.pairCreatedAt || 0) - (b.pairCreatedAt || 0))[0]
      }

      return data.pairs[0]
    } catch {
      return null
    }
  }

  private async resolveDeveloperWallet(
    tokenMint: string,
    enrichment?: TokenEnrichmentData,
  ): Promise<{ wallet: string; source: DeveloperResolutionSource } | null> {
    const enrichmentCreator = enrichment?.creatorAddress
    if (enrichmentCreator && this.isLikelyUserWallet(enrichmentCreator)) {
      return { wallet: enrichmentCreator, source: 'enrichmentCreator' }
    }

    const mintAuthority = await this.withTimeout(
      this.getMintAuthority(tokenMint),
      TokenInvestigator.RPC_CALL_TIMEOUT_MS,
      null,
    )
    if (mintAuthority?.mintAuthority && this.isLikelyUserWallet(mintAuthority.mintAuthority)) {
      return { wallet: mintAuthority.mintAuthority, source: 'mintAuthority' }
    }

    if (mintAuthority?.freezeAuthority && this.isLikelyUserWallet(mintAuthority.freezeAuthority)) {
      return { wallet: mintAuthority.freezeAuthority, source: 'freezeAuthority' }
    }

    const oldestSignature = await this.withTimeout(this.getOldestSignature(tokenMint), 12_000, undefined)
    if (!oldestSignature) {
      return null
    }

    const tx = await this.withTimeout(this.getParsedTransaction(oldestSignature), 10_000, null)
    if (!tx) {
      return null
    }

    const txAuthority = this.extractLikelyCreatorFromTx(tx, tokenMint)
    if (txAuthority) {
      return { wallet: txAuthority, source: 'txAuthority' }
    }

    const firstSigner = tx.transaction.message.accountKeys[0]?.pubkey.toString()
    if (!firstSigner || !this.isLikelyUserWallet(firstSigner)) {
      return null
    }

    return { wallet: firstSigner, source: 'firstSigner' }
  }

  private async getMintAuthority(
    tokenMint: string,
  ): Promise<{ mintAuthority: string | null; freezeAuthority: string | null } | null> {
    try {
      const accountInfo = await RpcConnectionManager.getRandomConnection().getParsedAccountInfo(
        new PublicKey(tokenMint),
      )
      if (!accountInfo?.value) return null
      const data = accountInfo.value.data as ParsedAccountData
      if (data.parsed?.type !== 'mint') return null
      return {
        mintAuthority: data.parsed.info?.mintAuthority || null,
        freezeAuthority: data.parsed.info?.freezeAuthority || null,
      }
    } catch (error) {
      console.log('TOKEN_INVESTIGATOR_MINT_AUTHORITY_ERROR', error)
      return null
    }
  }

  private async getOldestSignature(address: string): Promise<string | undefined> {
    const oldestSignatures = await this.getOldestSignatures(address, 1)
    return oldestSignatures[0]?.signature
  }

  private async getOldestSignatures(address: string, count: number, maxPages = 6): Promise<ConfirmedSignatureInfo[]> {
    try {
      let before: string | undefined = undefined
      let lastBatch: ConfirmedSignatureInfo[] = []
      let pageCount = 0

      while (pageCount < maxPages) {
        const batch: ConfirmedSignatureInfo[] = await this.withTimeout<ConfirmedSignatureInfo[]>(
          RpcConnectionManager.getRandomConnection().getSignaturesForAddress(new PublicKey(address), {
            before,
            limit: 500,
          }),
          TokenInvestigator.RPC_CALL_TIMEOUT_MS,
          [],
        )

        if (batch.length === 0) {
          break
        }

        lastBatch = batch
        before = batch[batch.length - 1]?.signature
        pageCount += 1

        if (batch.length < 500) {
          break
        }
      }

      return lastBatch.slice().reverse().slice(0, count)
    } catch (error) {
      console.log('TOKEN_INVESTIGATOR_OLDEST_SIGNATURE_ERROR', error)
      return []
    }
  }

  private async findInitialFundingSource(walletAddress: string): Promise<WalletFundingSource | null> {
    const oldestSignatures = await this.getOldestSignatures(walletAddress, 12, 4)

    for (const signatureInfo of oldestSignatures) {
      const transaction = await this.withTimeout(this.getParsedTransaction(signatureInfo.signature), 6_000, null)
      if (!transaction) {
        continue
      }

      const fundingSource = this.extractInboundFunding(transaction, walletAddress, signatureInfo.signature)
      if (fundingSource) {
        return {
          ...fundingSource,
          fundedAt: signatureInfo.blockTime ? new Date(signatureInfo.blockTime * 1000).toISOString() : undefined,
        }
      }
    }

    return null
  }

  private extractInboundFunding(
    transaction: ParsedTransactionWithMeta,
    walletAddress: string,
    signature: string,
  ): WalletFundingSource | null {
    const instructions = [
      ...(transaction.transaction.message.instructions || []),
      ...((transaction.meta?.innerInstructions || []).flatMap((inner) => inner.instructions) as (
        | ParsedInstruction
        | PartiallyDecodedInstruction
      )[]),
    ]

    for (const instruction of instructions) {
      if (!('parsed' in instruction)) {
        continue
      }

      const parsedInstruction = instruction as ParsedInstruction
      const parsed = parsedInstruction.parsed as {
        info?: {
          source?: string
          destination?: string
          authority?: string
          amount?: string
          lamports?: number
          mint?: string
          tokenAmount?: {
            uiAmountString?: string
            amount?: string
          }
        }
      }

      const source = parsed.info?.source || parsed.info?.authority
      const destination = parsed.info?.destination

      if (!source || !destination || destination !== walletAddress || source === walletAddress) {
        continue
      }

      const amountLamports = parsed.info?.lamports ? Number(parsed.info.lamports) / 1e9 : undefined
      const tokenMint =
        parsed.info?.mint || this.findTokenMintByAccount(transaction.meta?.postTokenBalances || [], walletAddress)

      return {
        funderWallet: source,
        fundedWallet: walletAddress,
        signature,
        asset: amountLamports !== undefined ? 'SOL' : 'TOKEN',
        amount:
          amountLamports !== undefined
            ? amountLamports.toFixed(6)
            : parsed.info?.tokenAmount?.uiAmountString ||
              parsed.info?.tokenAmount?.amount ||
              parsed.info?.amount ||
              'unknown',
        tokenMint,
        label: this.classifyFundingWallet(source, transaction),
      }
    }

    const walletIndex = transaction.transaction.message.accountKeys.findIndex(
      (account) => account.pubkey.toBase58() === walletAddress,
    )
    if (walletIndex === -1) {
      return null
    }

    const preBalance = transaction.meta?.preBalances?.[walletIndex] || 0
    const postBalance = transaction.meta?.postBalances?.[walletIndex] || 0
    if (preBalance === 0 && postBalance > 0) {
      const feePayer = transaction.transaction.message.accountKeys[0]?.pubkey.toBase58()
      if (feePayer && feePayer !== walletAddress) {
        return {
          funderWallet: feePayer,
          fundedWallet: walletAddress,
          signature,
          asset: 'SOL',
          amount: ((postBalance - preBalance) / 1e9).toFixed(6),
          label: this.classifyFundingWallet(feePayer, transaction),
        }
      }
    }

    return null
  }

  private classifyFundingWallet(source: string, transaction: ParsedTransactionWithMeta): string | undefined {
    const walletPlatform = KNOWN_PLATFORM_WALLETS[source]
    if (walletPlatform) {
      return walletPlatform.label
    }

    const accountKeys = transaction.transaction.message.accountKeys.map((account) => account.pubkey.toBase58())
    for (const accountKey of accountKeys) {
      const knownProgram = KNOWN_PLATFORM_PROGRAMS[accountKey]
      if (knownProgram) {
        return knownProgram.label
      }
    }

    return undefined
  }

  private async getParsedTransaction(signature: string): Promise<ParsedTransactionWithMeta | null> {
    try {
      return await RpcConnectionManager.getRandomConnection().getParsedTransaction(signature, {
        maxSupportedTransactionVersion: 0,
      })
    } catch (error) {
      console.log('TOKEN_INVESTIGATOR_PARSED_TX_ERROR', error)
      return null
    }
  }

  private async getDeveloperTokenHistory(developerWallet: string, seedTokenMint: string): Promise<string[]> {
    const discoveredTokens = new Set<string>([seedTokenMint])

    try {
      const signatures = await RpcConnectionManager.getRandomConnection().getSignaturesForAddress(
        new PublicKey(developerWallet),
        { limit: 30 },
      )

      for (const signatureInfo of signatures) {
        const transaction = await this.getParsedTransaction(signatureInfo.signature)
        if (!transaction) continue

        const createdMints = this.extractCreatedTokenMints(transaction, developerWallet)
        createdMints.forEach((mint) => discoveredTokens.add(mint))
      }
    } catch (error) {
      console.log('TOKEN_INVESTIGATOR_HISTORY_ERROR', error)
    }

    return Array.from(discoveredTokens)
  }

  private extractCreatedTokenMints(transaction: ParsedTransactionWithMeta, developerWallet: string): string[] {
    const mints = new Set<string>()
    const relevant = ValidTransactions.isRelevantTransaction({
      err: transaction.meta?.err || null,
      logs: transaction.meta?.logMessages || [],
      signature: transaction.transaction.signatures[0] || '',
    })

    const instructions = [
      ...(transaction.transaction.message.instructions || []),
      ...((transaction.meta?.innerInstructions || []).flatMap((inner) => inner.instructions) as (
        | ParsedInstruction
        | PartiallyDecodedInstruction
      )[]),
    ]

    for (const instruction of instructions) {
      if (!('parsed' in instruction)) {
        continue
      }

      const parsedInstruction = instruction as ParsedInstruction
      const parsed = parsedInstruction.parsed as {
        type?: string
        info?: {
          mint?: string
          mintAuthority?: string
          authority?: string
        }
      }

      const instructionType = parsed.type || ''
      const info = parsed.info || {}

      if (!['initializeMint', 'initializeMint2', 'mintTo', 'create'].includes(instructionType)) {
        continue
      }

      const ownerAuthority = info.mintAuthority || info.authority
      if (ownerAuthority && ownerAuthority !== developerWallet) {
        continue
      }

      if (info.mint) {
        mints.add(info.mint)
      }
    }

    if (relevant.swap === 'mint_pumpfun') {
      const postMint = transaction.meta?.postTokenBalances?.find(
        (balance) =>
          balance.owner === developerWallet && balance.mint !== 'So11111111111111111111111111111111111111112',
      )?.mint

      if (postMint) {
        mints.add(postMint)
      }
    }

    return Array.from(mints)
  }

  private findTokenMintByAccount(balances: TokenBalance[], accountAddress: string): string | undefined {
    const match = balances.find((balance) => balance.owner === accountAddress)
    return match?.mint
  }

  private extractLikelyCreatorFromTx(transaction: ParsedTransactionWithMeta, tokenMint: string): string | null {
    const candidates = new Set<string>()

    const signerCandidates = transaction.transaction.message.accountKeys
      .filter((account) => account.signer)
      .map((account) => account.pubkey.toBase58())
    signerCandidates.forEach((candidate) => candidates.add(candidate))

    const instructions = [
      ...(transaction.transaction.message.instructions || []),
      ...((transaction.meta?.innerInstructions || []).flatMap((inner) => inner.instructions) as (
        | ParsedInstruction
        | PartiallyDecodedInstruction
      )[]),
    ]

    for (const instruction of instructions) {
      if (!('parsed' in instruction)) continue

      const parsedInstruction = instruction as ParsedInstruction
      const info = (parsedInstruction.parsed as { info?: Record<string, unknown> })?.info
      if (!info || typeof info !== 'object') continue

      const likelyFields = [
        'authority',
        'owner',
        'wallet',
        'user',
        'payer',
        'source',
        'mintAuthority',
        'freezeAuthority',
      ]
      for (const field of likelyFields) {
        const value = info[field]
        if (typeof value === 'string') {
          candidates.add(value)
        }
      }
    }

    for (const candidate of candidates) {
      if (candidate === tokenMint) continue
      if (this.isLikelyUserWallet(candidate)) {
        return candidate
      }
    }

    return null
  }

  private isLikelyUserWallet(address: string): boolean {
    if (!this.isValidPublicKey(address)) return false
    if (KNOWN_PLATFORM_WALLETS[address]) return false
    if (KNOWN_PLATFORM_PROGRAMS[address]) return false
    return true
  }

  private isValidPublicKey(address: string): boolean {
    try {
      new PublicKey(address)
      return true
    } catch {
      return false
    }
  }

  private emptyTrace(wallet: string, maxHops: number): FlowTraceResult {
    return {
      wallet,
      tracedAt: new Date().toISOString(),
      maxHops,
      steps: [],
      alerts: ['Flow trace fallback used due to timeout'],
      terminalWallets: [],
      mixerTrace: {
        encountered: false,
        mixerWallets: [],
        downstreamWallets: [],
      },
      platformTrace: {
        exchange: {
          encountered: false,
          wallets: [],
          downstreamWallets: [],
        },
        bridge: {
          encountered: false,
          wallets: [],
          downstreamWallets: [],
        },
      },
      bridgeRouteAttribution: {
        encountered: false,
        canonicalFamilies: [],
        canonicalPrograms: [],
        relayerWallets: [],
        handoffWallets: [],
        handoffs: [],
      },
      crossChainContinuation: {
        encountered: false,
        bridgeFamilies: [],
        recommendedNextChains: [],
        continuationCandidates: [],
        unresolvedHandoffs: [],
        notes: ['Flow trace fallback used due to timeout'],
      },
      riskConfidenceModel: {
        modelVersion: '1.0.0',
        baseConfidence: 0,
        attenuation: 0,
        adjustedConfidence: 0,
        degradationLevel: 'LOW',
        boundariesCrossed: [],
        events: [],
        notes: ['Flow trace fallback used due to timeout'],
      },
      cexDepositHeuristics: {
        detected: false,
        confidence: 0,
        exchangeWalletCount: 0,
        exchangeTransferCount: 0,
        totalExchangeOutflowSol: 0,
        exchangeClusters: [],
        memoSignals: {
          memoTransferCount: 0,
          memoSignatureCount: 0,
          memoSamples: [],
        },
        evidence: [],
      },
    }
  }

  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      return await Promise.race([
        promise,
        new Promise<T>((resolve) => {
          timer = setTimeout(() => resolve(fallback), timeoutMs)
          timer.unref?.()
        }),
      ])
    } finally {
      if (timer) clearTimeout(timer)
    }
  }
}
