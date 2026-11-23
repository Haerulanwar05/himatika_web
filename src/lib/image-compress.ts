const ALLOWED_IMAGE_TYPES = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
]);

const MAX_RAW_INPUT_BYTES = 25 * 1024 * 1024; // 25 MB before optimization
const SKIP_COMPRESSION_BYTES = 220 * 1024; // Already small enough
const MAX_DIMENSION_PX = 1920;
const WEBP_QUALITY = 0.84;

export interface CompressImageOptions {
  maxDimension?: number;
  quality?: number;
  preservePng?: boolean;
}

/**
 * Validate and compress browser image files via Canvas into lightweight WebP/PNG
 * before upload so mobile camera photos shrink from multi-MB to a few hundred KB.
 */
export async function compressImageForUpload(
  file: File,
  options: CompressImageOptions = {}
): Promise<File> {
  if (!ALLOWED_IMAGE_TYPES.has(file.type)) {
    throw new Error(
      `Format file "${file.name}" tidak didukung. Gunakan JPG, PNG, atau WebP.`
    );
  }

  if (file.size > MAX_RAW_INPUT_BYTES) {
    throw new Error(
      `Ukuran file "${file.name}" terlalu besar (maksimal 25 MB sebelum kompresi).`
    );
  }

  if (typeof window === "undefined" || file.size <= SKIP_COMPRESSION_BYTES) {
    return file;
  }

  const maxDimension = options.maxDimension ?? MAX_DIMENSION_PX;
  const quality = options.quality ?? WEBP_QUALITY;
  const keepPng = Boolean(options.preservePng && file.type === "image/png");
  const targetType = keepPng ? "image/png" : "image/webp";

  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new window.Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error(`Gagal membaca gambar "${file.name}".`));
      el.src = objectUrl;
    });

    const longestSide = Math.max(img.naturalWidth, img.naturalHeight);
    if (longestSide === 0) {
      return file;
    }

    const scale = longestSide > maxDimension ? maxDimension / longestSide : 1;
    const width = Math.max(1, Math.round(img.naturalWidth * scale));
    const height = Math.max(1, Math.round(img.naturalHeight * scale));

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return file;
    }

    ctx.drawImage(img, 0, 0, width, height);

    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, targetType, quality);
    });

    if (!blob || (blob.size >= file.size && scale === 1)) {
      return file;
    }

    const baseName = file.name.replace(/\.[^.]+$/, "") || "image";
    const ext = targetType === "image/png" ? "png" : "webp";
    return new File([blob], `${baseName}.${ext}`, {
      type: targetType,
      lastModified: Date.now(),
    });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
