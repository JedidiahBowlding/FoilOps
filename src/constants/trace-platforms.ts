import {
  JUPITER_PROGRAM_ID,
  PUMP_FUN_PROGRAM_ID,
  PUMPFUN_AMM_PROGRAM_ID,
  RAYDIUM_PROGRAM_ID,
} from '../config/program-ids'
import fs from 'fs'
import path from 'path'

type PlatformLabel = { label: string; category: PlatformCategory }

export type PlatformCategory = 'MIXER' | 'EXCHANGE' | 'DEFI' | 'SCAM' | 'BRIDGE' | 'CUSTODY' | 'UNKNOWN'

const loadRepoPlatformWallets = (): Record<string, PlatformLabel> => {
  try {
    const candidatePaths = [
      {
        root: path.resolve(process.cwd(), 'src/constants'),
        files: ['bridge-wallets.json', 'custody-wallets.json', 'exchange-wallets.json', 'mixer-wallets.json'],
      },
      {
        root: __dirname,
        files: ['bridge-wallets.json', 'custody-wallets.json', 'exchange-wallets.json', 'mixer-wallets.json'],
      },
    ]

    for (const candidate of candidatePaths) {
      const mergedWallets: Record<string, PlatformLabel> = {}
      let foundAtLeastOneFile = false

      for (const fileName of candidate.files) {
        const candidatePath = path.resolve(candidate.root, fileName)
        if (!fs.existsSync(candidatePath)) {
          continue
        }

        const raw = fs.readFileSync(candidatePath, 'utf8')
        Object.assign(mergedWallets, JSON.parse(raw) as Record<string, PlatformLabel>)
        foundAtLeastOneFile = true
      }

      if (foundAtLeastOneFile) {
        return mergedWallets
      }
    }

    return {}
  } catch {
    return {}
  }
}

const EXTERNAL_PLATFORM_WALLETS = (() => {
  try {
    const raw = process.env.TRACE_PLATFORM_WALLETS_JSON
    if (!raw) {
      return {} as Record<string, PlatformLabel>
    }

    return JSON.parse(raw) as Record<string, PlatformLabel>
  } catch {
    return {} as Record<string, PlatformLabel>
  }
})()

export const KNOWN_PLATFORM_WALLETS: Record<string, PlatformLabel> = {
  // Publicly labeled high-signal accounts. Primary intelligence lives in the repo JSON file.
  ...loadRepoPlatformWallets(),
  ...EXTERNAL_PLATFORM_WALLETS,
}

export const KNOWN_PLATFORM_PROGRAMS: Record<string, PlatformLabel> = {
  [PUMP_FUN_PROGRAM_ID]: { label: 'Pump.fun', category: 'DEFI' },
  [PUMPFUN_AMM_PROGRAM_ID]: { label: 'Pump.fun AMM', category: 'DEFI' },
  [JUPITER_PROGRAM_ID]: { label: 'Jupiter', category: 'DEFI' },
  [RAYDIUM_PROGRAM_ID]: { label: 'Raydium', category: 'DEFI' },
  whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc: { label: 'Orca Whirlpool', category: 'DEFI' },
  PhoeNiXZ8ByJGLkxNfZRnkUfjvmuYqLR89jjFHGqdXY: { label: 'Phoenix DEX', category: 'EXCHANGE' },
  wormDTUJ6AWPNvk59vGQbDvGJmqbDTdgWgAqcLBCgUb: { label: 'Wormhole Token Bridge', category: 'BRIDGE' },
  11111111111111111111111111111111: { label: 'System Program', category: 'UNKNOWN' },
}

export const MIXER_KEYWORDS = ['tornado', 'mixer', 'mix', 'elusiv', 'privacy pool']
