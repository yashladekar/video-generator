import { fromZonedTime, toZonedTime } from "date-fns-tz";

export function getMonthPeriod(now: Date, timezone: string) {
  const zoned = toZonedTime(now, timezone);
  const year = zoned.getFullYear();
  const month = zoned.getMonth();
  const startLocal = new Date(year, month, 1, 0, 0, 0, 0);
  const endLocal = new Date(year, month + 1, 1, 0, 0, 0, 0);
  return {
    start: fromZonedTime(startLocal, timezone),
    end: fromZonedTime(endLocal, timezone),
  };
}

export function getDayPeriod(now: Date, timezone: string) {
  const zoned = toZonedTime(now, timezone);
  const year = zoned.getFullYear();
  const month = zoned.getMonth();
  const day = zoned.getDate();
  const startLocal = new Date(year, month, day, 0, 0, 0, 0);
  const endLocal = new Date(year, month, day + 1, 0, 0, 0, 0);
  return {
    start: fromZonedTime(startLocal, timezone),
    end: fromZonedTime(endLocal, timezone),
  };
}

export function dayKey(now: Date, timezone: string): string {
  const zoned = toZonedTime(now, timezone);
  const year = zoned.getFullYear();
  const month = String(zoned.getMonth() + 1).padStart(2, "0");
  const day = String(zoned.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function secondsToClock(seconds: number): string {
  const safe = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(safe / 60);
  const rest = safe % 60;
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}
