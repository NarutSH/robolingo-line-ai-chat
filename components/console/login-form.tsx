'use client'

import { useState, useTransition } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

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

      <div className="space-y-1.5">
        <label htmlFor="operator-password" className="text-sm font-medium">
          Operator password
        </label>
        <Input
          id="operator-password"
          name="password"
          type="password"
          autoComplete="current-password"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? 'sign-in-error' : undefined}
          className="h-9"
        />
      </div>

      {error && (
        <p id="sign-in-error" role="alert" className="text-sm text-failed-ink">
          {error}
        </p>
      )}

      <Button type="submit" size="lg" disabled={isPending} className="w-full">
        {isPending ? 'Signing in…' : 'Sign in'}
      </Button>
    </form>
  )
}
