import { CreateWallet } from '../../lib/create-wallet'
import { CreateUserInterface } from '../../types/general-interfaces'
import prisma from '../../providers/prisma'

type ActivePersonalWallet = {
  id: string
  name: string
  publicKey: string
  privateKey: string
  isActive: boolean
}

export class PrismaUserRepository {
  private createWallet: CreateWallet

  constructor() {
    this.createWallet = new CreateWallet()
  }

  public async create({ firstName, id, lastName, username }: CreateUserInterface) {
    const { publicKey, privateKey } = this.createWallet.create()

    const newUser = await prisma.user.create({
      data: {
        firstName,
        id,
        lastName,
        username,
        personalWalletPubKey: publicKey,
        personalWalletPrivKey: privateKey,
        personalTradingWallets: {
          create: {
            name: 'Wallet 1',
            publicKey,
            privateKey,
            isActive: true,
          },
        },
      },
    })

    return newUser
  }

  public async getById(userId: string) {
    const user = await prisma.user.findUnique({
      where: {
        id: userId,
      },
      select: {
        id: true,
        personalWalletPrivKey: true,
        personalWalletPubKey: true,
        hasDonated: true,
        userSubscription: {
          select: {
            plan: true,
            subscriptionCurrentPeriodEnd: true,
          },
        },
        _count: {
          select: {
            userWallets: true,
          },
        },
      },
    })

    if (!user) {
      return null
    }

    const activeWallet = await this.getActivePersonalTradingWallet(userId)
    if (!activeWallet) {
      return null
    }

    return {
      ...user,
      personalWalletPubKey: activeWallet.publicKey,
      personalWalletPrivKey: activeWallet.privateKey,
    }
  }

  public async getUserPlan(userId: string) {
    const user = await prisma.user.findUnique({
      where: {
        id: userId,
      },
      select: {
        userSubscription: {
          select: {
            plan: true,
            subscriptionCurrentPeriodEnd: true,
          },
        },
      },
    })

    if (!user) {
      return null
    }

    const activeWallet = await this.getActivePersonalTradingWallet(userId)

    return {
      ...user,
      personalWalletPubKey: activeWallet?.publicKey || '',
    }
  }

  public async getPersonalWallet(userId: string) {
    const activeWallet = await this.getActivePersonalTradingWallet(userId)
    if (!activeWallet) {
      return null
    }

    return {
      personalWalletPubKey: activeWallet.publicKey,
      personalWalletPrivKey: activeWallet.privateKey,
      personalWalletId: activeWallet.id,
      personalWalletName: activeWallet.name,
    }
  }

  public async listPersonalTradingWallets(userId: string) {
    let wallets = await prisma.personalTradingWallet.findMany({
      where: { userId },
      orderBy: [{ isActive: 'desc' }, { createdAt: 'asc' }],
      select: {
        id: true,
        name: true,
        publicKey: true,
        isActive: true,
        createdAt: true,
      },
    })

    if (wallets.length === 0) {
      const activeWallet = await this.getActivePersonalTradingWallet(userId)
      if (!activeWallet) {
        return []
      }

      wallets = [
        {
          id: activeWallet.id,
          name: activeWallet.name,
          publicKey: activeWallet.publicKey,
          isActive: true,
          createdAt: new Date(),
        },
      ]
    }

    return wallets
  }

  public async createPersonalTradingWallet(userId: string, name?: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true },
    })

    if (!user) {
      return null
    }

    const existingWallets = await this.listPersonalTradingWallets(userId)
    const { publicKey, privateKey } = this.createWallet.create()
    const walletName = name?.trim() || `Wallet ${existingWallets.length + 1}`
    const shouldBeActive = existingWallets.length === 0

    const createdWallet = await prisma.personalTradingWallet.create({
      data: {
        userId,
        name: walletName,
        publicKey,
        privateKey,
        isActive: shouldBeActive,
      },
      select: {
        id: true,
        name: true,
        publicKey: true,
        privateKey: true,
        isActive: true,
      },
    })

    if (shouldBeActive) {
      await this.syncLegacyPersonalWallet(userId, createdWallet.publicKey, createdWallet.privateKey)
    }

    return createdWallet
  }

  public async setActivePersonalTradingWallet(userId: string, walletId: string) {
    const wallet = await prisma.personalTradingWallet.findFirst({
      where: {
        id: walletId,
        userId,
      },
      select: {
        id: true,
        name: true,
        publicKey: true,
        privateKey: true,
        isActive: true,
      },
    })

    if (!wallet) {
      return null
    }

    if (wallet.isActive) {
      return wallet
    }

    await prisma.$transaction([
      prisma.personalTradingWallet.updateMany({
        where: { userId },
        data: { isActive: false },
      }),
      prisma.personalTradingWallet.update({
        where: { id: walletId },
        data: { isActive: true },
      }),
      prisma.user.update({
        where: { id: userId },
        data: {
          personalWalletPubKey: wallet.publicKey,
          personalWalletPrivKey: wallet.privateKey,
        },
      }),
    ])

    return {
      ...wallet,
      isActive: true,
    }
  }

  public async hasDonated(userId: string) {
    try {
      const buyCode = await prisma.user.update({
        where: {
          id: userId,
        },
        data: {
          hasDonated: true,
        },
      })

      return buyCode
    } catch (error) {
      console.log('BUY_SOURCE_CODE_ERROR')
      return
    }
  }

  public async getUsersWithDue() {
    try {
      const today = new Date()
      today.setHours(23, 59, 59, 999)

      const usersToCharge = await prisma.userSubscription.findMany({
        where: {
          subscriptionCurrentPeriodEnd: {
            lte: today,
          },
          isCanceled: false,
          plan: {
            not: 'FREE',
          },
        },
      })

      return usersToCharge
    } catch (error) {
      console.log('GET_USERS_TO_CHARGE_ERROR', error)
      return []
    }
  }

  public async getUsersWithEndingTomorrow() {
    try {
      const tomorrow = new Date()
      tomorrow.setDate(tomorrow.getDate() + 1)
      tomorrow.setHours(0, 0, 0, 0) // Reset time to start of day

      const usersToRenew = await prisma.userSubscription.findMany({
        where: {
          subscriptionCurrentPeriodEnd: {
            equals: tomorrow,
          },
          isCanceled: false,
          plan: {
            not: 'FREE',
          },
        },
        select: {
          plan: true,
          id: true,
          userId: true,
          user: {
            select: {
              username: true,
            },
          },
        },
      })

      return usersToRenew
    } catch (error) {
      console.log('GET_USERS_WITH_ENDING_TOMORROW_ERROR', error)
      return []
    }
  }

  public async updateUserHandiCatStatus(
    userId: string,
  ): Promise<{ status: string; message: string; changedStatus: 'NONE' | 'ACTIVE' | 'PAUSED' }> {
    try {
      const currentStatus = await prisma.user.findFirst({
        where: {
          id: userId,
        },
        select: {
          botStatus: true,
        },
      })

      const newStatus = currentStatus?.botStatus === 'ACTIVE' ? 'PAUSED' : 'ACTIVE'

      const updatedStatus = await prisma.user.update({
        where: {
          id: userId,
        },
        data: {
          botStatus: newStatus,
        },
      })

      return { status: 'ok', message: 'status updated', changedStatus: newStatus }
    } catch (error) {
      console.log('UPDATE_HANDICAT_STATUS_ERROR', error)
      return { status: 'error', message: 'An error occurred while updating foilops status', changedStatus: 'NONE' }
    }
  }

  public async showUserPrivateKey(userId: string) {
    try {
      const wallet = await this.getActivePersonalTradingWallet(userId)

      if (!wallet) {
        console.log('Failed to retrieve user private key')
        return
      }

      const trimmedPrivateKey = wallet.privateKey.replace(/=*$/, '')

      return trimmedPrivateKey
    } catch (error) {
      console.log('SHOW_PRIVATE_KEY_ERROR')
      return
    }
  }

  public async getFreeUsers() {
    try {
      const freeUsers = await prisma.user.findMany({
        where: {
          AND: [
            {
              OR: [{ userSubscription: null }, { userSubscription: { plan: 'FREE' } }],
            },
            { userPromotions: { none: {} } },
          ],
        },
      })

      return freeUsers
    } catch (error) {
      console.log('GET_FREE_USERS_ERROR')
      return
    }
  }

  public async getPausedUsers(userIds: string[]) {
    try {
      const pausedUsers = await prisma.user.findMany({
        where: {
          id: {
            in: userIds,
          },
          NOT: {
            botStatus: 'ACTIVE',
          },
        },
        select: {
          id: true,
        },
      })

      return pausedUsers.map((user) => user.id)
    } catch (error) {
      console.log('GET_PAUSED_USERS_ERROR')
      return
    }
  }

  public async getBotStatus(userId: string) {
    try {
      const botStatus = await prisma.user.findUnique({
        where: {
          id: userId,
        },
        select: {
          botStatus: true,
        },
      })

      return botStatus
    } catch (error) {
      console.log('GET_PAUSED_USERS_ERROR')
      return
    }
  }

  private async getActivePersonalTradingWallet(userId: string): Promise<ActivePersonalWallet | null> {
    const activeWallet = await prisma.personalTradingWallet.findFirst({
      where: {
        userId,
        isActive: true,
      },
      orderBy: {
        createdAt: 'asc',
      },
      select: {
        id: true,
        name: true,
        publicKey: true,
        privateKey: true,
        isActive: true,
      },
    })

    if (activeWallet) {
      return activeWallet
    }

    const firstWallet = await prisma.personalTradingWallet.findFirst({
      where: { userId },
      orderBy: {
        createdAt: 'asc',
      },
      select: {
        id: true,
        name: true,
        publicKey: true,
        privateKey: true,
        isActive: true,
      },
    })

    if (firstWallet) {
      await prisma.$transaction([
        prisma.personalTradingWallet.update({
          where: { id: firstWallet.id },
          data: { isActive: true },
        }),
        prisma.user.update({
          where: { id: userId },
          data: {
            personalWalletPubKey: firstWallet.publicKey,
            personalWalletPrivKey: firstWallet.privateKey,
          },
        }),
      ])

      return {
        ...firstWallet,
        isActive: true,
      }
    }

    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        personalWalletPubKey: true,
        personalWalletPrivKey: true,
      },
    })

    if (!user) {
      return null
    }

    return prisma.personalTradingWallet.create({
      data: {
        userId,
        name: 'Wallet 1',
        publicKey: user.personalWalletPubKey,
        privateKey: user.personalWalletPrivKey,
        isActive: true,
      },
      select: {
        id: true,
        name: true,
        publicKey: true,
        privateKey: true,
        isActive: true,
      },
    })
  }

  private async syncLegacyPersonalWallet(userId: string, publicKey: string, privateKey: string) {
    await prisma.user.update({
      where: { id: userId },
      data: {
        personalWalletPubKey: publicKey,
        personalWalletPrivKey: privateKey,
      },
    })
  }
}
