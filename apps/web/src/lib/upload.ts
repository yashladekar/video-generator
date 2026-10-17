export type UploadedAsset = {
  id: string;
  kind: string;
  mimeType: string;
  url: string;
  width?: number | null;
  height?: number | null;
  durationSeconds?: number | null;
  attribution?: string | null;
  originalName?: string | null;
};

export async function uploadFile(
  file: File,
  options?: { projectId?: string; kind?: "visual" | "reference" },
): Promise<UploadedAsset> {
  const form = new FormData();
  form.append("file", file);
  if (options?.projectId) form.append("projectId", options.projectId);
  if (options?.kind) form.append("kind", options.kind);
  const baseUrl = process.env.NEXT_PUBLIC_SERVER_URL ?? "http://localhost:3000";
  const response = await fetch(`${baseUrl.replace(/\/+$/, "")}/api/uploads`, {
    method: "POST",
    body: form,
    credentials: "include",
  });
  if (!response.ok) {
    let message = `Upload failed (${response.status})`;
    try {
      const data = (await response.json()) as { error?: string };
      if (data.error) message = data.error;
    } catch {
      // ignore
    }
    throw new Error(message);
  }
  return (await response.json()) as UploadedAsset;
}
