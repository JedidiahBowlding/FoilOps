import { Connection, clusterApiUrl } from '@solana/web3.js'
import chalk from 'chalk'
import dotenv from 'dotenv'

dotenv.config()

// I use a separate helius connection to just get the logs cause i found this is the fastest one and will get most of the notifications
const heliusApiKey = process.env.HELIUS_API_KEY?.trim()
const HELIUS_NETWORK = heliusApiKey ? `https://mainnet.helius-rpc.com/?api-key=${heliusApiKey}` : ''

const configuredRpcEndpoints =
  process.env.RPC_ENDPOINTS?.split(',')
    .map((url) => url.trim())
    .filter(Boolean) ?? []

const allowPublicRpcFallback = String(process.env.ALLOW_PUBLIC_RPC_FALLBACK || 'false').toLowerCase() === 'true'

const fallbackRpcEndpoints = [process.env.SOLANA_NETWORK?.trim(), HELIUS_NETWORK].filter((url): url is string =>
  Boolean(url),
)

if (allowPublicRpcFallback) {
  fallbackRpcEndpoints.push(clusterApiUrl('mainnet-beta'))
}

const RPC_ENDPOINTS = Array.from(new Set([...configuredRpcEndpoints, ...fallbackRpcEndpoints]))

console.log(chalk.bold.greenBright(`LOADED ${RPC_ENDPOINTS.length} RPC ENDPOINTS`))

// If you are going to use FoilOps locally you can just use SOLANA_NETWORK for all connections
// and will work fine as long you dont track too many wallets
export class RpcConnectionManager {
  private static readonly endpointCooldownMs = Number(process.env.RPC_ENDPOINT_COOLDOWN_MS || 15_000)

  static endpointUrls: string[] = RPC_ENDPOINTS

  static connectionByUrl: Map<string, Connection> = new Map(
    RpcConnectionManager.endpointUrls.map((url) => [url, new Connection(url, 'confirmed')]),
  )

  static connections: Connection[] = RPC_ENDPOINTS.map((url) => new Connection(url, 'confirmed'))

  static logConnection = new Connection(HELIUS_NETWORK || clusterApiUrl('mainnet-beta'), 'processed')

  private static endpointUnhealthyUntil: Map<string, number> = new Map()

  private static roundRobinIndex = 0

  private static getHealthyEndpointUrls(): string[] {
    const now = Date.now()
    return RpcConnectionManager.endpointUrls.filter((url) => {
      const unhealthyUntil = RpcConnectionManager.endpointUnhealthyUntil.get(url) || 0
      return unhealthyUntil <= now
    })
  }

  static getConnectionByAttempt(attempt: number): { connection: Connection; endpointUrl: string } {
    const activeEndpoints = RpcConnectionManager.getHealthyEndpointUrls()
    const pool = activeEndpoints.length > 0 ? activeEndpoints : RpcConnectionManager.endpointUrls

    if (pool.length === 0) {
      const fallbackUrl = process.env.SOLANA_NETWORK?.trim() || HELIUS_NETWORK || clusterApiUrl('mainnet-beta')
      const fallbackConnection = new Connection(fallbackUrl, 'confirmed')
      return { connection: fallbackConnection, endpointUrl: fallbackUrl }
    }

    const normalizedAttempt = Math.max(0, Math.floor(attempt))
    const index = (RpcConnectionManager.roundRobinIndex + normalizedAttempt) % pool.length
    const endpointUrl = pool[index]
    const connection = RpcConnectionManager.connectionByUrl.get(endpointUrl) || new Connection(endpointUrl, 'confirmed')
    RpcConnectionManager.connectionByUrl.set(endpointUrl, connection)
    RpcConnectionManager.roundRobinIndex = (RpcConnectionManager.roundRobinIndex + 1) % pool.length

    return { connection, endpointUrl }
  }

  static markEndpointUnhealthy(endpointUrl: string, reason?: string) {
    if (!endpointUrl) {
      return
    }

    const unhealthyUntil = Date.now() + RpcConnectionManager.endpointCooldownMs
    RpcConnectionManager.endpointUnhealthyUntil.set(endpointUrl, unhealthyUntil)

    if (reason) {
      console.log(chalk.yellowBright(`Temporarily sidelining RPC endpoint ${endpointUrl}: ${reason}`))
    }
  }

  static getRandomConnection(): Connection {
    return RpcConnectionManager.getConnectionByAttempt(0).connection
  }

  static resetLogConnection() {
    RpcConnectionManager.logConnection = new Connection(HELIUS_NETWORK || clusterApiUrl('mainnet-beta'), 'processed')
  }
}
