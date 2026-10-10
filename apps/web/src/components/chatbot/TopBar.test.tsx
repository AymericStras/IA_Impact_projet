import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { TooltipProvider } from "@/components/ui/tooltip";
import { fr } from "@/i18n/fr";
import { TopBar } from "./TopBar";

describe("TopBar", () => {
  it("links to the voice flow with a visible label, not an icon alone", () => {
    render(
      <TooltipProvider>
        <TopBar onRestart={() => {}} />
      </TooltipProvider>,
    );
    const link = screen.getByRole("link", { name: fr.app.voiceLinkLabel });
    expect(link).toHaveAttribute("href", "/vocal");
    expect(link).toHaveTextContent(fr.app.voiceLinkShort);
    expect(link).toHaveTextContent(fr.app.voiceLink);
  });
});
