"use client";

import { motion, useReducedMotion } from "motion/react";
import { MicIcon, PencilLineIcon } from "lucide-react";
import { fr } from "@/i18n/fr";
import { formatMessageTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Message } from "@/types/contracts";

interface MessageBubbleProps {
  message: Message;
  /** Optimistic bubble: shown before the server acknowledges the message. */
  pendingDelivery?: boolean;
  /** Bubble whose send failed (an error with a retry action is shown next to it). */
  failed?: boolean;
}

export function MessageBubble({ message, pendingDelivery = false, failed = false }: MessageBubbleProps) {
  const reduceMotion = useReducedMotion();
  const isUser = message.role === "user";
  const time = formatMessageTime(message.created_at);

  return (
    <motion.li
      initial={{ opacity: 0, y: reduceMotion ? 0 : 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: reduceMotion ? 0 : 0.22, ease: "easeOut" }}
      className={cn("flex w-full flex-col gap-1", isUser ? "items-end" : "items-start")}
      data-role={message.role}
      data-testid={`message-${message.role}`}
    >
      <div
        className={cn(
          "max-w-[85%] rounded-2xl px-4 py-2.5 text-[0.95rem] leading-relaxed whitespace-pre-wrap break-words sm:max-w-[75%]",
          isUser
            ? "rounded-br-md bg-user-bubble text-user-bubble-foreground"
            : "rounded-bl-md bg-card text-card-foreground ring-1 ring-foreground/10",
          pendingDelivery && "opacity-70",
          failed && "ring-2 ring-destructive/40",
        )}
      >
        <span className="sr-only">{isUser ? fr.conversation.you : fr.conversation.assistantName} : </span>
        {message.content}
      </div>
      <div className="flex items-center gap-1.5 px-1 text-[0.7rem] text-muted-foreground">
        {message.source === "audio" ? (
          <span className="inline-flex items-center gap-1">
            <MicIcon className="size-3" aria-hidden="true" />
            {fr.conversation.sourceAudio}
          </span>
        ) : null}
        {message.source === "edit" ? (
          <span className="inline-flex items-center gap-1">
            <PencilLineIcon className="size-3" aria-hidden="true" />
            {fr.conversation.sourceEdit}
          </span>
        ) : null}
        {time && !pendingDelivery ? <time dateTime={message.created_at}>{time}</time> : null}
        {pendingDelivery ? <span>{fr.composer.sending}</span> : null}
      </div>
    </motion.li>
  );
}
