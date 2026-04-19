import { PublicKey } from '@solana/web3.js'

export type WalletChain = 'solana' | 'ethereum' | 'bnb'

const BASE58_REGEX = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/
const EVM_REGEX = /^0x[a-fA-F0-9]{40}$/

export function isSolanaWallet(address: string): boolean {
  if (!BASE58_REGEX.test(address)) {
    return false
  }

  try {
    return PublicKey.isOnCurve(new PublicKey(address).toBytes())
  } catch {
    return false
  }
}

export function isEvmWallet(address: string): boolean {
  return EVM_REGEX.test(address)
}

export function parseWalletInput(input: string): { chain: WalletChain; address: string } | null {
  const trimmed = input.trim()
  if (!trimmed) {
    return null
  }

  const prefixed = trimmed.match(/^(sol|solana|eth|ethereum|bnb)\s*:\s*(.+)$/i)
  if (prefixed) {
    const prefix = prefixed[1].toLowerCase()
    const rawAddress = prefixed[2].trim()

    if ((prefix === 'sol' || prefix === 'solana') && isSolanaWallet(rawAddress)) {
      return { chain: 'solana', address: rawAddress }
    }

    if ((prefix === 'eth' || prefix === 'ethereum') && isEvmWallet(rawAddress)) {
      return { chain: 'ethereum', address: rawAddress.toLowerCase() }
    }

    if (prefix === 'bnb' && isEvmWallet(rawAddress)) {
      return { chain: 'bnb', address: rawAddress.toLowerCase() }
    }

    return null
  }

  if (isSolanaWallet(trimmed)) {
    return { chain: 'solana', address: trimmed }
  }

  return null
}

export function toStoredWalletAddress(chain: WalletChain, address: string): string {
  if (chain === 'solana') {
    return address
  }

  return `${chain}:${address.toLowerCase()}`
}

export function fromStoredWalletAddress(storedAddress: string): { chain: WalletChain; address: string } {
  const normalized = storedAddress.trim()
  const prefixed = normalized.match(/^(ethereum|bnb):(0x[a-fA-F0-9]{40})$/i)

  if (prefixed) {
    return {
      chain: prefixed[1].toLowerCase() as WalletChain,
      address: prefixed[2].toLowerCase(),
    }
  }

  return { chain: 'solana', address: normalized }
}
