import * as React from "react"
import { Input as InputPrimitive } from "@base-ui/react/input"
import { cn } from "cn"

function Input({ className, type, ...props }: React.ComponentProps<"input">) {
  return (
    <InputPrimitive
      type={type}
      data-slot="input"
      // Its own border turns navy and a yellow halo is added (`focus-halo`, globals.css).
      data-focus-inside=""
      className={cn(
        "focus-halo h-10 w-full min-w-0 rounded-full border-2 border-input bg-card px-4 py-1 text-base text-foreground transition-colors outline-none file:inline-flex file:h-6 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground hover:border-primary focus-visible:border-primary disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground aria-invalid:border-destructive md:text-[0.9375rem]",
        className
      )}
      {...props}
    />
  )
}

export { Input }
