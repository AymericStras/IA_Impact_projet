"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2Icon, MicIcon, SquareIcon, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fr } from "@/i18n/fr";
import { DEFAULT_CLIENT_CONFIG } from "@/lib/env";
import { formatElapsed } from "@/lib/format";
import { TOUCH_TARGET } from "@/lib/ui";
import { toApiError } from "@/services";
import { AudioTranscriptionPreview } from "./AudioTranscriptionPreview";
import { ErrorMessage } from "./ErrorMessage";

type RecorderPhase =
  | { phase: "requesting" }
  | { phase: "recording"; notice?: string }
  | { phase: "uploading" }
  | { phase: "preview"; transcript: string }
  | { phase: "error"; message: string; blob: Blob | null };

interface VoiceRecorderProps {
  /** Uploads the audio and returns the transcript to correct. */
  onTranscribe: (audio: Blob) => Promise<string>;
  /** Final (corrected) text to send as a message with `source: "audio"`. */
  onSend: (text: string) => void;
  onClose: () => void;
  /** Auto-stop limit in seconds (`GET /config`). */
  maxSeconds?: number;
  /** Maximum length of the corrected transcript (`GET /config`). */
  maxLength?: number;
  demoMode?: boolean;
}

const PREFERRED_MIME_TYPES = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"];

export function isRecordingSupported(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof navigator !== "undefined" &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof window.MediaRecorder !== "undefined"
  );
}

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === "undefined" || typeof MediaRecorder.isTypeSupported !== "function") return undefined;
  return PREFERRED_MIME_TYPES.find((type) => MediaRecorder.isTypeSupported(type));
}

/**
 * Microphone recording → upload → transcription → editable preview.
 * Starts on mount; the parent closes it through `onClose`.
 */
export function VoiceRecorder({
  onTranscribe,
  onSend,
  onClose,
  maxSeconds = DEFAULT_CLIENT_CONFIG.max_audio_seconds,
  maxLength = DEFAULT_CLIENT_CONFIG.max_message_chars,
  demoMode = false,
}: VoiceRecorderProps) {
  const [state, setState] = useState<RecorderPhase>({ phase: "requesting" });
  const [elapsed, setElapsed] = useState(0);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const cancelledRef = useRef(false);
  const maxReachedRef = useRef(false);

  const clearTimer = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
  }, []);

  const releaseStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  const upload = useCallback(
    async (blob: Blob) => {
      setState({ phase: "uploading" });
      try {
        const transcript = await onTranscribe(blob);
        setState({ phase: "preview", transcript });
      } catch (err) {
        const apiError = toApiError(err, fr.voice.uploadFailed);
        // An unusable recording (AUDIO_*, EMPTY_TRANSCRIPT) cannot be fixed by re-uploading
        // it: only "Réenregistrer" is offered. Other failures may retry the same upload.
        const canRetryUpload = apiError.kind !== "audio";
        setState({
          phase: "error",
          message: apiError.detail || fr.voice.uploadFailed,
          blob: canRetryUpload ? blob : null,
        });
      }
    },
    [onTranscribe],
  );

  const start = useCallback(async () => {
    cancelledRef.current = false;
    maxReachedRef.current = false;
    chunksRef.current = [];
    setElapsed(0);
    setState({ phase: "requesting" });

    // In demo mode without a usable microphone, skip recording: the transcript is scripted.
    const demoFallback = () => void upload(new Blob([], { type: "audio/webm" }));

    if (!isRecordingSupported()) {
      if (demoMode) return demoFallback();
      setState({ phase: "error", message: fr.voice.unsupported, blob: null });
      return;
    }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (err) {
      if (demoMode) return demoFallback();
      const name = err instanceof DOMException ? err.name : "";
      const message =
        name === "NotAllowedError" || name === "SecurityError"
          ? fr.voice.permissionDenied
          : name === "NotFoundError" || name === "OverconstrainedError"
            ? fr.voice.noMicrophone
            : fr.voice.unsupported;
      setState({ phase: "error", message, blob: null });
      return;
    }
    if (cancelledRef.current) {
      stream.getTracks().forEach((track) => track.stop());
      return;
    }
    streamRef.current = stream;

    let recorder: MediaRecorder;
    try {
      const mimeType = pickMimeType();
      recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
    } catch {
      releaseStream();
      setState({ phase: "error", message: fr.voice.unsupported, blob: null });
      return;
    }
    recorderRef.current = recorder;
    recorder.ondataavailable = (event: BlobEvent) => {
      if (event.data.size > 0) chunksRef.current.push(event.data);
    };
    recorder.onstop = () => {
      clearTimer();
      releaseStream();
      if (cancelledRef.current) return;
      const type = recorder.mimeType || chunksRef.current[0]?.type || "audio/webm";
      const blob = new Blob(chunksRef.current, { type });
      if (blob.size < 1_000 && !demoMode) {
        setState({ phase: "error", message: fr.voice.emptyRecording, blob: null });
        return;
      }
      void upload(blob);
    };
    recorder.start(250);
    setState({ phase: "recording" });
    timerRef.current = setInterval(() => {
      setElapsed((seconds) => {
        const next = seconds + 1;
        if (next >= maxSeconds && recorder.state === "recording" && !maxReachedRef.current) {
          maxReachedRef.current = true;
          setState({ phase: "recording", notice: fr.voice.maxDurationReached(maxSeconds) });
          recorder.stop();
        }
        return next;
      });
    }, 1_000);
  }, [clearTimer, demoMode, maxSeconds, releaseStream, upload]);

  const stop = useCallback(() => {
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") recorder.stop();
  }, []);

  const cancel = useCallback(() => {
    cancelledRef.current = true;
    clearTimer();
    const recorder = recorderRef.current;
    if (recorder && recorder.state !== "inactive") recorder.stop();
    releaseStream();
    onClose();
  }, [clearTimer, onClose, releaseStream]);

  useEffect(() => {
    void start();
    return () => {
      cancelledRef.current = true;
      clearTimer();
      const recorder = recorderRef.current;
      if (recorder && recorder.state !== "inactive") recorder.stop();
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
    // Single start on mount; "Réenregistrer" calls start() explicitly.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (state.phase === "preview") {
    return (
      <AudioTranscriptionPreview
        transcript={state.transcript}
        onSend={(text) => {
          onSend(text);
          onClose();
        }}
        onReRecord={() => void start()}
        onCancel={onClose}
        demoNotice={demoMode}
        maxLength={maxLength}
      />
    );
  }

  if (state.phase === "error") {
    const blob = state.blob;
    return (
      <div className="flex flex-col gap-2" data-testid="voice-error">
        <ErrorMessage
          detail={state.message}
          onRetry={blob ? () => void upload(blob) : undefined}
          retryLabel={fr.voice.retryUpload}
          onDismiss={onClose}
        />
        <div className="flex flex-wrap justify-end gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => void start()} className={TOUCH_TARGET}>
            <MicIcon aria-hidden="true" />
            {fr.voice.reRecord}
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={onClose} className={TOUCH_TARGET}>
            {fr.voice.writeInstead}
          </Button>
        </div>
      </div>
    );
  }

  const recording = state.phase === "recording";
  const uploading = state.phase === "uploading";

  return (
    <div
      className="flex flex-col gap-2 rounded-xl border bg-card p-3"
      role="group"
      aria-label={fr.voice.title}
      data-testid="voice-recorder"
    >
      <div className="flex items-center gap-3">
        <span className="relative flex size-9 shrink-0 items-center justify-center" aria-hidden="true">
          {recording ? (
            <>
              <span className="absolute inset-0 animate-ping rounded-full bg-destructive/30 motion-reduce:animate-none" />
              <span className="relative size-3.5 rounded-full bg-destructive" />
            </>
          ) : (
            <Loader2Icon className="size-5 animate-spin text-muted-foreground motion-reduce:animate-none" />
          )}
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium" role="status" aria-live="polite">
            {state.phase === "requesting" ? fr.voice.requesting : uploading ? fr.voice.uploading : fr.voice.recording}
          </p>
          <p className="text-xs text-muted-foreground">
            {recording && state.notice ? state.notice : recording ? fr.voice.recordingHint : null}
          </p>
        </div>
        {recording ? (
          <output
            className="font-mono text-sm tabular-nums text-muted-foreground"
            aria-label={fr.voice.timerLabel}
            data-testid="voice-timer"
          >
            {formatElapsed(elapsed)}
          </output>
        ) : null}
      </div>
      <div className="flex items-center justify-end gap-2">
        <Button type="button" variant="ghost" size="sm" onClick={cancel} disabled={uploading} className={TOUCH_TARGET}>
          <XIcon aria-hidden="true" />
          {fr.voice.cancel}
        </Button>
        <Button type="button" size="sm" onClick={stop} disabled={!recording} className={TOUCH_TARGET}>
          <SquareIcon aria-hidden="true" />
          {fr.voice.stop}
        </Button>
      </div>
    </div>
  );
}
