'use client'

import { useState, useTransition } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'

export function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [error, setError] = useState<string | null>(null)
  const [isPending, startTransition] = useTransition()

  function handleSubmit(formData: FormData) {
    startTransition(async () => {
      const res = await fetch('/api/auth/login', { method: 'POST', body: formData })
      if (!res.ok) {
        const json = (await res.json().catch(() => null)) as { error?: string } | null
        setError(json?.error ?? 'Sign in failed.')
        return
      }
      router.replace(searchParams.get('next') ?? '/console')
      router.refresh()
    })
  }

  return (
    <form action={handleSubmit} className="w-full max-w-sm space-y-4">
      <div>
        <h1 className="text-lg font-semibold">LINE OA Console</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Sign in to read and answer messages sent to the Official Account.
        </p>
      </div>

      <input
        name="password"
        type="password"
        autoComplete="current-password"
        placeholder="Operator password"
        className="w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />

      {error && (
        <p role="alert" className="text-sm text-red-600 dark:text-red-400">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={isPending}
        className="w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50"
      >
        {isPending ? 'Signing in…' : 'Sign in'}
      </button>
    </form>
  )
}
