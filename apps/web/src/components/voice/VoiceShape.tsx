"use client";

import { useEffect, useRef, useState } from "react";
import { BAND_COUNT, type AudioSample } from "@/hooks/useAudioCapture";
import { frVoice } from "@/i18n/fr.voice";
import { fixedVoiceLevel } from "./voiceTestHooks";

interface VoiceShapeProps {
  /** Current level and spectrum; called once per frame. */
  sample: () => AudioSample;
  /** Static level meter instead of the animated shape. */
  reducedMotion: boolean;
}

/** Instant used for the frozen (deterministic) rendering. */
const FROZEN_TIME = 2.4;
const TAU = Math.PI * 2;
const POINTS = 72;
const MAX_PIXEL_RATIO = 3;
const METER_SEGMENTS = 12;
const METER_REFRESH_MS = 160;

/** Three translucent layers, outer to inner, then a solid core. */
const LAYERS = [
  { radius: 0.6, alpha: 0.1, speed: 0.31, direction: 1 },
  { radius: 0.47, alpha: 0.14, speed: 0.47, direction: -1 },
  { radius: 0.34, alpha: 0.2, speed: 0.63, direction: 1 },
] as const;
/** Lobes of the outline; their strength follows the voice's frequency bands. */
const HARMONICS = [2, 3, 5] as const;
const RIPPLE_LIFE = 1.5;
const RIPPLE_MIN_INTERVAL = 0.38;

interface ShapeState {
  level: number;
  bands: Float32Array;
  ripples: number[];
  lastRipple: number;
  previousLevel: number;
}

function approach(current: number, target: number, dt: number, attack: number, release: number): number {
  const tau = target > current ? attack : release;
  return current + (target - current) * (1 - Math.exp(-dt / tau));
}

function frozenBands(level: number, out: Float32Array): void {
  for (let i = 0; i < out.length; i += 1) out[i] = level * (0.9 - i * 0.08);
}

/** Closed smooth outline through `POINTS` polar samples (quadratic curves through midpoints). */
function traceBlob(ctx: CanvasRenderingContext2D, cx: number, cy: number, radiusAt: (angle: number) => number): void {
  let previousX = 0;
  let previousY = 0;
  ctx.beginPath();
  for (let i = 0; i <= POINTS + 1; i += 1) {
    const angle = (i % POINTS) * (TAU / POINTS);
    const radius = radiusAt(angle);
    const x = cx + Math.cos(angle) * radius;
    const y = cy + Math.sin(angle) * radius;
    if (i > 0) {
      const midX = (previousX + x) / 2;
      const midY = (previousY + y) / 2;
      if (i === 1) {
        ctx.moveTo(midX, midY);
      } else {
        ctx.quadraticCurveTo(previousX, previousY, midX, midY);
      }
    }
    previousX = x;
    previousY = y;
  }
  ctx.closePath();
}

function drawShape(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  time: number,
  state: ShapeState,
  color: string,
): void {
  ctx.clearRect(0, 0, width, height);
  const cx = width / 2;
  const cy = height / 2;
  const full = Math.min(width, height) / 2;
  if (full < 4) return;
  const level = state.level;
  // A slow breath keeps the shape alive in silence.
  const breath = 0.012 * Math.sin(time * 1.3);
  ctx.fillStyle = color;
  ctx.strokeStyle = color;

  // Rings released by voice peaks, travelling outwards.
  ctx.lineWidth = Math.max(1, full * 0.008);
  for (const born of state.ripples) {
    const age = (time - born) / RIPPLE_LIFE;
    if (age < 0 || age >= 1) continue;
    const eased = 1 - (1 - age) * (1 - age);
    ctx.globalAlpha = 0.32 * (1 - age);
    ctx.beginPath();
    ctx.arc(cx, cy, full * (0.5 + 0.48 * eased), 0, TAU);
    ctx.stroke();
  }

  LAYERS.forEach((layer, index) => {
    const base = full * (layer.radius + breath + 0.22 * level * (1 - index * 0.12));
    ctx.globalAlpha = layer.alpha;
    traceBlob(ctx, cx, cy, (angle) => {
      let wobble = 0;
      for (let h = 0; h < HARMONICS.length; h += 1) {
        const harmonic = HARMONICS[h] ?? 2;
        const band = state.bands[(h * 2 + index) % BAND_COUNT] ?? 0;
        const amplitude = 0.012 + 0.04 * band + 0.012 * level;
        wobble += amplitude * Math.sin(harmonic * angle + layer.direction * time * layer.speed * (h + 1.4) + index * 1.9 + h * 0.7);
      }
      return base * (1 + wobble);
    });
    ctx.fill();
  });

  // Solid core: the stable centre the layers move around.
  ctx.globalAlpha = 1;
  ctx.beginPath();
  ctx.arc(cx, cy, full * (0.15 + 0.07 * level + breath), 0, TAU);
  ctx.fill();
}

/**
 * The voice made visible: layered organic outlines that swell with the input level and
 * whose lobes follow its spectrum, with rings released on voice peaks. 2D canvas only
 * (decision D5), sized to its box at the device pixel ratio, redrawn in the same task as
 * a resize so it never flashes blank. Decorative: the state is also given as text.
 */
export function VoiceShape({ sample, reducedMotion }: VoiceShapeProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const sampleRef = useRef(sample);
  useEffect(() => {
    sampleRef.current = sample;
  });

  useEffect(() => {
    if (reducedMotion) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;

    const fixed = fixedVoiceLevel();
    const state: ShapeState = {
      level: fixed ?? 0,
      bands: new Float32Array(BAND_COUNT),
      ripples: [],
      lastRipple: -Infinity,
      previousLevel: 0,
    };
    if (fixed !== null) {
      frozenBands(fixed, state.bands);
      // Two rings mid-flight, so the frozen picture shows the whole vocabulary of the shape.
      state.ripples.push(FROZEN_TIME - 0.95, FROZEN_TIME - 0.3);
    }

    let width = 0;
    let height = 0;
    let color = "#fff";
    let frame = 0;
    let time = fixed !== null ? FROZEN_TIME : 0;
    let last = 0;

    const paint = () => drawShape(ctx, width, height, time, state, color);

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      const ratio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
      const pixelWidth = Math.max(1, Math.round(rect.width * ratio));
      const pixelHeight = Math.max(1, Math.round(rect.height * ratio));
      if (canvas.width !== pixelWidth || canvas.height !== pixelHeight) {
        canvas.width = pixelWidth;
        canvas.height = pixelHeight;
      }
      width = rect.width;
      height = rect.height;
      // Draw in CSS pixels whatever the density.
      ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
      color = getComputedStyle(canvas).color || color;
      // Setting the size clears the canvas: repaint now, not on the next frame.
      paint();
    };

    const tick = (timestamp: number) => {
      const dt = last === 0 ? 0 : Math.min(0.05, (timestamp - last) / 1_000);
      last = timestamp;
      time += dt;
      const current = sampleRef.current();
      // Fast attack, slower release: the shape jumps with the voice and settles gently.
      state.level = approach(state.level, current.level, dt, 0.05, 0.26);
      for (let i = 0; i < BAND_COUNT; i += 1) {
        state.bands[i] = approach(state.bands[i] ?? 0, current.bands[i] ?? 0, dt, 0.07, 0.3);
      }
      const rising = current.level - state.previousLevel;
      if (current.level > 0.32 && rising > 0.04 && time - state.lastRipple > RIPPLE_MIN_INTERVAL) {
        state.ripples.push(time);
        state.lastRipple = time;
      }
      state.previousLevel = current.level;
      while (state.ripples.length > 0 && time - (state.ripples[0] ?? 0) > RIPPLE_LIFE) state.ripples.shift();
      paint();
      frame = requestAnimationFrame(tick);
    };

    resize();
    const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(resize) : null;
    observer?.observe(canvas);
    // Moving the window to a screen of another density changes the ratio without a resize.
    window.addEventListener("resize", resize);
    if (fixed === null) frame = requestAnimationFrame(tick);

    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener("resize", resize);
    };
  }, [reducedMotion]);

  if (reducedMotion) return <LevelMeter sample={sample} />;
  return <canvas ref={canvasRef} aria-hidden="true" className="text-primary-foreground" data-testid="voice-canvas" />;
}

/** Reduced motion: a stepped level meter, refreshed a few times per second, no animation. */
function LevelMeter({ sample }: { sample: () => AudioSample }) {
  const [lit, setLit] = useState(() => Math.round((fixedVoiceLevel() ?? 0) * METER_SEGMENTS));
  const sampleRef = useRef(sample);
  useEffect(() => {
    sampleRef.current = sample;
  });

  useEffect(() => {
    if (fixedVoiceLevel() !== null) return;
    const timer = setInterval(() => setLit(Math.round(sampleRef.current().level * METER_SEGMENTS)), METER_REFRESH_MS);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="absolute inset-0 flex items-center justify-center">
      <div
        role="meter"
        aria-label={frVoice.listen.levelLabel}
        aria-valuemin={0}
        aria-valuemax={METER_SEGMENTS}
        aria-valuenow={lit}
        className="flex h-16 w-full max-w-xs items-end gap-1.5"
        data-testid="voice-meter"
      >
        {Array.from({ length: METER_SEGMENTS }, (_, index) => (
          <span
            key={index}
            // Lit segments are solid, the others outlined: readable without colour.
            className={
              index < lit
                ? "flex-1 rounded-sm bg-primary-foreground"
                : "flex-1 rounded-sm border border-primary-foreground/70"
            }
            style={{ height: `${30 + (70 * (index + 1)) / METER_SEGMENTS}%` }}
          />
        ))}
      </div>
    </div>
  );
}
