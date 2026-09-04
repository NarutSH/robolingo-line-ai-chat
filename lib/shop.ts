import { DEFAULT_VOICE } from '@/lib/ai/persona'

/**
 * The shop's name for page chrome — the browser tab, the shared-link preview.
 *
 * This is the *default*, not the live setting. The name the assistant speaks
 * under is edited from the console and read per run; these are titles rendered
 * at build time, and making them dynamic would trade a static page for a
 * database round trip to change a string in a tab nobody is reading.
 *
 * The widget header does read the live one — see `app/chat/page.tsx` — because
 * that is a name the customer is actually looking at.
 */
export const SHOP_NAME = DEFAULT_VOICE.shopName
