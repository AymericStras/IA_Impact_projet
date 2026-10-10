import { describe, expect, it } from "vitest";
import { formatClock, formatDay, formatDuration, formatTimeNoWrap } from "./format";

const NBSP = " ";

describe("journey formatting helpers", () => {
  it("formats the clock time of an ISO date-time in Paris", () => {
    expect(formatClock("2026-11-12T08:05+01:00")).toBe(`8${NBSP}h${NBSP}05`);
    expect(formatClock("2026-11-12T17:20:00+01:00")).toBe(`17${NBSP}h${NBSP}20`);
    expect(formatClock("2026-11-12T00:00+01:00")).toBe(`0${NBSP}h${NBSP}00`);
    // Whatever offset the server used, the time shown is the Paris one.
    expect(formatClock("2026-07-01T06:30:00Z")).toBe(`8${NBSP}h${NBSP}30`);
  });

  it("shows an unreadable value as received instead of inventing a time", () => {
    expect(formatClock("bientôt")).toBe("bientôt");
    expect(formatDay("bientôt")).toBe("bientôt");
  });

  it("formats the day of an ISO date-time in Paris", () => {
    const now = new Date("2026-10-10T10:00:00+02:00");
    expect(formatDay("2026-11-12T08:05+01:00", now)).toBe("jeudi 12 novembre");
    // 23:30 UTC is already the next day in Paris.
    expect(formatDay("2026-11-12T23:30:00Z", now)).toBe("vendredi 13 novembre");
    expect(formatDay("2027-01-05T08:00+01:00", now)).toBe("mardi 5 janvier 2027");
  });

  it("formats durations", () => {
    expect(formatDuration(45)).toBe(`45${NBSP}min`);
    expect(formatDuration(60)).toBe(`1${NBSP}h`);
    expect(formatDuration(75)).toBe(`1${NBSP}h${NBSP}15`);
    expect(formatDuration(125)).toBe(`2${NBSP}h${NBSP}05`);
    expect(formatDuration(0)).toBe(`0${NBSP}min`);
  });

  it("keeps a requirement time on one line", () => {
    expect(formatTimeNoWrap("17:30")).toBe(`17${NBSP}h${NBSP}30`);
  });
});
