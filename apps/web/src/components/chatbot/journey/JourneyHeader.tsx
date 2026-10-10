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
import { WRAP_ANYWHERE } from "@/lib/ui";
import { cn } from "@/lib/utils";
import type { JourneyStage } from "@/types/journey";

type Tone = "info" | "success" | "neutral";

const STAGE_LOOK: Record<JourneyStage, { icon: LucideIcon; tone: Tone; iconClass: string }> = {
  destinations: { icon: MapPinIcon, tone: "info", iconClass: "text-primary" },
  itineraries: { icon: RouteIcon, tone: "info", iconClass: "text-primary" },
  adjustments: { icon: SlidersHorizontalIcon, tone: "info", iconClass: "text-primary" },
  // "Nothing fits" and "refused" are outcomes, not failures: never the destructive style.
  no_match: { icon: SearchXIcon, tone: "neutral", iconClass: "text-muted-foreground" },
  review: { icon: ClipboardCheckIcon, tone: "info", iconClass: "text-primary" },
  booking_pending: { icon: HourglassIcon, tone: "info", iconClass: "text-primary" },
  booked: { icon: CheckCircle2Icon, tone: "success", iconClass: "text-success" },
  booking_refused: { icon: TriangleAlertIcon, tone: "neutral", iconClass: "text-warning" },
  closed: { icon: CheckCircle2Icon, tone: "success", iconClass: "text-success" },
};

const TONE_CLASS: Record<Tone, string> = {
  info: "border-primary/25 bg-accent/40",
  success: "border-success/30 bg-success-soft/60",
  neutral: "border-input/50 bg-muted/60",
};

interface JourneyHeaderProps {
  stage: JourneyStage;
  /** Overrides the stage title (e.g. while another destination is being picked). */
  title?: string;
  /** `Journey.message`, displayed as received. */
  message: string;
}

/** Title of the current stage and the server's line describing it. */
export function JourneyHeader({ stage, title, message }: JourneyHeaderProps) {
  const look = STAGE_LOOK[stage];
  const Icon = look.icon;
  return (
    <div
      className={cn("flex min-w-0 items-start gap-3 rounded-2xl border tall:p-4 short:p-3", TONE_CLASS[look.tone])}
      data-testid="journey-header"
    >
      <Icon className={cn("mt-0.5 size-5 shrink-0", look.iconClass)} aria-hidden="true" />
      <div className={cn("flex-1", WRAP_ANYWHERE)}>
        <h2 id="journey-title" className="text-sm font-semibold">
          {title ?? fr.journey.stages[stage]}
        </h2>
        <p className="mt-1 text-sm" data-testid="journey-message">
          {message}
        </p>
      </div>
    </div>
  );
}
