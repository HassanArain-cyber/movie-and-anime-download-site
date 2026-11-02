import type { CompletedUpload, InitializedUpload, UploadKind, UploadTarget } from "./types";

export class UploadError extends Error {
  constructor(message: string, public uploadId?: string) { super(message); this.name = "UploadError"; }
}

type Options = UploadTarget & {
  kind: UploadKind;
  resumeId?: string;
  signal?: AbortSignal;
  onProgress?: (percent: number, uploadedBytes: number) => void;
  onSession?: (id: string) => void;
};

async function jsonError(res: Response): Promise<string> {
  try { const data = await res.json(); return data.error || `Request failed (${res.status})`; }
  catch { return `Request failed (${res.status})`; }
}

function putPart(part: InitializedUpload["parts"][number], blob: Blob, signal: AbortSignal | undefined, onLoaded: (loaded: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", part.url);
    xhr.withCredentials = false;
    for (const [key, value] of Object.entries(part.headers)) xhr.setRequestHeader(key, value);
    xhr.upload.onprogress = (event) => onLoaded(event.lengthComputable ? event.loaded : 0);
    const cleanup = () => signal?.removeEventListener("abort", onAbort);
    const onAbort = () => xhr.abort();
    xhr.onload = () => { cleanup(); xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`R2 part upload failed (${xhr.status}). Check bucket CORS and credentials.`)); };
    xhr.onerror = () => {
      cleanup();
      const origin = typeof window === "undefined" ? "this site" : window.location.origin;
      reject(new Error(`The browser could not reach R2 from ${origin}. This is commonly caused by the bucket CORS policy missing this exact origin for PUT requests; also check the network and storage endpoint.`));
    };
    xhr.onabort = () => { cleanup(); reject(new DOMException("Upload cancelled", "AbortError")); };
    xhr.ontimeout = () => { cleanup(); reject(new Error("R2 upload timed out")); };
    if (signal) {
      if (signal.aborted) { xhr.abort(); return; }
      signal.addEventListener("abort", onAbort, { once: true });
    }
    xhr.send(blob);
  });
}

/** Direct browser-to-R2 multipart upload. No file bytes are sent to Next.js. */
export async function uploadToR2(file: File, options: Options): Promise<CompletedUpload> {
  const { kind, signal, onProgress, onSession, resumeId, ...target } = options;
  let session: InitializedUpload;
  if (resumeId) {
    const res = await fetch(`/api/uploads/${resumeId}`, { signal });
    if (!res.ok) throw new UploadError(await jsonError(res), resumeId);
    const data = await res.json();
    if (!data.parts) throw new UploadError("The previous upload cannot be resumed. Start a new upload.", resumeId);
    session = data as InitializedUpload;
    const expectedTarget = { mediaId: target.mediaId ?? null, seasonId: target.seasonId ?? null, episodeId: target.episodeId ?? null, quality: target.quality ?? null };
    const sameTarget = session.target && session.target.mediaId === expectedTarget.mediaId && session.target.seasonId === expectedTarget.seasonId && session.target.episodeId === expectedTarget.episodeId && session.target.quality === expectedTarget.quality;
    if (session.sizeBytes !== file.size || session.kind !== kind || !sameTarget) {
      throw new UploadError("Choose the same file, target, and quality to resume this upload", resumeId);
    }
  } else {
    const res = await fetch("/api/uploads", {
      method: "POST", headers: { "Content-Type": "application/json" }, signal,
      body: JSON.stringify({ kind, fileName: file.name, sizeBytes: file.size, contentType: file.type, ...target }),
    });
    if (!res.ok) throw new UploadError(await jsonError(res));
    session = await res.json() as InitializedUpload;
  }
  onSession?.(session.id);
  const expectedPartSize = (partNumber: number) => Math.min(session.partSizeBytes, session.sizeBytes - (partNumber - 1) * session.partSizeBytes);
  const loaded = new Map<number, number>();
  for (const part of session.uploadedParts) {
    if (part.sizeBytes === expectedPartSize(part.partNumber)) loaded.set(part.partNumber, part.sizeBytes);
  }
  const report = () => {
    const bytes = Math.min(file.size, [...loaded.values()].reduce((sum, value) => sum + value, 0));
    onProgress?.(Math.min(100, Math.round(bytes / file.size * 100)), bytes);
  };
  report();
  // Only skip parts whose recorded size matches this session. A mismatched part
  // is re-uploaded instead of being accepted and failing final verification.
  const uploadedNumbers = new Set(session.uploadedParts.filter((done) => done.sizeBytes === expectedPartSize(done.partNumber)).map((done) => done.partNumber));
  const pending = session.parts.filter((part) => !uploadedNumbers.has(part.partNumber));
  let cursor = 0;
  let failure: unknown = null;
  const worker = async () => {
    try {
      while (cursor < pending.length && !failure && !signal?.aborted) {
      const part = pending[cursor++];
      const start = (part.partNumber - 1) * session.partSizeBytes;
      const blob = file.slice(start, Math.min(start + session.partSizeBytes, file.size));
      let attempt = 0;
      while (attempt < 3) {
        try {
          await putPart(part, blob, signal, (bytes) => { loaded.set(part.partNumber, bytes); report(); });
          loaded.set(part.partNumber, blob.size); report();
          break;
        } catch (error) {
          if (signal?.aborted) throw error;
          attempt += 1;
          loaded.set(part.partNumber, 0); report();
          if (attempt >= 3) { failure = error; throw error; }
          if (/403|400/.test((error as Error).message)) {
            const refreshed = await fetch(`/api/uploads/${session.id}`, { signal });
            if (refreshed.ok) {
              const data = await refreshed.json() as InitializedUpload;
              const replacement = data.parts?.find((p) => p.partNumber === part.partNumber);
              if (replacement) Object.assign(part, replacement);
            }
          }
          await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
        }
      }
      }
    } catch (error) {
      if (!signal?.aborted) failure = error;
      throw error;
    }
  };
  try {
    const workers = Array.from({ length: Math.min(3, pending.length) }, () => worker());
    await Promise.allSettled(workers);
    if (failure) throw failure;
    if (signal?.aborted) throw new DOMException("Upload cancelled", "AbortError");
    const complete = await fetch(`/api/uploads/${session.id}/complete`, { method: "POST", signal });
    if (!complete.ok) throw new Error(await jsonError(complete));
    const result = await complete.json() as CompletedUpload;
    onProgress?.(100, file.size);
    return result;
  } catch (error) {
    if (signal?.aborted) {
      await fetch(`/api/uploads/${session.id}`, { method: "DELETE" }).catch(() => undefined);
      throw error;
    }
    throw new UploadError(error instanceof Error ? error.message : "Upload failed", session.id);
  }
}
