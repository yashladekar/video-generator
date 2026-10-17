import { describe, expect, it } from "vitest";

import {
  formatInrPaise,
  microsToUsd,
  percentOf,
  usdToMicros,
  usdToPaise,
} from "./money";

describe("money", () => {
  it("converts USD to micro-USD", () => {
    expect(usdToMicros(0.05)).toBe(50_000);
    expect(microsToUsd(50_000)).toBeCloseTo(0.05);
  });

  it("applies FX, tax, and fees when converting to paise", () => {
    expect(usdToPaise(0.05, 88)).toBe(440);
    expect(usdToPaise(0.05, 88, 18, 2)).toBe(528);
  });

  it("computes percentage reserves with integer rounding", () => {
    expect(percentOf(50_000, 15)).toBe(7_500);
    expect(percentOf(49_999, 15)).toBe(7_500);
  });

  it("formats INR paise", () => {
    expect(formatInrPaise(50_000)).toContain("500");
  });
});
