const ALLOWED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
]);

const EXTENSION_MIME_MAP: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

const MAX_RAW_INPUT_BYTES = 25 * 1024 * 1024; // 25 MB before optimization
const SKIP_COMPRESSION_BYTES = 220 * 1024; // Already small enough
const SAFE_UNCOMPRESSED_BYTES = 4.5 * 1024 * 1024;
const MAX_DIMENSION_PX = 1920;
const IMAGE_QUALITY = 0.84;
const DECODE_TIMEOUT_MS = 15_000;

export interface CompressImageOptions {
  maxDimension?: number;
  quality?: number;
  preservePng?: boolean;
}

function resolveNormalizedMime(file: File): string {
  const rawType = file.type.toLowerCase().trim();
  if (rawType === "image/jpg") return "image/jpeg";
  if (rawType) return rawType;

  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  return EXTENSION_MIME_MAP[ext] ?? "";
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  mimeType: string,
  quality: number
): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob(resolve, mimeType, quality);
  });
}

function extForMime(mimeType: string): "png" | "webp" | "jpg" {
  if (mimeType === "image/png") return "png";
  if (mimeType === "image/webp") return "webp";
  return "jpg";
}

/**
 * Validate and compress browser image files via Canvas into lightweight WebP/JPEG/PNG
 * before upload so mobile camera photos shrink from multi-MB to a few hundred KB.
 */
export async function compressImageForUpload(
  file: File,
  options: CompressImageOptions = {}
): Promise<File> {
  const normalizedType = resolveNormalizedMime(file);
  const lowerName = file.name.toLowerCase();

  if (
    normalizedType === "image/heic" ||
    normalizedType === "image/heif" ||
    lowerName.endsWith(".heic") ||
    lowerName.endsWith(".heif")
  ) {
    throw new Error(
      `Format foto "${file.name}" (HEIC/HEIF) belum didukung browser web. Pilih atau ekspor sebagai JPG/PNG.`
    );
  }

  if (!ALLOWED_IMAGE_TYPES.has(normalizedType)) {
    throw new Error(
      `Format file "${file.name}" tidak didukung. Gunakan JPG, PNG, atau WebP.`
    );
  }

  if (file.size > MAX_RAW_INPUT_BYTES) {
    throw new Error(
      `Ukuran file "${file.name}" terlalu besar (maksimal 25 MB sebelum kompresi).`
    );
  }

  // Ensure empty/non-standard MIME on valid extension files is normalized
  const normalizedFile =
    file.type === normalizedType
      ? file
      : new File([file], file.name, {
          type: normalizedType,
          lastModified: file.lastModified,
        });

  if (typeof window === "undefined" || file.size <= SKIP_COMPRESSION_BYTES) {
    return normalizedFile;
  }

  const maxDimension = options.maxDimension ?? MAX_DIMENSION_PX;
  const quality = options.quality ?? IMAGE_QUALITY;
  const keepPng = Boolean(
    options.preservePng && normalizedType === "image/png"
  );
  const preferredType = keepPng ? "image/png" : "image/webp";

  const objectUrl = URL.createObjectURL(normalizedFile);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new window.Image();
      const timer = window.setTimeout(() => {
        reject(new Error(`Waktu memproses gambar "${file.name}" habis.`));
      }, DECODE_TIMEOUT_MS);

      el.onload = () => {
        window.clearTimeout(timer);
        resolve(el);
      };
      el.onerror = () => {
        window.clearTimeout(timer);
        reject(
          new Error(
            `Gagal membaca gambar "${file.name}". Pastikan berkas tidak rusak.`
          )
        );
      };
      el.src = objectUrl;
    });

    const longestSide = Math.max(img.naturalWidth, img.naturalHeight);
    if (longestSide === 0) {
      return normalizedFile;
    }

    const scale = longestSide > maxDimension ? maxDimension / longestSide : 1;
    const width = Math.max(1, Math.round(img.naturalWidth * scale));
    const height = Math.max(1, Math.round(img.naturalHeight * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return normalizedFile;
    }

    ctx.drawImage(img, 0, 0, width, height);

    let blob = await canvasToBlob(canvas, preferredType, quality);

    // Safari/iOS WebKit silently ignores "image/webp" and falls back to huge PNG blobs.
    // Re-encode to JPEG in that case so mobile uploads still shrink dramatically.
    if (
      preferredType === "image/webp" &&
      blob &&
      blob.type !== "image/webp"
    ) {
      const jpegBlob = await canvasToBlob(canvas, "image/jpeg", quality);
      if (jpegBlob && jpegBlob.size > 0) {
        blob = jpegBlob;
      }
    }

    if (!blob || blob.size === 0) {
      return normalizedFile;
    }

    if (blob.size >= file.size && file.size <= SAFE_UNCOMPRESSED_BYTES) {
      return normalizedFile;
    }

    const outputType = blob.type || preferredType;
    const baseName = file.name.replace(/\.[^.]+$/, "") || "image";
    const ext = extForMime(outputType);
    return new File([blob], `${baseName}.${ext}`, {
      type: outputType,
      lastModified: Date.now(),
    });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
