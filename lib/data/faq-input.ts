import { z } from 'zod'

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
   */
  tags: z
    .array(z.string().trim().min(2, 'A tag needs at least two characters.').max(40))
    .max(40)
    .default([]),
  slug: z
    .string()
    .trim()
    .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Use lowercase letters, numbers and dashes.')
    .min(2)
    .max(40)
    .nullable()
    .default(null),
  isActive: z.boolean().default(true),
  sortOrder: z.number().int().min(0).max(100000).default(100),
})

export type FaqEntryInputShape = z.infer<typeof faqEntrySchema>
