import { Prisma } from '@prisma/client'
import prisma from '../../providers/prisma'
import type { AutoBuyAudit, AutoBuyOrder, AutoBuyStore } from './types'

const normalize = (row: any): AutoBuyOrder => row as AutoBuyOrder

export class OrderStateStore implements AutoBuyStore {
  async create(input: any) { return normalize(await prisma.liquidityAutoBuyOrder.create({ data: input })) }
  async get(id: string) { const row = await prisma.liquidityAutoBuyOrder.findUnique({ where: { id } }); return row ? normalize(row) : null }
  async list() { return (await prisma.liquidityAutoBuyOrder.findMany({ orderBy: { createdAt: 'desc' }, take: 100 })).map(normalize) }
  async update(id: string, data: Partial<AutoBuyOrder>) { return normalize(await prisma.liquidityAutoBuyOrder.update({ where: { id }, data: data as any })) }
  async claimExecution(id: string) {
    const result = await prisma.liquidityAutoBuyOrder.updateMany({ where: { id, state: 'VALIDATING', transactionHash: null }, data: { state: 'EXECUTING', executionAttempts: { increment: 1 } } })
    return result.count === 1
  }
  async recoverInterrupted() {
    await prisma.liquidityAutoBuyOrder.updateMany({ where: { state: { in: ['MONITORING','LIQUIDITY_DETECTED','VALIDATING'] } }, data: { state: 'ARMED', lastReason: 'Application restarted; monitoring resumed safely' } })
    await prisma.liquidityAutoBuyOrder.updateMany({ where: { state: 'EXECUTING', transactionHash: null }, data: { state: 'FAILED', lastReason: 'Application restarted during execution; manual transaction reconciliation required' } })
  }
  async getControl(){return prisma.liquidityAutoBuyControl.upsert({where:{id:'global'},create:{id:'global',enabled:false,changedBy:'safe-default'},update:{},select:{enabled:true}})}
  async setControl(enabled:boolean,changedBy:string){return prisma.liquidityAutoBuyControl.upsert({where:{id:'global'},create:{id:'global',enabled,changedBy},update:{enabled,changedBy},select:{enabled:true}})}
}

export class AuditLogger implements AutoBuyAudit {
  async record(orderId: string, eventType: string, message: string, metadata?: Record<string, unknown>) {
    await prisma.liquidityAutoBuyAudit.create({ data: { orderId, eventType, message: message.slice(0, 500), metadata: metadata as Prisma.InputJsonValue|undefined } })
  }
  async list(orderId: string) { return prisma.liquidityAutoBuyAudit.findMany({ where: { orderId }, orderBy: { createdAt: 'desc' }, take: 250 }) }
}
