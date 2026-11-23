"use client";

import { createSignedUploadTickets } from "@/actions/storage.actions";
import {
  compressImageForUpload,
  type CompressImageOptions,
} from "@/lib/image-compress";
import { createClient } from "@/lib/supabase/client";

const FALLBACK_SERVER_PAYLOAD_LIMIT_BYTES = 3.6 * 1024 * 1024; // Leave headroom under Vercel 4.5 MB cap
const MAX_UPLOAD_BYTES_PER_FILE = 5 * 1024 * 1024;

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
    const ticketRes = await createSignedUploadTickets({
      bucket,
      folder,
      files: compressedFiles.map((file, idx) => ({
        prefix: prefixBuilder(file, idx),
        ext: getSafeExtension(file),
      })),
    });

    if (!ticketRes.success || !ticketRes.tickets) {
      directErrorMessage =
        ticketRes.message ?? "Gagal meminta token unggah ke penyimpanan.";
    } else {
      const supabase = createClient();
      const tickets = ticketRes.tickets;

      const uploadResults = await Promise.all(
        compressedFiles.map(async (file, idx) => {
          const ticket = tickets[idx];
          const { error } = await supabase.storage
            .from(bucket)
            .uploadToSignedUrl(ticket.path, ticket.token, file, {
              contentType: file.type,
            });
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
        await supabase.storage.from(bucket).remove(uploadedSoFar);
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
