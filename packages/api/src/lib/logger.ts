import pino from "pino";

export type Logger = pino.Logger;

export const REDACT_PATHS = [
  "req.headers.authorization",
  "req.headers.cookie",
  "res.headers['set-cookie']",
  "*.apiKey",
  "*.api_key",
  "*.secret",
  "*.token",
  "*.accessToken",
  "*.refreshToken",
  "*.password",
  "*.encryptedSecret",
];

export function createLogger(name = "video-generator", level = process.env.LOG_LEVEL ?? "info"): Logger {
  return pino({
    name,
    level,
    redact: {
      paths: REDACT_PATHS,
      censor: "[REDACTED]",
    },
  });
}
