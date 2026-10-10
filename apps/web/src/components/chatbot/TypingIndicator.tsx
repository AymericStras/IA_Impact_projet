"use client";

import { fr } from "@/i18n/fr";

/** Three animated dots while the server prepares its reply. */
export function TypingIndicator() {
  return (
    <div className="flex items-end gap-2" role="status" aria-label={fr.conversation.typing}>
      <span className="sr-only">{fr.conversation.typing}</span>
      <div className="flex items-center gap-1 rounded-2xl rounded-bl-md bg-card px-3.5 py-3 ring-1 ring-foreground/10">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            aria-hidden="true"
            className="size-1.5 animate-bounce rounded-full bg-muted-foreground/70 motion-reduce:animate-none"
            style={{ animationDelay: `${i * 140}ms`, animationDuration: "1s" }}
          />
        ))}
      </div>
    </div>
  );
}
