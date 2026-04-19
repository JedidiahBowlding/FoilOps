import { describe, expect, it } from 'vitest'
import { renderHomepageHtml } from '../src/lib/homepage'

describe('homepage renderer', () => {
  it('renders the public homepage with logo and login call to action', () => {
    const html = renderHomepageHtml()

    expect(html).toContain('FoilOps watches wallets before traders react.')
    expect(html).toContain('/showcase/logo.jpg')
    expect(html).toContain('Login to Dashboard')
    expect(html).toContain('Scam Intelligence Dashboard')
    expect(html).toContain('Trading Ops Dashboard')
  })
})
