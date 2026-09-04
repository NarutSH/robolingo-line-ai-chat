import { requireOperator } from '@/lib/auth/session'
import { readAssistantVoice, writeAssistantVoice } from '@/lib/data/assistant'
import { assistantVoiceSchema } from '@/lib/data/assistant-input'
import { composeSystemPrompt, DEFAULT_VOICE, missingGuardrails } from '@/lib/ai/persona'

/**
 * Who the assistant is, and the rules it works under.
 *
 * Operator-only, like everything else in the console, and for a heavier reason
 * than the rest of it: this is the one screen where a change alters what the
 * bot is *allowed* to say rather than what it knows.
 *
 * The composed prompt goes back with the settings. The screen shows the
 * operator the exact text the model will receive, which is the only honest way
 * to present a field that says "instructions" but is not the whole of them.
 */
export async function GET() {
  if (!(await requireOperator())) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const voice = await readAssistantVoice()
    return Response.json(
      {
        voice,
        defaults: DEFAULT_VOICE,
        prompt: composeSystemPrompt(voice),
        warnings: missingGuardrails(voice.instructions),
      },
      { headers: { 'cache-control': 'no-store' } }
    )
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause)
    console.error('[assistant] read failed', cause)
    return Response.json({ error: `Could not load the assistant: ${reason}` }, { status: 502 })
  }
}

export async function PUT(request: Request) {
  if (!(await requireOperator())) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const parsed = assistantVoiceSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) {
    return Response.json({ error: parsed.error.issues[0].message }, { status: 400 })
  }

  try {
    await writeAssistantVoice(parsed.data)
    // Saved even when a guardrail is missing: the shop owns what its assistant
    // says. What it is not allowed to do is lose one without being told, so the
    // warning comes back with the confirmation.
    return Response.json({
      voice: parsed.data,
      prompt: composeSystemPrompt(parsed.data),
      warnings: missingGuardrails(parsed.data.instructions),
    })
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause)
    console.error('[assistant] write failed', cause)
    return Response.json({ error: `Could not save the assistant: ${reason}` }, { status: 502 })
  }
}
