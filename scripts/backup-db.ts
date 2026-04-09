import { PrismaClient } from '@prisma/client'
import * as fs from 'fs/promises'
import { encryptBackupJson } from './backup-crypto'

const prisma = new PrismaClient()
const includePrivateKeys = process.env.INCLUDE_PRIVATE_KEYS_IN_BACKUP === 'true'
const encryptedBackupMode = process.env.ENCRYPT_BACKUP === 'true'

async function backupDatabase() {
  try {
    if (includePrivateKeys && !encryptedBackupMode) {
      throw new Error('Refusing backup: private keys can only be included when ENCRYPT_BACKUP=true')
    }

    // Fetch all data from each table
    const users = await prisma.user.findMany({
      include: {
        userSubscription: true,
        userWallets: true,
      },
    })

    const wallets = await prisma.wallet.findMany({
      include: {
        userWallets: true,
      },
    })

    const userWallets = await prisma.userWallet.findMany()

    const userSubscriptions = await prisma.userSubscription.findMany()

    // Exclude private keys from backups unless explicitly enabled.
    const safeUsers = users.map((user) => ({
      ...user,
      personalWalletPrivKey: includePrivateKeys ? user.personalWalletPrivKey : null,
    }))

    // Create a backup object
    const backupData = {
      users: safeUsers,
      wallets,
      userWallets,
      userSubscriptions,
    }

    // Convert the backup data to JSON format
    const backupJson = JSON.stringify(backupData, null, 2)

    if (encryptedBackupMode) {
      const encryptedPayload = encryptBackupJson(backupJson)
      await fs.writeFile('database_backup.enc.json', JSON.stringify(encryptedPayload, null, 2))
      console.log(
        `Encrypted backup completed successfully! Data saved to database_backup.enc.json (private keys ${includePrivateKeys ? 'included' : 'excluded'})`,
      )
    } else {
      // Write plaintext backup only when private keys are excluded.
      await fs.writeFile('database_backup.json', backupJson)
      console.log('Backup completed successfully! Data saved to database_backup.json (private keys excluded)')
    }
  } catch (error) {
    console.error('Error during backup:', error)
  } finally {
    await prisma.$disconnect()
  }
}

backupDatabase()
