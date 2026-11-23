"use client";

import {
  createSignedUploadTickets,
  type SignedUploadTicket,
} from "@/actions/storage.actions";
import {
  compressImageForUpload,
  type CompressImageOptions,
} from "@/lib/image-compress";
import { createClient } from "@/lib/supabase/client";

const FALLBACK_SERVER_PAYLOAD_LIMIT_BYTES = 3.6 * 1024 * 1024; // Leave headroom under Vercel 4.5 MB cap
const MAX_UPLOAD_BYTES_PER_FILE = 5 * 1024 * 1024;
const TICKET_BATCH_SIZE = 15;
const TICKET_REQUEST_TIMEOUT_MS = 20_000;
const DIRECT_UPLOAD_TIMEOUT_MS = 35_000;

export interface UploadedFileResult {
  url: string | null;
  path: string;
}

export interface ClientUploadOutcome {
  usedDirectUpload: boolean;
  uploaded: UploadedFileResult[];
  compressedFiles: File[];
}

function getSafeExtension(file: File): "jpg" | "jpeg" | "png" | "webp" | "pdf" {
  switch (file.type) {
    case "image/webp":
      return "webp";
    case "image/png":
      return "png";
    case "application/pdf":
      return "pdf";
    default:
      return "jpg";
  }
}

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  timeoutMessage: string
): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reject(new Error(timeoutMessage));
    }, ms);

    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        window.clearTimeout(timer);
        reject(err);
      }
    );
  });
}

/**
 * Compress images in browser and upload directly to Supabase Storage via signed upload URLs
 * in parallel, bypassing Vercel's 4.5 MB Serverless Function request limit.
 * Falls back to returning compact compressed files when <= 3.6 MB if direct upload fails.
 */
export async function uploadFilesFromClient(params: {
  files: File[];
  bucket: "public-assets" | "vault-receipts";
  folder: "prokers" | "hero" | "about" | "divisions" | "receipts";
  prefixBuilder: (file: File, index: number) => string;
  compressOptions?: CompressImageOptions;
  allowPdf?: boolean;
}): Promise<ClientUploadOutcome> {
  const {
    files,
    bucket,
    folder,
    prefixBuilder,
    compressOptions,
    allowPdf = false,
  } = params;

  if (files.length === 0) {
    return { usedDirectUpload: true, uploaded: [], compressedFiles: [] };
  }

  const compressedFiles = await Promise.all(
    files.map(async (file) => {
      if (allowPdf && file.type === "application/pdf") {
        if (file.size > MAX_UPLOAD_BYTES_PER_FILE) {
          throw new Error(`File PDF "${file.name}" melebihi batas 5 MB.`);
        }
        return file;
      }
      const processed = await compressImageForUpload(file, compressOptions);
      if (processed.size > MAX_UPLOAD_BYTES_PER_FILE) {
        throw new Error(
          `Foto "${file.name}" masih di atas 5 MB setelah kompresi. Coba pilih foto dengan resolusi lebih kecil.`
        );
      }
      return processed;
    })
  );

  const totalCompressedBytes = compressedFiles.reduce(
    (sum, file) => sum + file.size,
    0
  );

  let directErrorMessage: string | null = null;

  try {
    const tickets: SignedUploadTicket[] = [];
    let ticketError: string | null = null;

    for (let start = 0; start < compressedFiles.length; start += TICKET_BATCH_SIZE) {
      const batch = compressedFiles.slice(start, start + TICKET_BATCH_SIZE);
      const ticketRes = await withTimeout(
        createSignedUploadTickets({
          bucket,
          folder,
          files: batch.map((file, batchIdx) => ({
            prefix: prefixBuilder(file, start + batchIdx),
            ext: getSafeExtension(file),
          })),
        }),
        TICKET_REQUEST_TIMEOUT_MS,
        "Waktu meminta izin unggah habis. Periksa koneksi internet Anda."
      );

      if (!ticketRes.success || !ticketRes.tickets) {
        ticketError =
          ticketRes.message ?? "Gagal meminta token unggah ke penyimpanan.";
        break;
      }
      tickets.push(...ticketRes.tickets);
    }

    if (ticketError) {
      directErrorMessage = ticketError;
    } else {
      const supabase = createClient();

      const uploadResults = await Promise.all(
        compressedFiles.map(async (file, idx) => {
          const ticket = tickets[idx];
          const { error } = await withTimeout(
            supabase.storage
              .from(bucket)
              .uploadToSignedUrl(ticket.path, ticket.token, file, {
                contentType: file.type,
              }),
            DIRECT_UPLOAD_TIMEOUT_MS,
            `Waktu unggah "${file.name}" habis. Koneksi internet terlalu lambat atau terputus.`
          );
          return { ticket, error };
        })
      );

      const firstErr = uploadResults.find((item) => item.error);
      if (!firstErr) {
        return {
          usedDirectUpload: true,
          uploaded: tickets.map((t) => ({
            url: t.publicUrl,
            path: t.path,
          })),
          compressedFiles,
        };
      }

      const uploadedSoFar = uploadResults
        .filter((item) => !item.error)
        .map((item) => item.ticket.path);
      if (uploadedSoFar.length > 0) {
        await supabase.storage
          .from(bucket)
          .remove(uploadedSoFar)
          .catch(() => undefined);
      }

      directErrorMessage = firstErr.error?.message ?? "Gagal mengunggah berkas.";
    }
  } catch (err) {
    directErrorMessage =
      err instanceof Error ? err.message : "Gagal mengunggah langsung ke storage.";
  }

  // Fallback to Server Action multipart upload only when compact enough for Vercel 4.5 MB cap
  if (totalCompressedBytes <= FALLBACK_SERVER_PAYLOAD_LIMIT_BYTES) {
    return {
      usedDirectUpload: false,
      uploaded: [],
      compressedFiles,
    };
  }

  throw new Error(
    directErrorMessage
      ? `Gagal mengunggah berkas: ${directErrorMessage}`
      : "Total ukuran berkas melebihi batas pengiriman. Coba kurangi jumlah foto sekaligus."
  );
}
