import { Skeleton } from "@/components/ui/skeleton";
import { fr } from "@/i18n/fr";

/** Skeleton shown while the conversation is created or restored. */
export function LoadingState() {
  return (
    <div className="flex flex-col gap-4 px-4 py-6" role="status" aria-live="polite">
      <span className="sr-only">{fr.loading.conversation}</span>
      <div className="flex items-start gap-2">
        <Skeleton className="h-16 w-3/4 rounded-2xl rounded-bl-md" />
      </div>
      <div className="flex justify-end">
        <Skeleton className="h-10 w-1/2 rounded-2xl rounded-br-md" />
      </div>
      <div className="flex items-start gap-2">
        <Skeleton className="h-10 w-2/3 rounded-2xl rounded-bl-md" />
      </div>
    </div>
  );
}
