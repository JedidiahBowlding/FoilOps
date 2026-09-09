type Tone = 'success' | 'warning' | 'danger' | 'neutral' | 'info'

const escapeHtml = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!)

export function StatusBadge(label: unknown, tone: Tone = 'neutral', icon = ''): string {
  return `<span class="ui-status ui-status--${tone}">${icon ? `<span aria-hidden="true">${escapeHtml(icon)}</span>` : ''}<span>${escapeHtml(label)}</span></span>`
}

export function MetricCard(input: { label: string; value: unknown; detail?: string; tone?: Tone; icon?: string; raw?: unknown }): string {
  return `<article class="ui-metric ui-metric--${input.tone || 'neutral'}"><div class="ui-metric__head"><span>${escapeHtml(input.label)}</span>${input.icon ? `<i aria-hidden="true">${escapeHtml(input.icon)}</i>` : ''}</div><strong>${escapeHtml(input.value)}</strong>${input.detail ? `<small>${escapeHtml(input.detail)}</small>` : ''}${input.raw !== undefined ? `<details><summary>Exact value</summary><code>${escapeHtml(input.raw)}</code></details>` : ''}</article>`
}

export function NetworkBadge(network: string): string { return StatusBadge(network, 'info', '◆') }

export function RiskCheck(input: { label: string; state: 'passed' | 'warning' | 'blocked' | 'pending'; detail?: string }): string {
  const icon = input.state === 'passed' ? '✓' : input.state === 'blocked' ? '×' : input.state === 'warning' ? '!' : '·'
  return `<div class="ui-risk-check ui-risk-check--${input.state}"><span aria-hidden="true">${icon}</span><div><strong>${escapeHtml(input.label)}</strong>${input.detail ? `<small>${escapeHtml(input.detail)}</small>` : ''}</div></div>`
}

export function ExecutionTimeline(activeStep: number): string {
  const steps = ['Configure order', 'Verify contract', 'Review simulation', 'Enable Auto Buy', 'ARM order', 'Execution status']
  return `<ol class="ui-timeline">${steps.map((step, index) => `<li class="${index < activeStep ? 'complete' : index === activeStep ? 'active' : ''}"><span>${index < activeStep ? '✓' : index + 1}</span><b>${escapeHtml(step)}</b></li>`).join('')}</ol>`
}

export function OrderSummary(input: { action: string; network: string; mode: string; status: string }): string {
  return `<section class="ui-order-summary"><div><p>Order intent</p><h2>${escapeHtml(input.action)}</h2><div class="ui-order-summary__meta">${NetworkBadge(input.network)}${StatusBadge(input.mode, 'neutral')}${StatusBadge(input.status, input.status === 'Blocked' ? 'danger' : 'info')}</div></div></section>`
}

export function AssetSelector(input: { id: string; label: string; value?: string; placeholder?: string }): string {
  return `<label class="ui-field"><span>${escapeHtml(input.label)}</span><input id="${escapeHtml(input.id)}" value="${escapeHtml(input.value || '')}" placeholder="${escapeHtml(input.placeholder || '')}" autocomplete="off"></label>`
}

export function AdvancedDetailsDrawer(summary: string, content: string): string { return `<details class="ui-drawer"><summary>${escapeHtml(summary)}</summary><div>${content}</div></details>` }
export function ConfirmationPanel(content: string): string { return `<aside class="ui-confirmation">${content}</aside>` }
export function ActivityFeed(items: Array<{ title: string; detail?: string; time?: string; tone?: Tone }>): string { return `<div class="ui-activity">${items.map((item) => `<div class="ui-activity__item ui-activity__item--${item.tone || 'neutral'}"><i></i><div><strong>${escapeHtml(item.title)}</strong>${item.detail ? `<small>${escapeHtml(item.detail)}</small>` : ''}</div>${item.time ? `<time>${escapeHtml(item.time)}</time>` : ''}</div>`).join('')}</div>` }

