import { describe, expect, it } from 'vitest'
import { searchFaq } from '@/lib/data/faq'

/**
 * This sits below the route seam on purpose. The ranking rule lives in SQL, no
 * route reaches it yet, and it is exactly the kind of thing that rots silently:
 * one careless tag and every question starts matching the same entry. Once the
 * agent ships, the FAQ is also exercised through the webhook.
 */
describe('looking up the shop FAQ', () => {
  it('answers an unsegmented Thai question', async () => {
    const matches = await searchFaq('เปิดกี่โมง')

    expect(matches.length).toBeGreaterThan(0)
    expect(matches[0].question).toBe('เปิดกี่โมง')
    expect(matches[0].answer).toContain('07:00')
  })

  it('answers the same question asked in English', async () => {
    const matches = await searchFaq('what time do you open')

    expect(matches.length).toBeGreaterThan(0)
    expect(matches[0].question).toBe('เปิดกี่โมง')
  })

  it('finds an entry from a keyword buried mid-sentence', async () => {
    const matches = await searchFaq('ขอรหัส wifi หน่อยครับ')

    expect(matches[0].question).toBe('มี wifi ไหม')
  })

  it('is not dragged off by a common Thai particle', async () => {
    // 'ไป' — "go" — is a substring of almost any Thai sentence. When tags were
    // scored by count rather than length it tied with a real match and the
    // location entry won on sort order.
    const matches = await searchFaq('พาหมาไปได้ไหม')

    expect(matches[0].question).toBe('พาสัตว์เลี้ยงเข้าได้ไหม')
    expect(matches.map((m) => m.question)).not.toContain('ร้านอยู่ที่ไหน')
  })

  it('returns nothing at all when the shop has no answer', async () => {
    expect(await searchFaq('ขอสูตรทำระเบิด')).toEqual([])
    expect(await searchFaq('   ')).toEqual([])
  })

  it('never returns more than it was asked for', async () => {
    const matches = await searchFaq('กาแฟ ราคา เมนู wifi จอดรถ', 2)

    expect(matches.length).toBeLessThanOrEqual(2)
  })
})
