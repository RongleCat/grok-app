import { readLocalMediaBlobViaIpc } from "./wallpaperSource";

const MAX_SOURCE_BYTES = 40 * 1024 * 1024;
const MAX_PNG_BYTES = 20 * 1024 * 1024;
const MAX_EDGE = 2048;

async function waitForImageStep<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  let abort!: () => void;
  const cancellation = new Promise<never>((_, reject) => {
    abort = () => reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) abort();
  });
  try {
    return await Promise.race([operation, cancellation]);
  } finally {
    signal.removeEventListener("abort", abort);
  }
}

/** Browser codecs cover AVIF without adding a native decoder or shell dependency. */
export async function prepareWallpaperVideoImage(
  path: string,
  signal: AbortSignal,
): Promise<string | null> {
  signal.throwIfAborted();
  // Host independently checks the signature and decodes these formats with limits.
  if (/\.(?:png|jpe?g)$/i.test(path)) return null;
  const { blob } = await readLocalMediaBlobViaIpc(path, undefined, {
    maxBytes: MAX_SOURCE_BYTES,
    signal,
  });
  return videoImageToPng(blob, signal);
}

export async function videoImageToPng(blob: Blob, signal: AbortSignal): Promise<string> {
  signal.throwIfAborted();
  if (!blob.size || blob.size > MAX_SOURCE_BYTES) throw new Error("imagine_source_invalid");
  const url = URL.createObjectURL(blob);
  const image = new Image();
  const canvas = document.createElement("canvas");
  try {
    await new Promise<void>((resolve, reject) => {
      const finish = (error?: unknown) => {
        clearTimeout(timer);
        signal.removeEventListener("abort", abort);
        image.onload = image.onerror = null;
        if (error) reject(error);
        else resolve();
      };
      const abort = () => finish(signal.reason ?? new DOMException("Aborted", "AbortError"));
      const timer = setTimeout(() => finish(new Error("imagine_source_invalid")), 15_000);
      image.onload = () => finish();
      image.onerror = () => finish(new Error("imagine_source_invalid"));
      signal.addEventListener("abort", abort, { once: true });
      image.src = url;
      if (signal.aborted) abort();
    });
    signal.throwIfAborted();
    const { naturalWidth: width, naturalHeight: height } = image;
    if (!width || !height || width > 16_384 || height > 16_384 || width * height > 50_000_000) {
      throw new Error("imagine_source_invalid");
    }
    const scale = Math.min(1, MAX_EDGE / Math.max(width, height));
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("imagine_source_invalid");
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    const png = await waitForImageStep(new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((result) => result ? resolve(result) : reject(new Error("imagine_source_invalid")), "image/png");
    }), signal);
    signal.throwIfAborted();
    if (!png.size || png.size > MAX_PNG_BYTES || png.type !== "image/png") {
      throw new Error("imagine_source_invalid");
    }
    const reader = new FileReader();
    try {
      const encoded = await waitForImageStep(new Promise<string>((resolve, reject) => {
        reader.onload = () => resolve(String(reader.result).split(",")[1] ?? "");
        reader.onerror = () => reject(new Error("imagine_source_invalid"));
        reader.onabort = () => reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
        reader.readAsDataURL(png);
      }), signal);
      signal.throwIfAborted();
      return encoded;
    } finally {
      reader.onload = reader.onerror = reader.onabort = null;
      if (reader.readyState === FileReader.LOADING) reader.abort();
    }
  } finally {
    image.src = "";
    canvas.width = canvas.height = 0;
    URL.revokeObjectURL(url);
  }
}
