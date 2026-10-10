import { useState } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { MessageComposer } from "./MessageComposer";

function Harness({
  onSend,
  disabled = false,
  maxLength,
  initial = "",
}: {
  onSend: (content: string) => void;
  disabled?: boolean;
  maxLength?: number;
  initial?: string;
}) {
  const [value, setValue] = useState(initial);
  return (
    <TooltipProvider>
      <MessageComposer
        value={value}
        onChange={setValue}
        onSend={onSend}
        onSendTranscript={() => undefined}
        onTranscribe={async () => ""}
        disabled={disabled}
        maxLength={maxLength}
      />
    </TooltipProvider>
  );
}

describe("MessageComposer", () => {
  it("sends on Enter and clears the textarea", async () => {
    const onSend = vi.fn();
    const user = userEvent.setup();
    render(<Harness onSend={onSend} />);

    const textarea = screen.getByLabelText("Votre message");
    await user.type(textarea, "Nous sommes 30{Enter}");

    expect(onSend).toHaveBeenCalledWith("Nous sommes 30");
    expect(textarea).toHaveValue("");
  });

  it("inserts a newline on Shift+Enter without sending", async () => {
    const onSend = vi.fn();
    const user = userEvent.setup();
    render(<Harness onSend={onSend} />);

    const textarea = screen.getByLabelText("Votre message");
    await user.type(textarea, "Ligne 1{Shift>}{Enter}{/Shift}Ligne 2");

    expect(onSend).not.toHaveBeenCalled();
    expect(textarea).toHaveValue("Ligne 1\nLigne 2");
  });

  it("does not send a blank message", async () => {
    const onSend = vi.fn();
    const user = userEvent.setup();
    render(<Harness onSend={onSend} />);

    await user.type(screen.getByLabelText("Votre message"), "   {Enter}");

    expect(onSend).not.toHaveBeenCalled();
    expect(screen.getByTestId("send-button")).toBeDisabled();
  });

  it("does not send on Enter while an IME composition is in progress", () => {
    const onSend = vi.fn();
    render(<Harness onSend={onSend} initial="こんにちは" />);
    const textarea = screen.getByLabelText("Votre message");

    // Enter that validates an IME candidate: modern browsers flag it with isComposing…
    fireEvent.keyDown(textarea, { key: "Enter", isComposing: true });
    // …and Safari reports keyCode 229 instead.
    fireEvent.keyDown(textarea, { key: "Enter", keyCode: 229 });
    expect(onSend).not.toHaveBeenCalled();
    expect(textarea).toHaveValue("こんにちは");

    fireEvent.keyDown(textarea, { key: "Enter", keyCode: 13 });
    expect(onSend).toHaveBeenCalledWith("こんにちは");
  });

  it("enforces the server length limit and shows a counter only near it", async () => {
    const user = userEvent.setup();
    render(<Harness onSend={vi.fn()} maxLength={20} />);
    const textarea = screen.getByLabelText("Votre message");
    expect(textarea).toHaveAttribute("maxlength", "20");

    await user.type(textarea, "Bonjour");
    expect(screen.queryByTestId("composer-counter")).not.toBeInTheDocument();

    await user.type(textarea, " à tous, nous");
    expect(screen.getByTestId("composer-counter")).toHaveTextContent("Limite de 20 caractères atteinte");
    expect(textarea).toHaveValue("Bonjour à tous, nous");

    await user.type(textarea, "{Backspace}");
    expect(screen.getByTestId("composer-counter")).toHaveTextContent("19 / 20 caractères");
  });

  it("disables input, send and microphone while a request is in flight", () => {
    render(<Harness onSend={vi.fn()} disabled />);

    expect(screen.getByLabelText("Votre message")).toBeDisabled();
    expect(screen.getByTestId("send-button")).toBeDisabled();
    expect(screen.getByTestId("microphone-button")).toBeDisabled();
  });
});
