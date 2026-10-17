import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

export async function createTempDir(prefix = "reel-"): Promise<string> {
  return mkdtemp(path.join(tmpdir(), prefix));
}

export async function writeTempFile(
  dir: string,
  name: string,
  data: string | Buffer,
): Promise<string> {
  const filePath = path.join(dir, name);
  await writeFile(filePath, data);
  return filePath;
}

export async function readFileBuffer(filePath: string): Promise<Buffer> {
  return readFile(filePath);
}

export async function cleanupDir(dir: string): Promise<void> {
  await rm(dir, { recursive: true, force: true });
}

export async function ensureDir(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true });
}

export async function fileExists(filePath: string): Promise<boolean> {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

export async function fileSize(filePath: string): Promise<number> {
  const info = await stat(filePath);
  return info.size;
}

export function safeJoin(root: string, key: string): string {
  const normalizedRoot = path.resolve(root);
  const target = path.resolve(normalizedRoot, key);
  if (target !== normalizedRoot && !target.startsWith(normalizedRoot + path.sep)) {
    throw new Error("Invalid storage key");
  }
  return target;
}
