import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

function normalizeKey(secret: string): Buffer {
  const decoded = Buffer.from(secret, "base64");
  if (decoded.length === 32) return decoded;
  return createHash("sha256").update(secret).digest();
}

export function encryptSecret(plaintext: string, secret: string): string {
  const key = normalizeKey(secret);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return [
    "v1",
    iv.toString("base64url"),
    tag.toString("base64url"),
    encrypted.toString("base64url"),
  ].join(".");
}

export function decryptSecret(payload: string, secret: string): string {
  const [version, ivPart, tagPart, cipherPart] = payload.split(".");
  if (version !== "v1" || !ivPart || !tagPart || !cipherPart) {
    throw new Error("Unsupported encrypted secret format");
  }
  const key = normalizeKey(secret);
  const decipher = createDecipheriv(
    "aes-256-gcm",
    key,
    Buffer.from(ivPart, "base64url"),
  );
  decipher.setAuthTag(Buffer.from(tagPart, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(cipherPart, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

export function maskSecret(value: string): string {
  if (value.length <= 4) return "****";
  return `****${value.slice(-4)}`;
}

export function signMediaToken(
  assetId: string,
  expiresAtMs: number,
  secret: string,
): string {
  const payload = `${assetId}.${expiresAtMs}`;
  const sig = createHmac("sha256", normalizeKey(secret))
    .update(payload)
    .digest("base64url");
  return `${payload}.${sig}`;
}

export function verifyMediaToken(
  token: string,
  secret: string,
): { assetId: string; expiresAtMs: number } | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [assetId, expiresAtRaw, signature] = parts;
  if (!assetId || !expiresAtRaw || !signature) return null;
  const expiresAtMs = Number(expiresAtRaw);
  if (!Number.isFinite(expiresAtMs) || expiresAtMs < Date.now()) return null;
  const expected = createHmac("sha256", normalizeKey(secret))
    .update(`${assetId}.${expiresAtRaw}`)
    .digest("base64url");
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  return { assetId, expiresAtMs };
}

export function createOAuthState(
  userId: string,
  secret: string,
  ttlMs = 10 * 60 * 1000,
): string {
  const payload = Buffer.from(
    JSON.stringify({ userId, exp: Date.now() + ttlMs }),
    "utf8",
  ).toString("base64url");
  const sig = createHmac("sha256", normalizeKey(secret))
    .update(payload)
    .digest("base64url");
  return `${payload}.${sig}`;
}

export function verifyOAuthState(
  state: string,
  secret: string,
): { userId: string } | null {
  const [payload, signature] = state.split(".");
  if (!payload || !signature) return null;
  const expected = createHmac("sha256", normalizeKey(secret))
    .update(payload)
    .digest("base64url");
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      userId?: unknown;
      exp?: unknown;
    };
    if (typeof parsed.userId !== "string" || typeof parsed.exp !== "number") {
      return null;
    }
    if (parsed.exp < Date.now()) return null;
    return { userId: parsed.userId };
  } catch {
    return null;
  }
}
