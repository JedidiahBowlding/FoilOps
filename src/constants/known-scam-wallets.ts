export type KnownScamWalletEntry = {
  address: string
  source: 'CURATED_DB'
  reason: string
  baseRiskScore: number
  priorTokenMints: string[]
}

// Seed list of wallets historically linked to rug-pull style launches.
export const KNOWN_SCAM_WALLETS: KnownScamWalletEntry[] = [
  {
    address: 'Btsrm71PfnarCXnPoYEfzSN5fMzSBBvuAa8BfKaPms77',
    source: 'CURATED_DB',
    reason: 'Historically tied to rapid-liquidity-exit token launches',
    baseRiskScore: 90,
    priorTokenMints: ['So11111111111111111111111111111111111111112'],
  },
  {
    address: '5dGt7jiHSwxpA4Vxy32ebTGH9ektSjQU2WtEGJvtimWW',
    source: 'CURATED_DB',
    reason: 'Repeated wallet rotation after suspected rug events',
    baseRiskScore: 85,
    priorTokenMints: [],
  },
  {
    address: 'J2sBPuDo51RYAGyZGdaTA6tX1Tf3pg6vAEzwxuVZq5Zt',
    source: 'CURATED_DB',
    reason: 'Associated with multiple abandoned pump launches',
    baseRiskScore: 82,
    priorTokenMints: [],
  },
]
