import 'server-only'
import { ChatOpenAI } from '@langchain/openai'
import { env } from '@/lib/env'

/**
 * OpenRouter speaks the OpenAI chat-completions protocol, so the OpenAI client
 * pointed at their base URL is the whole integration — no bespoke provider.
 *
 * Created per call rather than held in a module-level singleton, matching the
 * Supabase and LINE clients and Vercel's Fluid compute guidance.
 */
export function chatModel() {
  if (!env.OPENROUTER_API_KEY) {
    throw new Error('OPENROUTER_API_KEY is not configured')
  }

  return new ChatOpenAI({
    apiKey: env.OPENROUTER_API_KEY,
    model: env.OPENROUTER_MODEL,
    // Low, but not zero: the shop's answers should be steady rather than
    // creative, while still reading like a person wrote them.
    temperature: 0.3,
    // A customer support reply that runs long has gone wrong. This also bounds
    // the cost of a single conversation turn.
    maxTokens: 500,
    configuration: {
      baseURL: 'https://openrouter.ai/api/v1',
    },
  })
}
