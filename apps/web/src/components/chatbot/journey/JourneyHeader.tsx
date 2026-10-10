import {
  CheckCircle2Icon,
  ClipboardCheckIcon,
  HourglassIcon,
  MapPinIcon,
  RouteIcon,
  SearchXIcon,
  SlidersHorizontalIcon,
  TriangleAlertIcon,
  type LucideIcon,
} from "lucide-react";
import { fr } from "@/i18n/fr";
import { DISPLAY, WRAP_ANYWHERE } from "@/lib/ui";
import { cn } from "@/lib/utils";
import type { JourneyStage } from "@/types/journey";

type Tone = "info" | "success" | "neutral";

const STAGE_LOOK: Record<JourneyStage, { icon: LucideIcon; tone: Tone }> = {
  destinations: { icon: MapPinIcon, tone: "info" },
  itineraries: { icon: RouteIcon, tone: "info" },
  adjustments: { icon: SlidersHorizontalIcon, tone: "info" },
  // "Nothing fits" and "refused" are outcomes, not failures: never the destructive style.
  no_match: { icon: SearchXIcon, tone: "neutral" },
  review: { icon: ClipboardCheckIcon, tone: "info" },
  booking_pending: { icon: HourglassIcon, tone: "info" },
  booked: { icon: CheckCircle2Icon, tone: "success" },
  booking_refused: { icon: TriangleAlertIcon, tone: "neutral" },
  closed: { icon: CheckCircle2Icon, tone: "success" },
};

/**
 * The stage header is a navy block (white text, 15.74:1). A stage that went well carries
 * its icon on a yellow disc; a stage with nothing to offer is a calm grey block with navy
 * text — visibly not the navy of progress, and nothing like the pale red of an error.
 */
const TONE_CLASS: Record<Tone, { block: string; icon: string }> = {
  info: { block: "border-primary bg-primary text-primary-foreground", icon: "bg-primary-foreground/15" },
  success: { block: "border-primary bg-primary text-primary-foreground", icon: "bg-highlight text-highlight-foreground" },
  neutral: { block: "border-input bg-muted text-foreground", icon: "bg-card" },
};

interface JourneyHeaderProps {
  stage: JourneyStage;
  /** Overrides the stage title (e.g. while another destination is being picked). */
  title?: string;
  /** `Journey.message`, displayed as received. */
  message: string;
  className?: string;
}

/** Title of the current stage and the server's line describing it. */
export function JourneyHeader({ stage, title, message, className }: JourneyHeaderProps) {
  const look = STAGE_LOOK[stage];
  const Icon = look.icon;
  const tone = TONE_CLASS[look.tone];
  return (
    <div
      className={cn("flex min-w-0 items-start gap-3.5 rounded-2xl border tall:p-5 short:gap-3 short:p-3.5", tone.block, className)}
      data-testid="journey-header"
      data-tone={look.tone}
    >
      {/* Where the block is narrow (phones) the disc leaves the room to the words; the yellow
          check of a stage that went well stays. */}
      <span
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-full short:size-8",
          look.tone === "success" ? null : "@max-[30rem]/journey:hidden",
          tone.icon,
        )}
        aria-hidden="true"
      >
        <Icon className="size-[1.125rem]" />
      </span>
      <div className={cn("flex-1", WRAP_ANYWHERE)}>
        <h2 id="journey-title" className={cn(DISPLAY, "text-2xl leading-tight short:text-xl @max-[30rem]/journey:text-[1.375rem]")}>
          {title ?? fr.journey.stages[stage]}
        </h2>
        <p className="mt-1.5 text-[0.9375rem] short:mt-1 short:text-sm" data-testid="journey-message">
          {message}
        </p>
      </div>
    </div>
  );
}
