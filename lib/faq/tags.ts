/**
 * The rules the training board applies to a trigger word, and the name it
 * derives for a picture.
 *
 * Deliberately free of `server-only` and of any import that reaches the
 * database: these run against every keystroke in the operator's browser. They
 * describe consequences of `search_faq`'s ranking rather than reimplementing it
 * — what a word is worth, and which words will fight each other — so the
 * function in SQL stays the only thing that decides an answer.
 */

/**
 * Two characters is where a tag stops being a word and starts being a fragment.
 * The threshold is the same on both sides: Thai is denser per character but is
 * also written without spaces, and the two effects cancel closely enough that a
 * second constant would be false precision.
 */
const SHORTEST_TAG = 3

/**
 * Words that are the wrong length to be caught by the rule above and still ruin
 * a ranking, because they carry no subject at all.
 *
 * `ไป` and `ทาง` are here by name because a migration exists purely to strip
 * them from every entry: "go" and "way" sit inside almost any Thai sentence, and
 * one of them dragged the location answer into a question about dogs. `ทาง` is
 * three characters, so length alone would have let it through — which is the
 * whole reason this list exists beside the threshold rather than instead of it.
 *
 * Everything here is a function word: a particle, a pronoun, a politeness
 * marker. A three-letter noun like `car` or `หมา` is short but is *about*
 * something, and belongs in an entry's tags.
 */
const CARRIES_NO_SUBJECT = new Set([
  'ไป', 'มา', 'ทาง', 'ได้', 'ไหม', 'มี', 'ที่', 'การ', 'ความ', 'นี้', 'นั้น',
  'อะไร', 'ครับ', 'ค่ะ', 'คะ', 'จะ', 'ให้',
  'the', 'and', 'for', 'you', 'can', 'how', 'what', 'this', 'that', 'with',
  'have', 'please', 'want', 'need',
])

/** The shape a picture handle has to take, in the one place that decides it. */
export const SLUG_PATTERN = /^[a-z0-9]+(-[a-z0-9]+)*$/
export const SLUG_MAX_LENGTH = 40

export interface TagNeighbour {
  id: string
  question: string
  tags: string[]
  isActive: boolean
}

export type TagWarning = {
  tag: string
  kind: 'short' | 'collision'
  message: string
}

/**
 * What a trigger word contributes when it matches. The ranking sums the lengths
 * of the tags that matched, so this is the score itself, not a proxy for it.
 */
export function tagWeight(tag: string): number {
  return tag.trim().length
}

function overlaps(a: string, b: string): boolean {
  const left = a.toLowerCase()
  const right = b.toLowerCase()
  return left.includes(right) || right.includes(left)
}

/**
 * Everything wrong with a set of trigger words, judged against the answers the
 * bot can currently see.
 *
 * Inactive neighbours are ignored because `search_faq` filters on `is_active`:
 * an answer that is switched off is competing for nothing, and warning about it
 * would be warning about something that is not happening.
 */
export function tagWarnings(
  entryId: string,
  tags: string[],
  neighbours: TagNeighbour[]
): TagWarning[] {
  const warnings: TagWarning[] = []
  const rivals = neighbours.filter((n) => n.id !== entryId && n.isActive)

  for (const raw of tags) {
    const tag = raw.trim()
    if (!tag) continue

    if (tag.length < SHORTEST_TAG) {
      warnings.push({
        tag,
        kind: 'short',
        message: `“${tag}” is short enough to appear inside almost any message, so it will pull this answer into questions that are not about it. Use a longer, more specific word.`,
      })
    } else if (CARRIES_NO_SUBJECT.has(tag.toLowerCase())) {
      warnings.push({
        tag,
        kind: 'short',
        message: `“${tag}” is a word people use in sentences about anything, so it will match questions that have nothing to do with this answer. Use a word that names the subject.`,
      })
    }

    // Not an `else`. A word can be both too short and already claimed, and
    // fixing the first only to be told about the second is two round trips
    // through a form for something the page already knew.
    const clash = rivals.find((rival) => rival.tags.some((other) => overlaps(tag, other)))
    if (clash) {
      warnings.push({
        tag,
        kind: 'collision',
        message: `“${tag}” overlaps a word on “${clash.question}”. Both answers will match, and the longer word decides which one wins.`,
      })
    }
  }

  return warnings
}

/**
 * A readable handle for a picture, derived rather than demanded.
 *
 * The agent types this — it appears as `show_image with image="menu"` — so it
 * is Latin, lowercase and dashed. Most questions here are written entirely in
 * Thai and leave nothing to slugify, which is why there is a fallback rather
 * than a failure: the operator can always set a better one by hand, but they
 * should never be stopped from attaching a picture over it.
 */
export function deriveSlug(question: string, taken: string[]): string {
  const base =
    question
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, SLUG_MAX_LENGTH)
      .replace(/-+$/, '') || 'answer'

  let candidate = base
  // Counts up rather than stopping at some arbitrary ceiling: there are only as
  // many collisions as there are answers, and the loop is bounded by that.
  for (let n = 2; taken.includes(candidate); n++) {
    const suffix = `-${n}`
    candidate = base.slice(0, SLUG_MAX_LENGTH - suffix.length).replace(/-+$/, '') + suffix
  }
  return candidate
}
