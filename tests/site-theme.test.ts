import { describe, expect, it } from 'vitest'
import { renderFuturisticPage } from '../src/lib/site-theme'

describe('responsive site navigation', () => {
  it('renders an accessible floating mobile menu', () => {
    const html = renderFuturisticPage({ title: 'Test', activeNav: 'home', contentHtml: '<p>Content</p>' })

    expect(html).toContain('class="fx-menu-toggle"')
    expect(html).toContain('aria-controls="site-navigation"')
    expect(html).toContain('aria-expanded="false"')
    expect(html).toContain('@media (max-width: 720px)')
    expect(html).toContain("event.key === 'Escape'")
    expect(html).toContain("backdrop?.addEventListener('click', closeMenu)")
  })
})
