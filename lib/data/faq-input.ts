import { z } from 'zod'
import { SLUG_MAX_LENGTH, SLUG_PATTERN } from '@/lib/faq/tags'

/**
 * What the console may set on an FAQ entry.
 *
 * The slug is constrained rather than free text because the agent types it: it
 * appears in the tool output as `show_image with image="menu"`, and a slug with
 * a space or a quote in it would be one more thing for a model to get subtly
 * wrong. Lowercase, dashes, nothing else.
 */
export const faqEntrySchema = z.object({
  question: z.string().trim().min(1, 'A question is required.').max(300),
  answer: z.string().trim().min(1, 'An answer is required.').max(2000),
  /**
   * Short keywords a customer would actually type. Matching tests each of these
   * for being *inside* the customer's message, so a long tag matches almost
   * nothing and a one-character tag matches almost everything — hence the
   * bounds, which are the cheapest place to stop a tag that ruins the ranking.
   *
   * Two characters is the hard floor. The console warns above it as well, and
   * about words that carry no subject at any length — see `tagWarnings` — but
   * that is advice and this is a refusal, so the two numbers differ on purpose.
   */
  tags: z
    .array(z.string().trim().min(2, 'A tag needs at least two characters.').max(40))
    .max(40)
    .default([]),
  slug: z
    .string()
    .trim()
    .regex(SLUG_PATTERN, 'Use lowercase letters, numbers and dashes.')
    .min(2)
    .max(SLUG_MAX_LENGTH)
    .nullable()
    .default(null),
  isActive: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(100000).default(100),
})

export type FaqEntryInputShape = z.infer<typeof faqEntrySchema>
