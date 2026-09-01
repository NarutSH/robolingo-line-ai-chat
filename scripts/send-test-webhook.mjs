#!/usr/bin/env node
/**
 * Posts a correctly-signed LINE webhook to a running instance, so the inbound
 * path can be exercised without a phone.
 *
 *   bun scripts/send-test-webhook.mjs "ราคาเท่าไหร่ครับ" [userId] [url]
 *
 * Signature must be computed over the exact bytes that are sent, which is why
 * the body is serialised once and reused for both the HMAC and the POST.
 */
import { createHmac, randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'

function loadEnv(file = '.env.local') {
  const out = {}
  try {
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/)
      if (m) out[m[1]] = m[2]
    }
  } catch {
    /* fall back to process.env */
  }
  return { ...out, ...process.env }
}

const env = loadEnv()
const secret = env.LINE_CHANNEL_SECRET
if (!secret) {
  console.error('LINE_CHANNEL_SECRET is not set')
  process.exit(1)
}

const text = process.argv[2] ?? 'สวัสดีครับ'
const userId = process.argv[3] ?? 'Utestuser00000000000000000000001'
const url = process.argv[4] ?? 'http://127.0.0.1:3000/api/line/webhook'

const body = JSON.stringify({
  destination: 'Uoaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  events: [
    {
      type: 'message',
      mode: 'active',
      timestamp: Date.now(),
      webhookEventId: `01TEST${randomUUID().replace(/-/g, '').toUpperCase().slice(0, 20)}`,
      deliveryContext: { isRedelivery: false },
      source: { type: 'user', userId },
      replyToken: randomUUID().replace(/-/g, ''),
      message: { type: 'text', id: String(Date.now()), text, quoteToken: 'q' },
    },
  ],
})

const signature = createHmac('SHA256', secret).update(body).digest('base64')

const res = await fetch(url, {
  method: 'POST',
  headers: { 'content-type': 'application/json', 'x-line-signature': signature },
  body,
})

console.log(`${res.status} ${res.statusText} — ${await res.text()}`)
process.exit(res.ok ? 0 : 1)
