import { describe, expect, it } from 'vitest'
import { renderHomepageHtml } from '../src/lib/homepage'

describe('homepage renderer', () => {
  it('renders the public homepage with logo and login call to action', () => {
    const html = renderHomepageHtml()

    expect(html).toContain('FoilOps maps wallets before the market catches up.')
    expect(html).toContain('/showcase/FoilOps_banner.jpeg')
    expect(html).toContain('/showcase/FoilOps_Start_Menu.jpeg')
    expect(html).toContain('Operator Login')
    expect(html).toContain('Scam Intelligence')
    expect(html).toContain('Trading Ops Command Surface')
  })
})
