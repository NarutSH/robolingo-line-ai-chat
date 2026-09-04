import { calls, type Handler } from './fetch-fake'

/**
 * OpenRouter speaks the OpenAI chat-completions protocol, so a fake reply is an
 * OpenAI-shaped completion. Scripting the turns is what makes a tool round
 * testable: the first response asks for the tool, the second answers with what
 * came back.
 */
/**
 * A turn may say something, call a tool, or do both at once — which is the
 * shape that mattered: a model that writes its sentence alongside the tool call
 * and then closes with an empty message.
 */
export type ModelTurn = { say?: string; call?: { name: string; args: unknown } }

function completion(turn: ModelTurn): Record<string, unknown> {
  const message = turn.call
    ? {
        role: 'assistant',
        content: turn.say ?? null,
        tool_calls: [
          {
            id: `call_${Math.random().toString(36).slice(2, 10)}`,
            type: 'function',
            function: { name: turn.call.name, arguments: JSON.stringify(turn.call.args) },
          },
        ],
      }
    : { role: 'assistant', content: turn.say ?? '' }

  return {
    // Unique per call, and load-bearing. LangGraph's message reducer identifies
    // a message by id, so a constant one makes the second response *replace* the
    // first instead of appending — which silently reorders the transcript.
    id: `chatcmpl-${Math.random().toString(36).slice(2, 12)}`,
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model: 'test-model',
    choices: [
      { index: 0, message, finish_reason: turn.call ? 'tool_calls' : 'stop' },
    ],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
  }
}

/**
 * Answers the scripted turns in order. Running past the end returns a plain
 * closing message rather than throwing, so an agent that loops more than
 * expected ends the run instead of hanging — assert on modelCalls() to catch it.
 */
export function openRouter(...turns: ModelTurn[]): Handler {
  let next = 0
  return () => completion(turns[next++] ?? { say: 'ขอโทษครับ เดี๋ยวพนักงานติดต่อกลับนะครับ' })
}

/** OpenRouter refusing the request, so the failure path can be asserted. */
export function openRouterFails(status = 503, message = 'model unavailable'): Handler {
  return () => Response.json({ error: { message } }, { status })
}

export function modelCalls(): number {
  return calls('openrouter.ai').length
}

interface CompletionRequest {
  messages?: Array<{ role: string; content: unknown }>
  tools?: Array<{ function?: { name?: string } }>
}

/**
 * A message's words, however the client chose to encode them. LangChain sends
 * content as a plain string in some versions and as an array of typed parts in
 * others, and a test that asserts on the wrong one fails while the code is
 * right — which is exactly what happened.
 */
function contentText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .map((part) => (typeof part === 'object' && part && 'text' in part ? String(part.text) : ''))
    .join('')
}

/** What the model was actually asked, for checking history, prompts and tools. */
export function lastModelRequest(): {
  messages: Array<{ role: string; content: unknown }>
  toolNames: string[]
  /** The system prompt as text, whichever shape it arrived in. */
  systemPrompt: string
} {
  const body = calls('openrouter.ai').at(-1)?.body as CompletionRequest | undefined
  const messages = body?.messages ?? []
  return {
    messages,
    toolNames: (body?.tools ?? []).map((t) => t.function?.name ?? '').filter(Boolean),
    systemPrompt: contentText(messages.find((message) => message.role === 'system')?.content),
  }
}
