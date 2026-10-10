"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode, type Ref } from "react";
import { ArrowDownIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fr } from "@/i18n/fr";
import { FLUID_BUTTON_SM, TOUCH_TARGET } from "@/lib/ui";
import { cn } from "@/lib/utils";
import type { Message } from "@/types/contracts";
import { MessageBubble } from "./MessageBubble";
import { TypingIndicator } from "./TypingIndicator";

interface ConversationThreadProps {
  messages: Message[];
  optimisticMessage: Message | null;
  /** True while a server reply is awaited. */
  typing: boolean;
  /** True when the optimistic bubble belongs to a failed send. */
  optimisticFailed?: boolean;
  /** Identifies what `children` currently shows; a change re-runs the auto-scroll. */
  footerKey?: string;
  /** Area below the messages: confirmation card, error, etc. */
  children?: ReactNode;
  className?: string;
  /** Outer element: its height is the conversation area. */
  ref?: Ref<HTMLDivElement>;
}

/** Distance from the bottom (px) under which the thread counts as "at the bottom". */
const BOTTOM_THRESHOLD = 24;
/** Breathing room kept above a reply when it is aligned to the top of the viewport. */
const REPLY_TOP_OFFSET = 12;

/**
 * Scrollable message list.
 *
 * Auto-scroll rule: on every new message (or footer change) the thread follows the
 * conversation, unless the user has scrolled up to read — then nothing moves and a
 * "Revenir en bas" button appears. When the newest reply plus what follows it (e.g. the
 * confirmation card and its JSON) is taller than the viewport, the START of that reply is
 * aligned to the top instead of jumping to the very end, so nothing is skipped.
 * Scrolling is instant: the list never animates under the reader.
 *
 * A footer element marked `data-thread-anchor` (the journey after confirmation) takes the
 * place of the newest reply in that rule: when the footer changes — the teacher chose
 * something, a new stage arrived — the START of the anchor is brought to the top, wherever
 * the thread was, because the content under the reader has just been replaced.
 *
 * "Revenir en bas" never covers message text: it gets its own row under the list, or, on
 * phone-landscape sized viewports (`low`), an icon-only button in a reserved right gutter.
 */
export function ConversationThread({
  messages,
  optimisticMessage,
  typing,
  optimisticFailed = false,
  footerKey = "",
  children,
  className,
  ref,
}: ConversationThreadProps) {
  const scrollRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const atBottomRef = useRef(true);
  const userScrolledUpRef = useRef(false);
  const programmaticTopRef = useRef<number | null>(null);
  const footerKeyRef = useRef(footerKey);
  const [showJump, setShowJump] = useState(false);

  const lastMessageId = messages[messages.length - 1]?.id;
  const optimisticId = optimisticMessage?.id;

  const measure = useCallback((): boolean => {
    const el = scrollRef.current;
    if (!el) return true;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= BOTTOM_THRESHOLD;
    atBottomRef.current = atBottom;
    setShowJump(!atBottom);
    return atBottom;
  }, []);

  const scrollTo = useCallback(
    (top: number) => {
      const el = scrollRef.current;
      if (!el) return;
      el.scrollTop = top;
      // Remember where we put it, to tell our own scrolling from the user's.
      programmaticTopRef.current = el.scrollTop;
      measure();
    },
    [measure],
  );

  const scrollToBottom = useCallback(() => {
    const el = scrollRef.current;
    if (el) scrollTo(el.scrollHeight);
  }, [scrollTo]);

  const scrollToLatest = useCallback(
    (alignReplyStart: boolean) => {
      const el = scrollRef.current;
      if (!el) return;
      const max = Math.max(0, el.scrollHeight - el.clientHeight);
      let target = max;
      if (alignReplyStart) {
        const replies = el.querySelectorAll<HTMLElement>('[data-role="assistant"]');
        const last = el.querySelector<HTMLElement>("[data-thread-anchor]") ?? replies[replies.length - 1];
        if (last) {
          const top = last.getBoundingClientRect().top - el.getBoundingClientRect().top + el.scrollTop;
          target = Math.min(max, Math.max(0, top - REPLY_TOP_OFFSET));
        }
      }
      scrollTo(target);
    },
    [scrollTo],
  );

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const programmatic =
      programmaticTopRef.current !== null && Math.abs(el.scrollTop - programmaticTopRef.current) < 2;
    const atBottom = measure();
    if (atBottom) userScrolledUpRef.current = false;
    else if (!programmatic) userScrolledUpRef.current = true;
  };

  // New message, typing indicator or footer: follow the conversation.
  useEffect(() => {
    const ownSend = optimisticId !== undefined;
    const footerChanged = footerKeyRef.current !== footerKey;
    footerKeyRef.current = footerKey;
    // An anchored footer that changed has replaced what was on screen: show its start.
    const anchored = footerChanged && scrollRef.current?.querySelector("[data-thread-anchor]") != null;
    // The user's own message always brings the thread back down.
    if (userScrolledUpRef.current && !ownSend && !anchored) {
      measure();
      return;
    }
    userScrolledUpRef.current = false;
    scrollToLatest(!ownSend && !typing);
  }, [lastMessageId, optimisticId, typing, footerKey, measure, scrollToLatest]);

  // Content or viewport resized (JSON block toggled, recorder opened, keyboard shown):
  // stay glued to the bottom only if we were there.
  useEffect(() => {
    if (typeof ResizeObserver === "undefined") return;
    const el = scrollRef.current;
    const content = contentRef.current;
    if (!el || !content) return;
    const observer = new ResizeObserver((entries) => {
      // An anchored footer growing under its start (a travel file arriving, a detail opened)
      // must not push that start out of view: only a resized viewport re-glues then.
      const contentOnly = entries.every((entry) => entry.target === content);
      const keepStart = contentOnly && el.querySelector("[data-thread-anchor]") !== null;
      if (atBottomRef.current && !userScrolledUpRef.current && !keepStart) scrollToBottom();
      else measure();
    });
    observer.observe(el);
    observer.observe(content);
    return () => observer.disconnect();
  }, [measure, scrollToBottom]);

  return (
    <div ref={ref} className={cn("relative flex min-h-32 flex-col", className)} data-testid="conversation-area">
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        // `relative`: absolutely positioned descendants (screen-reader-only text, stretched
        // checkbox inputs) must scroll and be clipped with the thread; without it they are laid
        // out against an outer box and give the app shell a phantom scrollable height.
        className="@container/thread thin-scrollbar relative min-h-0 flex-1 overflow-y-auto overscroll-contain wide:pr-1"
        data-testid="conversation-scroll"
        data-thread-scroll=""
      >
        <div ref={contentRef} className="flex flex-col gap-4 tall:pt-4 tall:pb-6 short:pt-2 short:pb-3 low:pr-12">
          <ul role="log" aria-label={fr.conversation.logLabel} aria-relevant="additions" className="flex flex-col gap-3">
            {messages.map((message) => (
              <MessageBubble key={message.id} message={message} />
            ))}
            {optimisticMessage ? (
              <MessageBubble message={optimisticMessage} pendingDelivery={!optimisticFailed} failed={optimisticFailed} />
            ) : null}
          </ul>
          {typing ? <TypingIndicator /> : null}
          {children}
        </div>
      </div>
      {showJump ? (
        <div className="flex shrink-0 justify-center not-low:pt-1.5 low:absolute low:right-0.5 low:bottom-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => {
              userScrolledUpRef.current = false;
              scrollToBottom();
            }}
            className={cn("rounded-full bg-card low:aspect-square low:px-0", FLUID_BUTTON_SM, TOUCH_TARGET)}
            data-testid="scroll-to-bottom"
          >
            <ArrowDownIcon aria-hidden="true" />
            {/* Icon-only in the gutter; the label stays the accessible name. */}
            <span className="low:sr-only">{fr.conversation.scrollToBottom}</span>
          </Button>
        </div>
      ) : null}
    </div>
  );
}
