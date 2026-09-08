import type { Request, RequestHandler } from 'express'

type Bucket = { count: number; resetAt: number }

function clientAddress(req: Request): string {
  const socketAddress = req.socket.remoteAddress || ''
  const proxyAddress = req.get('x-real-ip')?.trim()
  if ((socketAddress === '127.0.0.1' || socketAddress === '::1' || socketAddress === '::ffff:127.0.0.1') && proxyAddress) {
    return proxyAddress
  }
  return socketAddress || req.ip || 'unknown'
}

export function requireSameOrigin(): RequestHandler {
  return (req, res, next) => {
    if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next()
    const fetchSite = req.get('sec-fetch-site')
    if (fetchSite === 'cross-site') return void res.status(403).json({ message: 'Cross-site request rejected' })
    const origin = req.get('origin')
    if (!origin) return next()
    try {
      const expectedHost = req.get('host')
      if (!expectedHost || new URL(origin).host !== expectedHost) {
        return void res.status(403).json({ message: 'Origin validation failed' })
      }
    } catch {
      return void res.status(403).json({ message: 'Origin validation failed' })
    }
    next()
  }
}

export function rateLimit(options: { windowMs: number; max: number; label: string }): RequestHandler {
  const buckets = new Map<string, Bucket>()
  return (req, res, next) => {
    const now = Date.now()
    const key = `${clientAddress(req)}:${options.label}`
    const current = buckets.get(key)
    const bucket = !current || current.resetAt <= now ? { count: 0, resetAt: now + options.windowMs } : current
    bucket.count += 1
    buckets.set(key, bucket)
    res.setHeader('RateLimit-Limit', String(options.max))
    res.setHeader('RateLimit-Remaining', String(Math.max(0, options.max - bucket.count)))
    if (bucket.count > options.max) {
      res.setHeader('Retry-After', String(Math.ceil((bucket.resetAt - now) / 1000)))
      return void res.status(429).json({ message: 'Too many requests; try again shortly' })
    }
    if (buckets.size > 10_000) {
      for (const [bucketKey, value] of buckets) if (value.resetAt <= now) buckets.delete(bucketKey)
    }
    next()
  }
}
