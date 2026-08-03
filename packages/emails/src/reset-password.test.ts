import { describe, expect, it } from 'vitest'
import { renderResetPassword } from './index'

describe('renderResetPassword', () => {
  it('renders HTML containing the reset url', async () => {
    const { html } = await renderResetPassword({
      url: 'https://app.example/reset?token=ABC123',
    })
    expect(html).toContain('https://app.example/reset?token=ABC123')
    expect(html.toLowerCase()).toContain('<html') // it's an HTML email
  })

  it('renders a non-empty plain-text fallback containing the url', async () => {
    const { text } = await renderResetPassword({
      url: 'https://app.example/reset?token=ABC123',
    })
    expect(text.length).toBeGreaterThan(0)
    expect(text).toContain('https://app.example/reset?token=ABC123')
    expect(text.toLowerCase()).not.toContain('<html') // plain text, not markup
  })
})
