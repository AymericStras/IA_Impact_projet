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
          "max-w-[85%] rounded-[1.375rem] px-[1.125rem] py-3 text-base leading-normal whitespace-pre-wrap [overflow-wrap:anywhere] short:py-2 @2xl/thread:max-w-[75%]",
          // Grey for the assistant, navy for the teacher; the bubble is carried by its text
          // (13.56:1 and 15.74:1), not by its edge.
          isUser
            ? "rounded-br-md bg-user-bubble text-user-bubble-foreground"
            : "rounded-bl-md bg-muted text-foreground",
          pendingDelivery && "opacity-70",
          failed && "ring-2 ring-destructive ring-offset-2 ring-offset-background",
        )}
      >
        <span className="sr-only">{isUser ? fr.conversation.you : fr.conversation.assistantName} : </span>
        {message.content}
      </div>
      <div className="flex flex-wrap items-center gap-x-1.5 px-2 text-[0.6875rem] font-medium text-muted-foreground">
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
