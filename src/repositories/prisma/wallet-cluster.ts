import prisma from '../../providers/prisma'

export type ClusterBehavior = {
  sharedFundingSources: string[]
  repeatedInteractionPatterns: string[]
  flowOverlaps: string[]
  deploymentRelationships: string[]
}

export class PrismaWalletClusterRepository {
  async createCluster(input: {
    wallets: string[]
    clusterScore: number
    riskScore: number
    behavior: ClusterBehavior
  }) {
    return prisma.walletCluster.create({
      data: {
        wallets: input.wallets,
        clusterScore: input.clusterScore,
        riskScore: input.riskScore,
        metadata: input.behavior,
      },
    })
  }

  async findClustersByWallet(wallet: string) {
    const clusters = await prisma.walletCluster.findMany({
      where: {
        wallets: {
          has: wallet,
        },
      },
      orderBy: {
        updatedAt: 'desc',
      },
      take: 10,
    })

    return clusters
  }

  async latestClusterByWallet(wallet: string) {
    return prisma.walletCluster.findFirst({
      where: {
        wallets: {
          has: wallet,
        },
      },
      orderBy: {
        updatedAt: 'desc',
      },
    })
  }
}
