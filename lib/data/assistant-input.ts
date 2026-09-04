import { z } from 'zod'

/**
 * What the console may set on the assistant.
 *
 * The instructions have a floor as well as a ceiling: an empty prompt is not a
 * minimal assistant, it is a model answering as whatever it was trained to be,
 * about a shop it has never heard of. The ceiling is there because the whole
 * thing is sent on every single message.
 */
export const assistantVoiceSchema = z.object({
  shopName: z.string().trim().min(1, 'The shop needs a name.').max(120),
  particle: z.enum(['khrap', 'kha', 'none']),
  formality: z.enum(['formal', 'friendly', 'casual']),
  traits: z.string().trim().max(500).default(''),
  avoid: z.string().trim().max(500).default(''),
  instructions: z
    .string()
    .trim()
    .min(80, 'The instructions are too short to describe an assistant.')
    .max(8000, 'The instructions are too long to send on every message.'),
})
