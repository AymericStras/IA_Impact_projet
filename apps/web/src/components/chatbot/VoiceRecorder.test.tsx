import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ApiError } from "@/services/types";
import { VoiceRecorder } from "./VoiceRecorder";

// jsdom has no MediaRecorder: in demo mode the recorder skips straight to the upload,
// which is enough to exercise the error and preview states.
function renderRecorder(onTranscribe: (audio: Blob) => Promise<string>) {
  const onSend = vi.fn();
  const onClose = vi.fn();
  render(<VoiceRecorder onTranscribe={onTranscribe} onSend={onSend} onClose={onClose} demoMode />);
  return { onSend, onClose };
}

describe("VoiceRecorder", () => {
  it("shows the server detail and only offers to record again for an unusable recording", async () => {
    const onTranscribe = vi.fn(async () => {
      throw new ApiError(413, "Trop long", "L'enregistrement dépasse 2 minutes.", "AUDIO_TOO_LONG");
    });
    renderRecorder(onTranscribe);

    expect(await screen.findByText("L'enregistrement dépasse 2 minutes.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Réenregistrer" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Réessayer la transcription" })).not.toBeInTheDocument();
  });

  it("offers to retry the same upload after a provider failure", async () => {
    const onTranscribe = vi
      .fn<(audio: Blob) => Promise<string>>()
      .mockRejectedValueOnce(new ApiError(502, "Fournisseur", "La transcription est indisponible.", "PROVIDER_ERROR"))
      .mockResolvedValueOnce("Nous sommes 30.");
    const user = userEvent.setup();
    renderRecorder(onTranscribe);

    expect(await screen.findByText("La transcription est indisponible.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Réessayer la transcription" }));

    expect(await screen.findByLabelText("Texte transcrit")).toHaveValue("Nous sommes 30.");
    expect(onTranscribe).toHaveBeenCalledTimes(2);
    expect(onTranscribe.mock.calls[0]?.[0]).toBe(onTranscribe.mock.calls[1]?.[0]);
  });

  it("sends the corrected transcript, not the raw one", async () => {
    const user = userEvent.setup();
    const { onSend, onClose } = renderRecorder(async () => "Nous sommes trente.");

    const textarea = await screen.findByLabelText("Texte transcrit");
    await user.clear(textarea);
    await user.type(textarea, "Nous sommes 30.");
    await user.click(screen.getByRole("button", { name: "Envoyer" }));

    expect(onSend).toHaveBeenCalledWith("Nous sommes 30.");
    expect(onClose).toHaveBeenCalled();
  });
});
