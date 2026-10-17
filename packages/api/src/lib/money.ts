export const MICRO_USD_PER_USD = 1_000_000;
export const PAISE_PER_INR = 100;

export function roundInt(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value);
}

export function usdToMicros(usd: number): number {
  return roundInt(usd * MICRO_USD_PER_USD);
}

export function microsToUsd(micros: number): number {
  return micros / MICRO_USD_PER_USD;
}

export function usdToPaise(
  usd: number,
  usdToInrRate: number,
  taxPercent = 0,
  feePercent = 0,
): number {
  const multiplier = 1 + taxPercent / 100 + feePercent / 100;
  return roundInt(usd * multiplier * usdToInrRate * PAISE_PER_INR);
}

export function paiseToInr(paise: number): number {
  return paise / PAISE_PER_INR;
}

export function formatInrPaise(paise: number): string {
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 2,
  }).format(paiseToInr(paise));
}

export function formatUsdMicros(micros: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 4,
  }).format(microsToUsd(micros));
}

export function percentOf(amount: number, percent: number): number {
  return roundInt((amount * percent) / 100);
}
