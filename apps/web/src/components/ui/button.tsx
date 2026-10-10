import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"

/*
  « V3 — Occitanie en train » buttons (docs/DESIGN.md §4): full pills.
  - `default` is THE primary action: red, uppercase, bold, letter-spaced. Red is only legible
    on white or light surfaces — on navy use `inverse`.
  - `outline` is the secondary action: 2px navy boundary (control boundaries need 3:1).
  - `inverse` / `ghost-inverse` are for navy surfaces: white with navy content / white text.
  - A disabled primary button is grey, not a faded red: it must not look pressable.
  The focus indicator is the global two-layer ring of globals.css.
*/
const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-full border-2 border-transparent bg-clip-padding text-sm font-semibold whitespace-nowrap transition-colors outline-none select-none active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        default:
          "bg-action font-bold tracking-[0.07em] text-action-foreground uppercase hover:bg-action-hover disabled:border-border disabled:bg-muted disabled:text-muted-foreground",
        outline:
          "border-primary bg-card text-primary hover:bg-muted aria-expanded:bg-muted disabled:border-input disabled:text-muted-foreground",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-border aria-expanded:bg-secondary disabled:text-muted-foreground",
        ghost:
          "text-foreground hover:bg-muted aria-expanded:bg-muted disabled:text-muted-foreground",
        inverse:
          "bg-primary-foreground text-primary hover:bg-secondary disabled:opacity-60",
        "ghost-inverse":
          "text-primary-foreground hover:bg-primary-foreground/15 aria-expanded:bg-primary-foreground/15 disabled:opacity-60",
        destructive:
          "bg-destructive-soft text-destructive hover:bg-destructive/15 disabled:opacity-60",
        link: "text-primary underline underline-offset-4 hover:decoration-2 disabled:text-muted-foreground",
      },
      size: {
        default:
          "h-10 gap-2 px-5 has-data-[icon=inline-end]:pr-4 has-data-[icon=inline-start]:pl-4",
        xs: "h-7 gap-1 px-2.5 text-xs [&_svg:not([class*='size-'])]:size-3",
        sm: "h-8 gap-1.5 px-3.5 text-[0.8125rem] [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-12 gap-2 px-6 text-[0.9375rem]",
        icon: "size-10",
        "icon-xs": "size-7 [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-8",
        "icon-lg": "size-11",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
