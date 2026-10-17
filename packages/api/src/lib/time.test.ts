import { describe, expect, it } from "vitest";

import { dayKey, getDayPeriod, getMonthPeriod } from "./time";

describe("time periods", () => {
  const now = new Date("2026-10-17T12:00:00.000Z");

  it("computes the calendar month in Asia/Kolkata", () => {
    const period = getMonthPeriod(now, "Asia/Kolkata");
    expect(period.start.toISOString()).toBe("2026-09-30T18:30:00.000Z");
    expect(period.end.toISOString()).toBe("2026-10-31T18:30:00.000Z");
  });

  it("computes the local day boundaries", () => {
    const period = getDayPeriod(now, "Asia/Kolkata");
    expect(period.start.toISOString()).toBe("2026-10-16T18:30:00.000Z");
    expect(period.end.toISOString()).toBe("2026-10-17T18:30:00.000Z");
    expect(dayKey(now, "Asia/Kolkata")).toBe("2026-10-17");
  });
});
