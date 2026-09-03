import type { Metadata } from 'next'
import { Geist, Geist_Mono, Noto_Sans_Thai } from 'next/font/google'
import { SHOP_NAME } from '@/lib/shop'
import './globals.css'

const geistSans = Geist({
  variable: '--font-geist-sans',
  subsets: ['latin'],
})

const geistMono = Geist_Mono({
  variable: '--font-geist-mono',
  subsets: ['latin'],
})

/**
 * Geist carries no Thai glyphs, and Thai is what most of this app's content is
 * written in. Loading a Thai face and letting the browser fall through to it
 * per-codepoint keeps Latin in Geist while Thai gets a face designed for it,
 * rather than whatever the operating system happens to substitute.
 */
const notoSansThai = Noto_Sans_Thai({
  variable: '--font-thai',
  subsets: ['thai'],
  weight: ['400', '500', '600', '700'],
})

export const metadata: Metadata = {
  title: {
    // Names the surfaces that set no title of their own.
    default: `${SHOP_NAME} — chat`,
    // The ones that do set a title have already written it in full, including
    // what it belongs to, so nothing is appended to them.
    template: '%s',
  },
  description: `Customer conversations for ${SHOP_NAME}, from LINE and from the web, answered by an assistant with staff supervising.`,
}

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      // The content customers read is predominantly Thai; declaring English
      // makes a screen reader pronounce it with an English voice.
      lang="th"
      className={`${geistSans.variable} ${geistMono.variable} ${notoSansThai.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  )
}
