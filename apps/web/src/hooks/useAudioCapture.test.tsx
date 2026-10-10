import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MIN_RECORDING_MS, useAudioCapture, type UseAudioCaptureOptions } from "./useAudioCapture";

/**
 * jsdom has no media stack: getUserMedia, MediaRecorder and AudioContext are replaced by
 * minimal fakes that record what the hook does with them. What is verified is the hook's
 * own contract — above all that every exit path stops the tracks and closes the context.
 */

class FakeTrack {
  stopped = false;
  onended: (() => void) | null = null;
  stop() {
    this.stopped = true;
  }
}

class FakeStream {
  tracks = [new FakeTrack()];
  getTracks() {
    return this.tracks;
  }
}

class FakeRecorder {
  static instances: FakeRecorder[] = [];
  static isTypeSupported = (type: string) => type === "audio/webm";
  /** Bytes delivered when the recording stops. */
  static payload = "x".repeat(4_000);

  state: "inactive" | "recording" = "inactive";
  mimeType: string;
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(
    public stream: FakeStream,
    options?: { mimeType?: string },
  ) {
    this.mimeType = options?.mimeType ?? "";
    FakeRecorder.instances.push(this);
  }

  start() {
    this.state = "recording";
  }

  stop() {
    if (this.state === "inactive") return;
    this.state = "inactive";
    this.ondataavailable?.({ data: new Blob([FakeRecorder.payload], { type: this.mimeType }) });
    this.onstop?.();
  }
}

class FakeAudioContext {
  static instances: FakeAudioContext[] = [];
  state: "running" | "suspended" | "closed" = "running";
  source = { connect: vi.fn(), disconnect: vi.fn() };

  constructor() {
    FakeAudioContext.instances.push(this);
  }

  resume = vi.fn(async () => {
    if (this.state !== "closed") this.state = "running";
  });

  close = vi.fn(async () => {
    this.state = "closed";
  });

  createMediaStreamSource() {
    return this.source;
  }

  createAnalyser() {
    return {
      fftSize: 1024,
      frequencyBinCount: 512,
      smoothingTimeConstant: 0,
      // A constant half-scale signal: a clearly non-zero level.
      getByteTimeDomainData: (data: Uint8Array) => data.fill(192),
      getByteFrequencyData: (data: Uint8Array) => data.fill(128),
    };
  }
}

let stream: FakeStream;
let getUserMedia: ReturnType<typeof vi.fn>;

function installMedia() {
  stream = new FakeStream();
  getUserMedia = vi.fn(async () => stream);
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia } });
  vi.stubGlobal("MediaRecorder", FakeRecorder);
  vi.stubGlobal("AudioContext", FakeAudioContext);
}

function removeMedia() {
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: undefined });
  vi.unstubAllGlobals();
}

function mount(overrides: Partial<UseAudioCaptureOptions> = {}) {
  const callbacks = { onComplete: vi.fn(), onDiscard: vi.fn(), onError: vi.fn() };
  const hook = renderHook(() => useAudioCapture({ maxSeconds: 120, ...callbacks, ...overrides }));
  return { ...hook, ...callbacks };
}

/** Starts and lets the permission promise resolve. */
async function startRecording(result: { current: ReturnType<typeof useAudioCapture> }) {
  act(() => result.current.start());
  await act(async () => {
    await Promise.resolve();
  });
}

const context = () => FakeAudioContext.instances.at(-1);
const recorder = () => FakeRecorder.instances.at(-1);

function expectReleased() {
  expect(stream.tracks.every((track) => track.stopped)).toBe(true);
  expect(context()?.close).toHaveBeenCalledTimes(1);
  expect(context()?.state).toBe("closed");
}

describe("useAudioCapture", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    FakeRecorder.instances = [];
    FakeRecorder.payload = "x".repeat(4_000);
    FakeAudioContext.instances = [];
    installMedia();
  });

  afterEach(() => {
    removeMedia();
    vi.useRealTimers();
  });

  it("requests the microphone, records, and delivers the recording when stopped", async () => {
    const { result, onComplete, onDiscard } = mount();
    expect(result.current.status).toBe("idle");

    act(() => result.current.start());
    expect(result.current.status).toBe("requesting");
    expect(getUserMedia).toHaveBeenCalledWith({ audio: true });
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.status).toBe("recording");
    expect(recorder()?.state).toBe("recording");
    expect(recorder()?.mimeType).toBe("audio/webm");

    act(() => vi.advanceTimersByTime(1_500));
    expect(result.current.elapsedMs).toBeGreaterThanOrEqual(1_400);
    act(() => result.current.stop());

    expect(onComplete).toHaveBeenCalledTimes(1);
    const delivered = onComplete.mock.calls[0]?.[0];
    expect(delivered.blob.size).toBe(4_000);
    expect(delivered.blob.type).toBe("audio/webm");
    expect(delivered.endedBy).toBe("user");
    expect(delivered.synthetic).toBe(false);
    expect(delivered.durationMs).toBeGreaterThanOrEqual(1_500);
    expect(onDiscard).not.toHaveBeenCalled();
    expect(result.current.status).toBe("idle");
    expectReleased();
  });

  it("feeds the analyser from the same stream as the recorder and reports a level", async () => {
    const { result } = mount();
    await startRecording(result);
    expect(recorder()?.stream).toBe(stream);
    expect(context()?.source.connect).toHaveBeenCalledTimes(1);

    const sample = result.current.sample();
    expect(sample.level).toBeGreaterThan(0.5);
    expect(sample.level).toBeLessThanOrEqual(1);
    expect(Array.from(sample.bands).every((band) => band > 0 && band <= 1)).toBe(true);
    act(() => result.current.cancel());
    expect(result.current.sample().level).toBe(0);
  });

  it("discards a recording shorter than the minimum and releases the microphone", async () => {
    const { result, onComplete, onDiscard } = mount();
    await startRecording(result);
    act(() => vi.advanceTimersByTime(MIN_RECORDING_MS - 100));
    act(() => result.current.stop());

    expect(onDiscard).toHaveBeenCalledWith("too_short");
    expect(onComplete).not.toHaveBeenCalled();
    expectReleased();
  });

  it("released before the permission was granted: discarded, and the late stream is stopped", async () => {
    let grant: (value: FakeStream) => void = () => undefined;
    getUserMedia.mockImplementationOnce(() => new Promise<FakeStream>((resolve) => (grant = resolve)));
    const { result, onDiscard, onComplete } = mount();

    act(() => result.current.start());
    act(() => result.current.stop());
    expect(onDiscard).toHaveBeenCalledWith("too_short");
    expect(result.current.status).toBe("idle");
    expect(context()?.state).toBe("closed");

    await act(async () => {
      grant(stream);
      await Promise.resolve();
    });
    expect(stream.tracks[0]?.stopped).toBe(true);
    expect(FakeRecorder.instances).toHaveLength(0);
    expect(onComplete).not.toHaveBeenCalled();
  });

  it("cancel throws the recording away: nothing is delivered", async () => {
    const { result, onComplete, onDiscard } = mount();
    await startRecording(result);
    act(() => vi.advanceTimersByTime(3_000));
    act(() => result.current.cancel());

    expect(onDiscard).toHaveBeenCalledWith("cancelled");
    expect(onComplete).not.toHaveBeenCalled();
    expect(recorder()?.state).toBe("inactive");
    expectReleased();
  });

  it("an interruption is reported as such", async () => {
    const { result, onDiscard } = mount();
    await startRecording(result);
    act(() => result.current.cancel("interrupted"));
    expect(onDiscard).toHaveBeenCalledWith("interrupted");
    expectReleased();
  });

  it("a microphone that disappears mid-recording interrupts it", async () => {
    const { result, onDiscard, onComplete } = mount();
    await startRecording(result);
    act(() => stream.tracks[0]?.onended?.());
    expect(onDiscard).toHaveBeenCalledWith("interrupted");
    expect(onComplete).not.toHaveBeenCalled();
    expect(context()?.state).toBe("closed");
  });

  it("stops by itself at the server's maximum duration and delivers the recording", async () => {
    const { result, onComplete } = mount({ maxSeconds: 2 });
    await startRecording(result);
    act(() => vi.advanceTimersByTime(1_800));
    expect(onComplete).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(400));

    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete.mock.calls[0]?.[0].endedBy).toBe("max");
    expect(result.current.status).toBe("idle");
    expectReleased();
  });

  it("reports a refused permission and closes the audio context", async () => {
    getUserMedia.mockRejectedValueOnce(new DOMException("denied", "NotAllowedError"));
    const { result, onError } = mount({ allowSynthetic: true });
    await startRecording(result);
    // Never papered over by the demo fallback.
    expect(onError).toHaveBeenCalledWith("denied");
    expect(result.current.status).toBe("idle");
    expect(context()?.state).toBe("closed");
  });

  it("reports a missing microphone", async () => {
    getUserMedia.mockRejectedValueOnce(new DOMException("none", "NotFoundError"));
    const { result, onError } = mount();
    await startRecording(result);
    expect(onError).toHaveBeenCalledWith("no_microphone");
    expect(context()?.state).toBe("closed");
  });

  it("reports an empty recording instead of uploading it", async () => {
    FakeRecorder.payload = "";
    const { result, onError, onComplete } = mount();
    await startRecording(result);
    act(() => vi.advanceTimersByTime(2_000));
    act(() => result.current.stop());
    expect(onError).toHaveBeenCalledWith("empty");
    expect(onComplete).not.toHaveBeenCalled();
    expectReleased();
  });

  it("releases everything when the component unmounts while recording", async () => {
    const { result, unmount, onComplete, onDiscard } = mount();
    await startRecording(result);
    unmount();
    expectReleased();
    expect(recorder()?.state).toBe("inactive");
    expect(onComplete).not.toHaveBeenCalled();
    expect(onDiscard).not.toHaveBeenCalled();
  });

  it("ignores a second start while one is running", async () => {
    const { result } = mount();
    await startRecording(result);
    act(() => result.current.start());
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    act(() => result.current.cancel());
  });

  it("can record again after any exit", async () => {
    const { result, onComplete } = mount();
    await startRecording(result);
    act(() => result.current.cancel());

    stream = new FakeStream();
    getUserMedia.mockResolvedValueOnce(stream);
    await startRecording(result);
    act(() => vi.advanceTimersByTime(1_000));
    act(() => result.current.stop());
    expect(onComplete).toHaveBeenCalledTimes(1);
    expectReleased();
  });

  it("resumes a suspended audio context on later gestures", async () => {
    const { result } = mount();
    await startRecording(result);
    const audio = context();
    if (audio) audio.state = "suspended";
    act(() => result.current.unlock());
    expect(audio?.resume).toHaveBeenCalledTimes(2);
    act(() => result.current.cancel());
  });

  describe("without any capture support", () => {
    beforeEach(() => {
      removeMedia();
    });

    it("reports an unsupported browser", () => {
      const { result, onError } = mount();
      act(() => result.current.start());
      expect(onError).toHaveBeenCalledWith("unsupported");
      expect(result.current.status).toBe("idle");
    });

    it("demo only: records without audio so the scripted flow still runs", () => {
      const { result, onComplete } = mount({ allowSynthetic: true });
      act(() => result.current.start());
      expect(result.current.status).toBe("recording");
      expect(result.current.synthetic).toBe(true);
      act(() => vi.advanceTimersByTime(1_000));
      expect(result.current.sample().level).toBeGreaterThan(0);
      act(() => result.current.stop());
      expect(onComplete).toHaveBeenCalledTimes(1);
      expect(onComplete.mock.calls[0]?.[0]).toMatchObject({ synthetic: true, endedBy: "user" });
    });
  });
});
