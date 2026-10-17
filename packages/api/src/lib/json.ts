import type { Prisma } from "@video-generator/db";

export function toJsonValue(
  value: unknown,
): Prisma.InputJsonValue | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null as unknown as Prisma.InputJsonValue;
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}
