"use client";

import { fr } from "@/i18n/fr";

/** Three animated dots while the server prepares its reply. */
export function TypingIndicator() {
  return (
    <div className="flex items-end gap-2" role="status" aria-label={fr.conversation.typing}>
      <span className="sr-only">{fr.conversation.typing}</span>
      <div className="flex items-center gap-1.5 rounded-[1.375rem] rounded-bl-md bg-muted px-[1.125rem] py-4">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            aria-hidden="true"
            className="size-2 animate-bounce rounded-full bg-primary/60 motion-reduce:animate-none"
            style={{ animationDelay: `${i * 140}ms`, animationDuration: "1s" }}
          />
        ))}
      </div>
    </div>
  );
}
