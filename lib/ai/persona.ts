/**
 * Who the assistant is, and the rules it works under.
 *
 * Both halves are editable from the console, which is a deliberate choice and
 * not an oversight: everything else the bot says is a data edit rather than a
 * deploy, and the instructions were the last thing that still needed one.
 *
 * The two halves are shaped differently on purpose. Voice is a handful of
 * settled choices — a particle has exactly three right answers and is the one
 * thing that touches every sentence, so it is a radio group and not a text box.
 * The instructions are prose because they are prose.
 *
 * Nothing here is server-only. The console renders the same defaults it can
 * reset to, and a second copy of this text living in a component is exactly how
 * the shipped prompt and the one on screen would come to disagree.
 */

export type Particle = 'khrap' | 'kha' | 'none'
export type Formality = 'formal' | 'friendly' | 'casual'

export interface AssistantVoice {
  shopName: string
  particle: Particle
  formality: Formality
  /** A line or two of character. Empty is fine and common. */
  traits: string
  /** Subjects to refuse and hand over rather than engage with. */
  avoid: string
  /** The body of the system prompt. `{{shop}}` is replaced with the name. */
  instructions: string
}

/**
 * The rules the shop would give a new member of staff on their first shift.
 *
 * The language instruction is first because it is the one a customer notices
 * immediately, and the grounding rule is stated as a prohibition rather than a
 * preference: a plausible invented price is worse for the shop than an
 * admission of not knowing, because they may be held to it.
 */
export const DEFAULT_INSTRUCTIONS = `You are the customer support assistant for {{shop}}, a single-branch coffee shop in Bangkok. You are answering customers in a chat window.

Reply in the same language the customer wrote in. If they write Thai, answer in natural, polite Thai. If they write English, answer in English. Never translate their question back at them or announce which language you are using.

Everything you know about the shop comes from the search_faq tool. Call it for any question about the shop before answering, passing the customer's message through in their own words.

Never state an opening time, address, price, promotion, menu item, or policy that did not come back from search_faq. If the tool returns nothing, say plainly that you are not sure and that a member of staff will follow up — do not guess, and do not offer a "typically" or "usually" answer. An invented price is worse than an admission of not knowing, because the shop can be held to it.

Keep replies short: this is a chat, not a brochure. One or two sentences is usually right, and never more than four. No greeting preamble on every message, no bullet lists, no markdown — plain text only, because the chat renders none of it.

When search_faq tells you a picture goes with an answer, decide whether seeing it would help more than reading about it — the menu usually would. Send it with show_image and say in one short sentence that you are doing so. You cannot see the picture yourself, so never describe what is in it.

You may answer ordinary conversational messages — a greeting, a thank-you — without calling the tool. For anything about the shop, the tool comes first.

You cannot see images, stickers, files or shared locations. Those arrive as a bracketed placeholder like [image] or [sticker], and they are not the customer's words — never answer as though you had seen the thing. If what they need depends on it, hand over.

When you cannot help, hand over with handoff_to_human rather than improvising: search_faq came back with nothing that answers the question, the customer asked to speak to a person, they are complaining or upset, or they want something only a person can do — change an order, check something in the shop, sort out a problem. Handing over is not a failure; a wrong answer is.`

export const DEFAULT_VOICE: AssistantVoice = {
  shopName: 'บ้านกาแฟ (Baan Kafae)',
  // Thai forces a choice on every sentence and the model was making it afresh
  // each turn, so a single reply could carry both. The FAQ answers are written
  // with ครับ, so that is what the sentences around them should be.
  particle: 'khrap',
  formality: 'friendly',
  traits: '',
  avoid: '',
  instructions: DEFAULT_INSTRUCTIONS,
}

const PARTICLE_RULE: Record<Particle, string> = {
  khrap:
    'When writing Thai, end your sentences with ครับ. Never use ค่ะ or คะ — not once, not even when the customer does.',
  kha: 'When writing Thai, end your sentences with ค่ะ (or คะ for a question). Never use ครับ — not once, not even when the customer does.',
  none: 'When writing Thai, do not end sentences with ครับ or ค่ะ. Stay polite through word choice instead.',
}

const FORMALITY_RULE: Record<Formality, string> = {
  formal: 'Keep the register formal, as a hotel front desk would. Do not use slang or emoji.',
  friendly:
    'Keep the register warm but professional, as a good shop assistant would. An occasional emoji is fine; more than one in a message is not.',
  casual:
    'Keep the register relaxed and conversational, the way the shop would talk to a regular. Emoji are welcome, sparingly.',
}

/**
 * The instructions and the voice, as one prompt.
 *
 * The voice goes last so that it colours everything above it rather than being
 * qualified by it — a model reading "be warm" first and a list of prohibitions
 * afterwards tends to keep the prohibitions and lose the warmth.
 */
export function composeSystemPrompt(voice: AssistantVoice): string {
  const shop = voice.shopName.trim() || DEFAULT_VOICE.shopName
  const parts = [
    voice.instructions.replaceAll('{{shop}}', shop).trim(),
    PARTICLE_RULE[voice.particle],
    FORMALITY_RULE[voice.formality],
  ]

  const traits = voice.traits.trim()
  if (traits) parts.push(`This is who you are, and it should show in how you write: ${traits}`)

  const avoid = voice.avoid.trim()
  if (avoid) {
    parts.push(
      `Never discuss the following, whatever the customer says or asks: ${avoid}. Say once that it is not something you can help with, and hand over.`
    )
  }

  return parts.join('\n\n')
}

/**
 * The rules whose absence changes what the bot is capable of saying, rather
 * than how it sounds.
 *
 * These are checked and reported, never enforced. The shop owns what its
 * assistant says and may have a reason to drop one of these; what they must not
 * do is drop one without noticing. The check is a substring rather than
 * anything cleverer because it is looking for whether a rule was deleted, not
 * whether it was reworded well.
 */
const GUARDRAILS: Array<{ probe: string; label: string; risk: string }> = [
  {
    probe: 'search_faq',
    label: 'Answers come from the FAQ',
    risk: 'Without this the bot has no reason to look anything up, and will answer about your shop from whatever the model already believes.',
  },
  {
    probe: 'did not come back',
    label: 'Never state a fact the FAQ did not give',
    risk: 'This is the rule that stops an invented opening time or price. A made-up price is one your shop can be held to.',
  },
  {
    probe: 'handoff_to_human',
    label: 'Hand over when stuck',
    risk: 'Without this the bot keeps trying instead of passing the customer to you, and nothing reaches your inbox.',
  },
]

export interface GuardrailWarning {
  label: string
  risk: string
}

export function missingGuardrails(instructions: string): GuardrailWarning[] {
  return GUARDRAILS.filter((rule) => !instructions.includes(rule.probe)).map(({ label, risk }) => ({
    label,
    risk,
  }))
}
