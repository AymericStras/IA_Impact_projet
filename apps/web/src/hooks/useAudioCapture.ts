"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

/**
 * Microphone capture for the voice flow: `getUserMedia` → `MediaRecorder` (the audio that
 * is uploaded) and, on the SAME `MediaStream`, a Web Audio `AnalyserNode` (the level that
 * drives the visual). One hook owns both so there is a single place where the stream is
 * opened and — on every exit path — closed: tracks stopped, AudioContext closed.
 *
 * Exit paths: stop (complete), stop too early (discarded), cancel, interruption, maximum
 * duration, permission error, recorder error, unmount.
 */

export type CaptureStatus = "idle" | "requesting" | "recording";
export type CaptureErrorKind = "denied" | "no_microphone" | "unsupported" | "empty";
export type DiscardReason = "cancelled" | "too_short" | "interrupted";

export interface CaptureResult {
  blob: Blob;
  durationMs: number;
  endedBy: "user" | "max";
  /** True when no microphone was used (demo fallback): the blob is empty. */
  synthetic: boolean;
}

/** Number of frequency bands handed to the visual. */
export const BAND_COUNT = 8;

export interface AudioSample {
  /** Perceptual input level, 0 (silence) to 1 (loud). */
  level: number;
  /** `BAND_COUNT` band energies, 0 to 1, low to high frequencies. */
  bands: Float32Array;
}

export interface UseAudioCaptureOptions {
  /** Auto-stop limit in seconds (the server's `max_audio_seconds`). */
  maxSeconds: number;
  /** Recordings shorter than this are discarded as an accidental press. */
  minDurationMs?: number;
  /** Recordings smaller than this are reported as empty (0 disables the check). */
  minBytes?: number;
  /**
   * Demo only: when no microphone can be used (none plugged in, unsupported browser),
   * "record" without audio so the scripted demo still runs. A refused permission is never
   * papered over.
   */
  allowSynthetic?: boolean;
  onComplete: (result: CaptureResult) => void;
  onDiscard: (reason: DiscardReason) => void;
  onError: (kind: CaptureErrorKind) => void;
}

export interface AudioCapture {
  status: CaptureStatus;
  /** Elapsed recording time, refreshed a few times per second. */
  elapsedMs: number;
  /** True while the current recording has no real microphone behind it. */
  synthetic: boolean;
  /** Must be called from inside a user gesture (permission prompt, audio unlock). */
  start: () => void;
  /** Ends the recording and delivers it (or discards it when too short). */
  stop: () => void;
  /** Ends the recording and throws it away. Nothing is delivered. */
  cancel: (reason?: DiscardReason) => void;
  /** Resumes a suspended AudioContext; call it from later gestures (pointer up, key up). */
  unlock: () => void;
  /** Current level and spectrum; cheap, allocation-free, meant to be called every frame. */
  sample: () => AudioSample;
}

export const MIN_RECORDING_MS = 600;
const TICK_MS = 200;
/** If `MediaRecorder.onstop` never fires, deliver what was collected after this delay. */
const STOP_FALLBACK_MS = 1_000;
const PREFERRED_MIME_TYPES = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus", "audio/mp4"];

type AudioContextConstructor = typeof AudioContext;

function audioContextConstructor(): AudioContextConstructor | null {
  if (typeof window === "undefined") return null;
  const scope = window as unknown as { AudioContext?: AudioContextConstructor; webkitAudioContext?: AudioContextConstructor };
  return scope.AudioContext ?? scope.webkitAudioContext ?? null;
}

export function isCaptureSupported(): boolean {
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

function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

interface Session {
  stream: MediaStream | null;
  recorder: MediaRecorder | null;
  context: AudioContext | null;
  source: MediaStreamAudioSourceNode | null;
  analyser: AnalyserNode | null;
  timeData: Uint8Array<ArrayBuffer> | null;
  frequencyData: Uint8Array<ArrayBuffer> | null;
  chunks: Blob[];
  /** False while the permission is pending: nothing is being recorded yet. */
  started: boolean;
  /** `now()` when recording began. */
  startedAt: number;
  timer: ReturnType<typeof setInterval> | null;
  stopFallback: ReturnType<typeof setTimeout> | null;
  finishing: boolean;
  released: boolean;
  synthetic: boolean;
}

function newSession(): Session {
  return {
    stream: null,
    recorder: null,
    context: null,
    source: null,
    analyser: null,
    timeData: null,
    frequencyData: null,
    chunks: [],
    started: false,
    startedAt: 0,
    timer: null,
    stopFallback: null,
    finishing: false,
    released: false,
    synthetic: false,
  };
}

/** Frees everything a session holds. Idempotent; safe at any point of its life. */
function release(session: Session): void {
  if (session.released) return;
  session.released = true;
  if (session.timer) clearInterval(session.timer);
  if (session.stopFallback) clearTimeout(session.stopFallback);
  session.timer = null;
  session.stopFallback = null;
  const recorder = session.recorder;
  if (recorder) {
    recorder.ondataavailable = null;
    recorder.onstop = null;
    recorder.onerror = null;
    try {
      if (recorder.state !== "inactive") recorder.stop();
    } catch {
      // Already stopped by the browser.
    }
  }
  session.stream?.getTracks().forEach((track) => {
    track.onended = null;
    track.stop();
  });
  try {
    session.source?.disconnect();
  } catch {
    // Node already disconnected.
  }
  const context = session.context;
  if (context && context.state !== "closed") void context.close().catch(() => undefined);
  session.recorder = null;
  session.stream = null;
  session.source = null;
  session.analyser = null;
  session.context = null;
}

/** Deterministic speech-like curve used when there is no analyser to read. */
function syntheticSample(seconds: number, out: AudioSample): void {
  const syllables = Math.abs(Math.sin(seconds * 5.1)) * 0.5 + Math.abs(Math.sin(seconds * 2.3 + 1.2)) * 0.5;
  const phrase = 0.55 + 0.45 * Math.sin(seconds * 0.9);
  out.level = clamp01(0.12 + 0.6 * syllables * phrase);
  for (let i = 0; i < out.bands.length; i += 1) {
    const wave = 0.5 + 0.5 * Math.sin(seconds * (1.7 + i * 0.63) + i * 1.9);
    out.bands[i] = clamp01(out.level * (0.35 + 0.65 * wave) * (1 - i / (out.bands.length * 1.6)));
  }
}

function readAnalyser(session: Session, out: AudioSample): void {
  const analyser = session.analyser;
  const timeData = session.timeData;
  const frequencyData = session.frequencyData;
  if (!analyser || !timeData || !frequencyData) return;

  analyser.getByteTimeDomainData(timeData);
  let sum = 0;
  for (let i = 0; i < timeData.length; i += 1) {
    const centred = ((timeData[i] ?? 128) - 128) / 128;
    sum += centred * centred;
  }
  const rms = Math.sqrt(sum / timeData.length);
  // Speech sits around 0.02–0.3 RMS: a square root spreads that range over the scale.
  out.level = clamp01(Math.sqrt(rms) * 1.6);

  analyser.getByteFrequencyData(frequencyData);
  // Log-spaced bands over the lower half of the spectrum, where the voice lives.
  const usable = Math.max(BAND_COUNT, Math.floor(frequencyData.length * 0.5));
  let from = 1;
  for (let band = 0; band < BAND_COUNT; band += 1) {
    const to = Math.max(from + 1, Math.round(Math.pow(usable, (band + 1) / BAND_COUNT)));
    let total = 0;
    for (let i = from; i < to && i < frequencyData.length; i += 1) total += frequencyData[i] ?? 0;
    out.bands[band] = clamp01(total / ((to - from) * 255));
    from = to;
  }
}

export function useAudioCapture(options: UseAudioCaptureOptions): AudioCapture {
  const [status, setStatus] = useState<CaptureStatus>("idle");
  const [elapsedMs, setElapsedMs] = useState(0);
  const [synthetic, setSynthetic] = useState(false);

  const optionsRef = useRef(options);
  useEffect(() => {
    optionsRef.current = options;
  });

  const sessionRef = useRef<Session | null>(null);
  const sampleRef = useRef<AudioSample>({ level: 0, bands: new Float32Array(BAND_COUNT) });

  /** Closes the session and returns to idle. Every exit path goes through here. */
  const end = useCallback((session: Session) => {
    release(session);
    if (sessionRef.current === session) {
      sessionRef.current = null;
      setStatus("idle");
      setSynthetic(false);
    }
  }, []);

  const deliver = useCallback(
    (session: Session, endedBy: CaptureResult["endedBy"]) => {
      if (session.released) return;
      const durationMs = Math.max(0, now() - session.startedAt);
      const type = session.recorder?.mimeType || session.chunks[0]?.type || "audio/webm";
      const blob = new Blob(session.chunks, { type });
      const wasSynthetic = session.synthetic;
      end(session);
      const { minBytes = 1_000, onComplete, onError } = optionsRef.current;
      if (!wasSynthetic && minBytes > 0 && blob.size < minBytes) onError("empty");
      else onComplete({ blob, durationMs, endedBy, synthetic: wasSynthetic });
    },
    [end],
  );

  const finish = useCallback(
    (session: Session, endedBy: CaptureResult["endedBy"]) => {
      if (session.finishing || session.released) return;
      session.finishing = true;
      if (session.timer) clearInterval(session.timer);
      session.timer = null;
      const recorder = session.recorder;
      if (!recorder || recorder.state === "inactive") {
        deliver(session, endedBy);
        return;
      }
      // The last chunk arrives before `stop`: the blob is built in the handler.
      recorder.onstop = () => deliver(session, endedBy);
      session.stopFallback = setTimeout(() => deliver(session, endedBy), STOP_FALLBACK_MS);
      try {
        recorder.stop();
      } catch {
        deliver(session, endedBy);
      }
    },
    [deliver],
  );

  const discard = useCallback(
    (session: Session, reason: DiscardReason) => {
      if (session.released) return;
      end(session);
      optionsRef.current.onDiscard(reason);
    },
    [end],
  );

  const fail = useCallback(
    (session: Session, kind: CaptureErrorKind) => {
      if (session.released) return;
      end(session);
      optionsRef.current.onError(kind);
    },
    [end],
  );

  const beginRecording = useCallback(
    (session: Session) => {
      session.started = true;
      session.startedAt = now();
      setElapsedMs(0);
      setStatus("recording");
      session.timer = setInterval(() => {
        const elapsed = now() - session.startedAt;
        setElapsedMs(elapsed);
        if (elapsed >= optionsRef.current.maxSeconds * 1_000) finish(session, "max");
      }, TICK_MS);
    },
    [finish],
  );

  const start = useCallback(() => {
    if (sessionRef.current) return;
    const session = newSession();
    sessionRef.current = session;
    setElapsedMs(0);
    setStatus("requesting");

    const startSynthetic = () => {
      session.synthetic = true;
      setSynthetic(true);
      beginRecording(session);
    };

    if (!isCaptureSupported()) {
      if (optionsRef.current.allowSynthetic) startSynthetic();
      else fail(session, "unsupported");
      return;
    }

    // Created synchronously, inside the gesture: Safari only lets an AudioContext run when
    // it is created or resumed from a user action. A failure here only costs the visual.
    const AudioContextClass = audioContextConstructor();
    if (AudioContextClass) {
      try {
        session.context = new AudioContextClass();
        void session.context.resume().catch(() => undefined);
      } catch {
        session.context = null;
      }
    }

    navigator.mediaDevices
      .getUserMedia({ audio: true })
      .then((stream) => {
        if (session.released) {
          // Released, cancelled or unmounted while the permission prompt was open.
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        session.stream = stream;

        let recorder: MediaRecorder;
        try {
          const mimeType = pickMimeType();
          recorder = mimeType ? new MediaRecorder(stream, { mimeType }) : new MediaRecorder(stream);
        } catch {
          fail(session, "unsupported");
          return;
        }
        session.recorder = recorder;
        recorder.ondataavailable = (event: BlobEvent) => {
          if (event.data.size > 0) session.chunks.push(event.data);
        };
        recorder.onerror = () => discard(session, "interrupted");
        // The device was unplugged or the browser revoked it mid-recording.
        stream.getTracks().forEach((track) => {
          track.onended = () => discard(session, "interrupted");
        });

        const context = session.context;
        if (context) {
          try {
            const source = context.createMediaStreamSource(stream);
            const analyser = context.createAnalyser();
            analyser.fftSize = 1024;
            analyser.smoothingTimeConstant = 0.72;
            // Analysis only: never connected to the destination, so nothing is played back.
            source.connect(analyser);
            session.source = source;
            session.analyser = analyser;
            session.timeData = new Uint8Array(analyser.fftSize);
            session.frequencyData = new Uint8Array(analyser.frequencyBinCount);
          } catch {
            session.analyser = null;
          }
        }

        try {
          recorder.start(250);
        } catch {
          fail(session, "unsupported");
          return;
        }
        beginRecording(session);
      })
      .catch((error: unknown) => {
        if (session.released) return;
        const name = error instanceof DOMException || error instanceof Error ? error.name : "";
        if (name === "NotAllowedError" || name === "SecurityError") {
          fail(session, "denied");
          return;
        }
        if (optionsRef.current.allowSynthetic) {
          // No device to record from: free the unused context and run without audio.
          const context = session.context;
          session.context = null;
          if (context && context.state !== "closed") void context.close().catch(() => undefined);
          startSynthetic();
          return;
        }
        fail(session, name === "NotFoundError" || name === "OverconstrainedError" ? "no_microphone" : "unsupported");
      });
  }, [beginRecording, discard, fail]);

  const stop = useCallback(() => {
    const session = sessionRef.current;
    if (!session || session.finishing) return;
    const minDurationMs = optionsRef.current.minDurationMs ?? MIN_RECORDING_MS;
    // Released before the microphone was granted, or too quickly: nothing usable was recorded.
    if (!session.started || now() - session.startedAt < minDurationMs) discard(session, "too_short");
    else finish(session, "user");
  }, [discard, finish]);

  const cancel = useCallback(
    (reason: DiscardReason = "cancelled") => {
      const session = sessionRef.current;
      if (!session) return;
      discard(session, reason);
    },
    [discard],
  );

  const unlock = useCallback(() => {
    const context = sessionRef.current?.context;
    if (context && context.state === "suspended") void context.resume().catch(() => undefined);
  }, []);

  const sample = useCallback((): AudioSample => {
    const out = sampleRef.current;
    const session = sessionRef.current;
    if (!session || !session.started || session.finishing) {
      out.level = 0;
      out.bands.fill(0);
      return out;
    }
    if (session.analyser && session.context?.state === "running") readAnalyser(session, out);
    // No analyser (demo without a microphone) or a context the browser keeps suspended:
    // the screen still shows that a recording is running.
    else syntheticSample((now() - session.startedAt) / 1_000, out);
    return out;
  }, []);

  // Unmount is an exit path too.
  useEffect(
    () => () => {
      const session = sessionRef.current;
      sessionRef.current = null;
      if (session) release(session);
    },
    [],
  );

  return useMemo(
    () => ({ status, elapsedMs, synthetic, start, stop, cancel, unlock, sample }),
    [status, elapsedMs, synthetic, start, stop, cancel, unlock, sample],
  );
}
