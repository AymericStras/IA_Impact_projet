import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { Message } from "@/types/contracts";
import { ConversationThread } from "./ConversationThread";

const at = "2026-10-10T10:00:00+02:00";

function message(id: string, role: Message["role"], content: string): Message {
  return { id, role, content, created_at: at };
}

/** jsdom has no layout: give the scroll container explicit metrics. */
function setMetrics(el: HTMLElement, metrics: { scrollHeight: number; clientHeight: number }) {
  Object.defineProperty(el, "scrollHeight", { configurable: true, value: metrics.scrollHeight });
  Object.defineProperty(el, "clientHeight", { configurable: true, value: metrics.clientHeight });
}

describe("ConversationThread", () => {
  it("renders message text literally, never as HTML or markdown", () => {
    const payload = '<img src=x onerror=alert(1)> **gras** [lien](javascript:alert(1)) <script>alert(2)</script>';
    const { container } = render(
      <ConversationThread
        messages={[message("m1", "assistant", payload), message("m2", "user", payload)]}
        optimisticMessage={message("local", "user", payload)}
        typing={false}
      />,
    );

    expect(screen.getAllByText(payload, { exact: false })).toHaveLength(3);
    expect(container.querySelector("img")).toBeNull();
    expect(container.querySelector("script")).toBeNull();
    expect(container.querySelector("a")).toBeNull();
    expect(container.querySelector("strong")).toBeNull();
  });

  it("shows « Revenir en bas » only after the user scrolled up, and does not yank the view on a new message", () => {
    const first = [message("m1", "assistant", "Bonjour !")];
    const { rerender } = render(<ConversationThread messages={first} optimisticMessage={null} typing={false} />);
    const scroller = screen.getByTestId("conversation-scroll");
    expect(screen.queryByTestId("scroll-to-bottom")).not.toBeInTheDocument();

    // The user scrolls up in a long thread.
    setMetrics(scroller, { scrollHeight: 2_000, clientHeight: 500 });
    scroller.scrollTop = 300;
    fireEvent.scroll(scroller);
    expect(screen.getByTestId("scroll-to-bottom")).toHaveTextContent("Revenir en bas");

    // A new assistant message arrives: the position is left alone.
    rerender(
      <ConversationThread
        messages={[...first, message("m2", "assistant", "Quel jour partez-vous ?")]}
        optimisticMessage={null}
        typing={false}
      />,
    );
    expect(scroller.scrollTop).toBe(300);
    expect(screen.getByTestId("scroll-to-bottom")).toBeInTheDocument();

    // The button brings the thread back to the newest message.
    fireEvent.click(screen.getByTestId("scroll-to-bottom"));
    expect(scroller.scrollTop).toBe(2_000);
  });

  it("follows the conversation again when the user sends a message", () => {
    const first = [message("m1", "assistant", "Bonjour !")];
    const { rerender } = render(<ConversationThread messages={first} optimisticMessage={null} typing={false} />);
    const scroller = screen.getByTestId("conversation-scroll");
    setMetrics(scroller, { scrollHeight: 2_000, clientHeight: 500 });
    scroller.scrollTop = 300;
    fireEvent.scroll(scroller);

    rerender(
      <ConversationThread messages={first} optimisticMessage={message("local", "user", "Nous sommes 30")} typing />,
    );
    expect(scroller.scrollTop).toBe(1_500);
  });
  it("brings the start of an anchored footer (the journey) to the top when it changes, wherever the thread was", () => {
    const messages = [message("m1", "assistant", "Merci, votre projet est confirmé.")];
    const footer = (stage: string) => (
      <div data-thread-anchor="" data-testid="anchor">
        {stage}
      </div>
    );
    const { rerender } = render(
      <ConversationThread messages={messages} optimisticMessage={null} typing={false} footerKey="confirmed|">
        {null}
      </ConversationThread>,
    );
    const scroller = screen.getByTestId("conversation-scroll");
    setMetrics(scroller, { scrollHeight: 3_000, clientHeight: 500 });
    // The teacher has scrolled down a long list to press a button: not at the bottom.
    scroller.scrollTop = 900;
    fireEvent.scroll(scroller);

    rerender(
      <ConversationThread messages={messages} optimisticMessage={null} typing={false} footerKey="confirmed|destinations:stage">
        {footer("destinations")}
      </ConversationThread>,
    );
    // The anchor appeared (jsdom lays it out at the top of the visible area): aligned to it.
    expect(scroller.scrollTop).toBe(900 - 12);
    // jsdom has no layout: place the anchor 400 px below the top of the visible area.
    const place = (top: number) => {
      screen.getByTestId("anchor").getBoundingClientRect = () => ({ top, bottom: top + 50, left: 0, right: 0, width: 0, height: 50, x: 0, y: top, toJSON: () => ({}) });
    };
    place(400);
    rerender(
      <ConversationThread messages={messages} optimisticMessage={null} typing={false} footerKey="confirmed|itineraries:stage">
        {footer("itineraries")}
      </ConversationThread>,
    );
    // Aligned to the anchor's start (with the usual breathing room), not left where it was.
    expect(scroller.scrollTop).toBe(888 + 400 - 12);

    // Without a change of the footer, the reader's position is respected again.
    scroller.scrollTop = 200;
    fireEvent.scroll(scroller);
    rerender(
      <ConversationThread
        messages={[...messages, message("m2", "assistant", "Autre chose ?")]}
        optimisticMessage={null}
        typing={false}
        footerKey="confirmed|itineraries:stage"
      >
        {footer("itineraries")}
      </ConversationThread>,
    );
    expect(scroller.scrollTop).toBe(200);
  });
});
