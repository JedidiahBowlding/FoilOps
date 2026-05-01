import { createHash } from 'crypto'
import { PrismaUserRepository } from '../repositories/prisma/user'

type AllocatedExecutionWallet = {
  id: string
  name: string
  publicKey: string
  privateKey: string
  allocationWeight: number
  strategy: 'weighted_hash'
}

type WalletCache = {
  expiresAt: number
  wallets: Array<{
    id: string
    name: string
    publicKey: string
    privateKey: string
    allocationWeight: number
  }>
}

export class ExecutionWalletAllocator {
  private prismaUserRepository: PrismaUserRepository
  private cacheByUserId: Map<string, WalletCache> = new Map()
  private readonly cacheTtlMs = Math.max(2000, Number(process.env.MULTI_ACTIVE_WALLET_CACHE_TTL_MS || 15000))

  constructor() {
    this.prismaUserRepository = new PrismaUserRepository()
  }

  public isEnabled(): boolean {
    return process.env.MULTI_ACTIVE_WALLETS_ENABLED === 'true'
  }

  public async allocateForSignal(signalId: string): Promise<AllocatedExecutionWallet | null> {
    if (!this.isEnabled()) {
      return null
    }

    const adminUserId = process.env.ADMIN_CHAT_ID?.trim()
    if (!adminUserId) {
      return null
    }

    const wallets = await this.getWallets(adminUserId)
    if (wallets.length === 0) {
      return null
    }

    const selected = this.selectByWeightedHash(wallets, signalId)
    if (!selected) {
      return null
    }

    return {
      ...selected,
      strategy: 'weighted_hash',
    }
  }

  private async getWallets(userId: string) {
    const now = Date.now()
    const cached = this.cacheByUserId.get(userId)
    if (cached && cached.expiresAt > now) {
      return cached.wallets
    }

    const wallets = await this.prismaUserRepository.listActivePersonalTradingWalletsForExecution(userId)
    const normalized = wallets
      .map((wallet) => ({
        ...wallet,
        allocationWeight: Math.min(1000, Math.max(0.01, Number(wallet.allocationWeight || 1))),
      }))
      .filter((wallet) => wallet.privateKey && wallet.publicKey)

    this.cacheByUserId.set(userId, {
      expiresAt: now + this.cacheTtlMs,
      wallets: normalized,
    })

    return normalized
  }

  private selectByWeightedHash(
    wallets: Array<{ id: string; name: string; publicKey: string; privateKey: string; allocationWeight: number }>,
    seed: string,
  ) {
    if (wallets.length === 1) {
      return wallets[0]
    }

    const totalWeight = wallets.reduce((sum, wallet) => sum + wallet.allocationWeight, 0)
    if (totalWeight <= 0) {
      return wallets[0]
    }

    const hashHex = createHash('sha256').update(seed).digest('hex')
    const hashSlice = hashHex.slice(0, 12)
    const hashValue = parseInt(hashSlice, 16)
    const threshold = (hashValue / 0xffffffffffff) * totalWeight

    let cumulative = 0
    for (const wallet of wallets) {
      cumulative += wallet.allocationWeight
      if (threshold <= cumulative) {
        return wallet
      }
    }

    return wallets[wallets.length - 1]
  }
}

export const executionWalletAllocator = new ExecutionWalletAllocator()
