import * as React from "react"
import { Input as InputPrimitive } from "@base-ui/react/input"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const inputVariants = cva(
  "w-full min-w-0 border border-input bg-transparent transition-colors outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 md:text-sm dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
  {
    variants: {
      size: {
        // text-base below md is not cosmetic: anything smaller makes mobile
        // Safari zoom the page on focus.
        default: "h-8 rounded-lg px-2.5 py-1 text-base",
        lg: "h-9 rounded-lg px-3 py-1 text-base",
        xl: "h-10 rounded-lg px-3.5 py-2 text-base",
      },
      shape: {
        default: "",
        pill: "rounded-full px-4",
      },
    },
    defaultVariants: {
      size: "default",
      shape: "default",
    },
  }
)

function Input({
  className,
  type,
  size,
  shape,
  ...props
}: Omit<React.ComponentProps<"input">, "size"> & VariantProps<typeof inputVariants>) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      className={cn(inputVariants({ size, shape, className }))}
      {...props}
    />
  )
}

export { Input, inputVariants }
