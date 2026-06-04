import { test } from 'node:test'
import assert from 'node:assert/strict'
import { renderLeaveEmail } from '../src/utils/leaveEmailTemplate.js'

test('returns both html and text strings', () => {
  const { html, text } = renderLeaveEmail({ title: 'Leave Request Approved' })
  assert.equal(typeof html, 'string')
  assert.equal(typeof text, 'string')
  assert.ok(html.includes('Leave Request Approved'))
  assert.ok(text.includes('Leave Request Approved'))
})

test('renders detail rows in both html and text', () => {
  const { html, text } = renderLeaveEmail({
    title: 'Leave Request Approved',
    details: [
      { label: 'Reference', value: 'LV-2026-00096' },
      { label: 'Type', value: 'Annual' },
      { label: 'Days', value: '13 days' }
    ]
  })
  for (const v of ['Reference', 'LV-2026-00096', 'Type', 'Annual', 'Days', '13 days']) {
    assert.ok(html.includes(v), `html missing ${v}`)
  }
  assert.ok(text.includes('Reference: LV-2026-00096'))
  assert.ok(text.includes('Type: Annual'))
})

test('missing detail value renders as em dash', () => {
  const { html, text } = renderLeaveEmail({ details: [{ label: 'Type', value: null }] })
  assert.ok(html.includes('—'))
  assert.ok(text.includes('Type: —'))
})

test('includes greeting and intro lines and reason', () => {
  const { html, text } = renderLeaveEmail({
    title: 'Leave Request Rejected',
    greeting: 'Dear Syed Zia,',
    introLines: ['Your leave request has been rejected by the CEO.'],
    reason: 'Going to Karbala'
  })
  assert.ok(html.includes('Dear Syed Zia,'))
  assert.ok(html.includes('rejected by the CEO'))
  assert.ok(html.includes('Going to Karbala'))
  assert.ok(text.includes('Dear Syed Zia,'))
  assert.ok(text.includes('Going to Karbala'))
})

test('escapes HTML in values to prevent broken layout / injection', () => {
  const { html } = renderLeaveEmail({
    greeting: 'Dear <b>X</b>,',
    reason: '<script>alert(1)</script>',
    details: [{ label: 'Type', value: '<img src=x>' }]
  })
  assert.ok(!html.includes('<script>'))
  assert.ok(html.includes('&lt;script&gt;'))
  assert.ok(!html.includes('<img src=x>'))
})

test('accent maps to a color in html', () => {
  const green = renderLeaveEmail({ title: 'Approved', accent: 'green' }).html
  const red = renderLeaveEmail({ title: 'Rejected', accent: 'red' }).html
  assert.notEqual(green, red)
  assert.ok(/#16a34a/i.test(green))
  assert.ok(/#dc2626/i.test(red))
})
