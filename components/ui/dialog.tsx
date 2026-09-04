'use client'

import { Dialog as DialogPrimitive } from '@base-ui/react/dialog'
import { cn } from '@/lib/utils'

/**
 * The app's one dialog dress.
 *
 * Base UI carries the behaviour that is tedious and easy to get wrong — focus
 * trapping, restoring focus to whatever opened it, Escape, scroll locking, the
 * `aria` wiring between the popup and its title. This only decides how it looks,
 * for the same reason `button.tsx` exists: so the second dialog in this codebase
 * cannot disagree with the first.
 */
const Dialog = DialogPrimitive.Root
const DialogTrigger = DialogPrimitive.Trigger
const DialogClose = DialogPrimitive.Close

function DialogContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Popup>) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Backdrop className="fixed inset-0 z-50 bg-foreground/20 backdrop-blur-[2px] transition-opacity duration-150 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0 motion-reduce:transition-none" />
      <DialogPrimitive.Popup
        className={cn(
          // Anchored high rather than centred: the results grow downwards as
          // they arrive, and a centred box would slide the input under the
          // operator's hands while they are still typing into it.
          'fixed inset-x-0 top-[8vh] z-50 mx-auto flex max-h-[80vh] w-[min(42rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-xl border bg-background shadow-lg outline-none',
          'transition-[opacity,transform] duration-150 data-[ending-style]:scale-98 data-[ending-style]:opacity-0 data-[starting-style]:scale-98 data-[starting-style]:opacity-0 motion-reduce:transition-none',
          className
        )}
        {...props}
      >
        {children}
      </DialogPrimitive.Popup>
    </DialogPrimitive.Portal>
  )
}

function DialogTitle({ className, ...props }: React.ComponentProps<typeof DialogPrimitive.Title>) {
  return <DialogPrimitive.Title className={cn('text-sm font-semibold', className)} {...props} />
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      className={cn('text-xs text-muted-foreground', className)}
      {...props}
    />
  )
}

export { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle, DialogTrigger }
