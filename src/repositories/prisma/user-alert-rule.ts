import { AlertEventType } from '@prisma/client'
import prisma from '../../providers/prisma'

export type AlertRuleDeliveryShape = {
  id: string
  userId: string
  minRiskScore: number
  minTransactionSize: number
  eventTypes: AlertEventType[]
}

export class PrismaUserAlertRuleRepository {
  async setRule(
    userId: string,
    input: { minRiskScore: number; minTransactionSize: number; eventTypes: AlertEventType[] },
  ) {
    const existing = await prisma.userAlertRule.findFirst({ where: { userId } })

    if (!existing) {
      return prisma.userAlertRule.create({
        data: {
          userId,
          minRiskScore: input.minRiskScore,
          minTransactionSize: input.minTransactionSize,
          eventTypes: input.eventTypes,
        },
      })
    }

    return prisma.userAlertRule.update({
      where: { id: existing.id },
      data: {
        minRiskScore: input.minRiskScore,
        minTransactionSize: input.minTransactionSize,
        eventTypes: input.eventTypes,
      },
    })
  }

  async listRules(userId: string) {
    return prisma.userAlertRule.findMany({ where: { userId }, orderBy: { updatedAt: 'desc' } })
  }

  async deleteRule(userId: string, ruleId: string) {
    const existing = await prisma.userAlertRule.findFirst({ where: { id: ruleId, userId } })
    if (!existing) return null

    return prisma.userAlertRule.delete({ where: { id: ruleId } })
  }

  async getUserRule(userId: string) {
    return prisma.userAlertRule.findFirst({ where: { userId } })
  }

  async listAllRules() {
    return prisma.userAlertRule.findMany()
  }

  async listAllRulesForDelivery(): Promise<AlertRuleDeliveryShape[]> {
    const rules = await prisma.userAlertRule.findMany({
      select: {
        id: true,
        userId: true,
        minRiskScore: true,
        minTransactionSize: true,
        eventTypes: true,
      },
    })

    return rules
  }
}
