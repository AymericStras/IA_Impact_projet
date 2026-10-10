import * as React from "react"
import { cn } from "cn"

function Textarea({ className, ...props }: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      // Its own border turns navy and a yellow halo is added (`focus-halo`, globals.css).
      data-focus-inside=""
      className={cn(
        "focus-halo flex field-sizing-content min-h-16 w-full rounded-[1.25rem] border-2 border-input bg-card px-4 py-2.5 text-base text-foreground transition-colors outline-none placeholder:text-muted-foreground hover:border-primary focus-visible:border-primary disabled:cursor-not-allowed disabled:bg-muted disabled:text-muted-foreground aria-invalid:border-destructive md:text-[0.9375rem]",
        className
      )}
      {...props}
    />
  )
}

export { Textarea }
