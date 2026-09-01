import { Suspense } from 'react'
import { LoginForm } from '@/components/console/login-form'

export const metadata = { title: 'Sign in · LINE OA Console' }

/**
 * `useSearchParams` (for the ?next= redirect) suspends during prerendering, so
 * the form has to sit behind a Suspense boundary or the production build fails.
 * It works without one in dev, which is why this only surfaces at build time.
 */
export default function LoginPage() {
  return (
    <main className="grid min-h-dvh place-items-center p-6">
      <Suspense fallback={<div className="h-48 w-full max-w-sm animate-pulse rounded-md bg-muted" />}>
        <LoginForm />
      </Suspense>
    </main>
  )
}
