import type { Metadata } from "next";
import { VoiceFlow } from "@/components/voice/VoiceFlow";
import { frVoice } from "@/i18n/fr.voice";

export const metadata: Metadata = {
  title: frVoice.page.title,
  description: frVoice.page.description,
};

/**
 * `/vocal` — the staged, voice-first experience (docs/VOICE_FLOW.md). Same backend, same
 * contract and same stored conversation as the classic chat at `/`.
 */
export default function VocalPage() {
  return <VoiceFlow />;
}
