import { describe, expect, it } from 'vitest'
import { deriveSlug, tagWarnings, tagWeight } from '@/lib/faq/tags'

/**
 * Pure rules, so they are tested directly rather than through a route: they
 * exist to be run against every keystroke in the browser, and the thing worth
 * pinning down is the rule itself, not how the editor calls it.
 */
describe('what a trigger word is worth', () => {
  it('is its length, which is what the ranking sums', () => {
    expect(tagWeight('เปิด')).toBe(4)
    expect(tagWeight('hours')).toBe(5)
  })

  it('ignores the spaces around it', () => {
    expect(tagWeight('  wifi ')).toBe(4)
  })
})

describe('warning about a trigger word that will misfire', () => {
  const others = [
    { id: 'a', question: 'ร้านอยู่ที่ไหน', tags: ['ที่ไหน', 'address'], isActive: true },
    { id: 'b', question: 'มีนมทางเลือกไหม', tags: ['นมโอ๊ต', 'milk'], isActive: true },
    { id: 'c', question: 'โปรปีใหม่', tags: ['โปร'], isActive: false },
  ]

  it('flags a Thai particle short enough to sit inside any sentence', () => {
    const warnings = tagWarnings('x', ['ไป'], others)

    expect(warnings).toHaveLength(1)
    expect(warnings[0].kind).toBe('short')
    expect(warnings[0].tag).toBe('ไป')
  })

  it('leaves a three-character Thai word alone', () => {
    expect(tagWarnings('x', ['เมนู'], others)).toEqual([])
    expect(tagWarnings('x', ['หมา'], others)).toEqual([])
  })

  it('flags a word that is long enough but is about nothing', () => {
    // 'ทาง' -- "way" -- is three characters, so the length floor lets it
    // through. It is the other half of the pair a migration had to strip.
    expect(tagWarnings('x', ['ทาง'], others).map((w) => w.kind)).toEqual(['short'])
    expect(tagWarnings('x', ['what'], others).map((w) => w.kind)).toEqual(['short'])
  })

  it('applies the same floor to Latin, where the match is a substring too', () => {
    expect(tagWarnings('x', ['go'], others).map((w) => w.kind)).toEqual(['short'])
    expect(tagWarnings('x', ['pay'], others)).toEqual([])
  })

  it('flags a word another live answer already claims', () => {
    const warnings = tagWarnings('x', ['address'], others)

    expect(warnings).toHaveLength(1)
    expect(warnings[0].kind).toBe('collision')
    expect(warnings[0].message).toContain('ร้านอยู่ที่ไหน')
  })

  it('flags a word that swallows another answer’s, not just an exact repeat', () => {
    // 'นม' is inside 'นมโอ๊ต', so a customer asking about oat milk feeds both.
    const warnings = tagWarnings('x', ['นม'], others)

    expect(warnings.map((w) => w.kind)).toContain('collision')
  })

  it('says nothing about an answer the bot cannot see', () => {
    expect(tagWarnings('x', ['โปร'], others)).toEqual([])
  })

  it('does not warn about the answer being edited colliding with itself', () => {
    expect(tagWarnings('a', ['address'], others)).toEqual([])
  })
})

describe('naming an answer so the bot can ask for its picture', () => {
  it('derives a name from an English question', () => {
    expect(deriveSlug('What is on the menu?', [])).toBe('what-is-on-the-menu')
  })

  it('still produces a usable name for a question written only in Thai', () => {
    const slug = deriveSlug('เมนูแนะนำมีอะไรบ้าง', [])

    expect(slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/)
    expect(slug.length).toBeGreaterThanOrEqual(2)
  })

  it('steps aside from a name already in use', () => {
    expect(deriveSlug('menu', ['menu'])).toBe('menu-2')
    expect(deriveSlug('menu', ['menu', 'menu-2'])).toBe('menu-3')
  })

  it('never exceeds what the column accepts', () => {
    expect(deriveSlug('a'.repeat(90), []).length).toBeLessThanOrEqual(40)
  })
})
