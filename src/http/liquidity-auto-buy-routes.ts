import type { Express, RequestHandler } from 'express'
import type { LiquidityAutoBuyService } from '../lib/liquidity-auto-buy/service'

export function registerLiquidityAutoBuyRoutes(app:Express,auth:RequestHandler,expensive:RequestHandler,service:LiquidityAutoBuyService){
  app.get('/api/liquidity-auto-buy/status',auth,(_req,res)=>res.json(service.status()))
  app.get('/api/liquidity-auto-buy/orders',auth,async(_req,res)=>res.json({orders:await service.list()}))
  app.get('/api/liquidity-auto-buy/orders/:id/audit',auth,async(req,res)=>{try{res.json({events:await service.history(req.params.id)})}catch(error){res.status(404).json({message:error instanceof Error?error.message:'Order not found'})}})
  app.post('/api/liquidity-auto-buy/orders',auth,expensive,async(req,res)=>{try{res.status(201).json(await service.create(req.body||{}))}catch(error){res.status(400).json({message:error instanceof Error?error.message:'Could not create auto-buy draft'})}})
  app.post('/api/liquidity-auto-buy/orders/:id/arm',auth,async(req,res)=>{try{res.json(await service.arm(req.params.id))}catch(error){res.status(400).json({message:error instanceof Error?error.message:'Could not arm order'})}})
  app.post('/api/liquidity-auto-buy/orders/:id/cancel',auth,async(req,res)=>{try{res.json(await service.cancel(req.params.id))}catch(error){res.status(400).json({message:error instanceof Error?error.message:'Could not cancel order'})}})
}
