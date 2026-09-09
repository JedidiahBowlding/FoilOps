import express from 'express'
import request from 'supertest'
import { describe, expect, it, vi } from 'vitest'
import { registerLiquidityAutoBuyRoutes } from '../src/http/liquidity-auto-buy-routes'

describe('liquidity auto-buy authenticated API',()=>{
  it('protects routes and exposes draft/arm/cancel lifecycle',async()=>{
    const service:any={status:()=>({enabled:false}),list:vi.fn(async()=>[]),history:vi.fn(async()=>[]),create:vi.fn(async()=>({id:'one',state:'DRAFT'})),arm:vi.fn(async()=>({id:'one',state:'ARMED'})),cancel:vi.fn(async()=>({id:'one',state:'CANCELLED'}))}
    const app=express();app.use(express.json())
    const auth:any=(req:any,res:any,next:any)=>req.get('authorization')==='test'?next():res.sendStatus(401)
    registerLiquidityAutoBuyRoutes(app,auth,(_req,_res,next)=>next(),service)
    await request(app).get('/api/liquidity-auto-buy/orders').expect(401)
    await request(app).post('/api/liquidity-auto-buy/orders').set('authorization','test').send({tokenAddress:'exact'}).expect(201).expect(r=>expect(r.body.state).toBe('DRAFT'))
    await request(app).post('/api/liquidity-auto-buy/orders/one/arm').set('authorization','test').expect(200).expect(r=>expect(r.body.state).toBe('ARMED'))
    await request(app).post('/api/liquidity-auto-buy/orders/one/cancel').set('authorization','test').expect(200).expect(r=>expect(r.body.state).toBe('CANCELLED'))
  })
})
