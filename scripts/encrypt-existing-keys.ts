/**
 * One-time migration: encrypts any plaintext private keys already in the DB.
 *
 * Safe to run multiple times — rows with the `enc:v1:` prefix are skipped.
 *
 * Usage:
 *   WALLET_ENCRYPTION_KEY=<64-hex-chars> npx ts-node scripts/encrypt-existing-keys.ts
 *
 * Or via pnpm:
 *   WALLET_ENCRYPTION_KEY=<64-hex-chars> pnpm ts-node scripts/encrypt-existing-keys.ts
 */

import { PrismaClient } from '@prisma/client'
import { encryptPrivateKey, isEncrypted } from '../src/lib/crypto'

const prisma = new PrismaClient()

async function main() {
  console.log('[encrypt-existing-keys] Starting migration...')

  // ── PersonalTradingWallet rows ──────────────────────────────────────────────
  const wallets = await prisma.personalTradingWallet.findMany({
    select: { id: true, privateKey: true },
  })

  let walletEncrypted = 0
  let walletSkipped = 0

  for (const wallet of wallets) {
    if (isEncrypted(wallet.privateKey)) {
      walletSkipped++
      continue
    }
    await prisma.personalTradingWallet.update({
      where: { id: wallet.id },
      data: { privateKey: encryptPrivateKey(wallet.privateKey) },
    })
    walletEncrypted++
  }

  console.log(
    `[PersonalTradingWallet] encrypted=${walletEncrypted}  skipped=${walletSkipped}  total=${wallets.length}`,
  )

  // ── User.personalWalletPrivKey rows ────────────────────────────────────────
  const users = await prisma.user.findMany({
    select: { id: true, personalWalletPrivKey: true },
  })

  let userEncrypted = 0
  let userSkipped = 0

  for (const user of users) {
    if (isEncrypted(user.personalWalletPrivKey)) {
      userSkipped++
      continue
    }
    await prisma.user.update({
      where: { id: user.id },
      data: { personalWalletPrivKey: encryptPrivateKey(user.personalWalletPrivKey) },
    })
    userEncrypted++
  }

  console.log(
    `[User.personalWalletPrivKey] encrypted=${userEncrypted}  skipped=${userSkipped}  total=${users.length}`,
  )

  console.log('[encrypt-existing-keys] Done.')
}

main()
  .catch((err) => {
    console.error('[encrypt-existing-keys] FATAL:', err)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
