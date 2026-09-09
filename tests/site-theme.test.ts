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
    expect(html).toContain("target.closest('a[href]')")
    expect(html).toContain('.fx-header-actions .fx-raw-data { display:none; }')
  })

  it('adds shared brand assets and keeps protected pages out of search results', () => {
    const html = renderFuturisticPage({ title: 'Protected', contentHtml: '<p>Content</p>' })

    expect(html).toContain('rel="icon" href="/favicon.svg"')
    expect(html).toContain('<img src="/favicon.svg" alt="" width="34" height="34" />')
    expect(html).toContain('<span class="fx-logo-foil">FOIL</span><span class="fx-logo-ops">OPS</span>')
    expect(html).toContain('rel="manifest" href="/site.webmanifest"')
    expect(html).toContain('name="robots" content="noindex, nofollow, noarchive"')
    expect(html).not.toContain('rel="canonical"')
  })

  it('renders canonical and social metadata for an indexable public page', () => {
    const html = renderFuturisticPage({ title: 'Public', description: 'Public description', canonicalPath: '/', indexable: true, contentHtml: '<p>Content</p>' })

    expect(html).toContain('name="description" content="Public description"')
    expect(html).toContain('rel="canonical" href="https://foilops.com/"')
    expect(html).toContain('property="og:title" content="Public"')
    expect(html).toContain('name="twitter:card" content="summary_large_image"')
    expect(html).toContain('type="application/ld+json"')
  })
})
