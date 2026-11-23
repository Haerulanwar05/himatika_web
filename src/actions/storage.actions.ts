"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import {
  canManageFinance,
  canManageOrganization,
  canManageProker,
  getCurrentPengurus,
} from "@/lib/auth/session";
import type { AppRole } from "@/types/database.types";

export interface SignedUploadTicket {
  path: string;
  token: string;
  publicUrl: string | null;
}

const ticketRequestSchema = z.object({
  bucket: z.enum(["public-assets", "vault-receipts"]),
  folder: z.enum(["prokers", "hero", "about", "divisions", "receipts"]),
  files: z
    .array(
      z.object({
        prefix: z.string().trim().min(1).max(180),
        ext: z.enum(["jpg", "jpeg", "png", "webp", "pdf"]),
      })
    )
    .min(1, "Minimal 1 berkas harus dipilih.")
    .max(15, "Maksimal 15 berkas per batch unggah."),
});

function hasPermissionForTarget(
  role: AppRole,
  bucket: "public-assets" | "vault-receipts",
  folder: "prokers" | "hero" | "about" | "divisions" | "receipts"
): boolean {
  if (bucket === "vault-receipts") {
    return folder === "receipts" && canManageFinance(role);
  }
  if (folder === "divisions") {
    return canManageOrganization(role);
  }
  if (folder === "prokers" || folder === "hero" || folder === "about") {
    return canManageProker(role);
  }
  return false;
}

/**
 * Issue short-lived signed upload tickets so the browser uploads compressed assets
 * directly to Supabase Storage without hitting Vercel Serverless 4.5 MB limits.
 */
export async function createSignedUploadTickets(input: {
  bucket: "public-assets" | "vault-receipts";
  folder: "prokers" | "hero" | "about" | "divisions" | "receipts";
  files: { prefix: string; ext: string }[];
}): Promise<{
  success: boolean;
  message?: string;
  tickets?: SignedUploadTicket[];
}> {
  const pengurus = await getCurrentPengurus();
  if (!pengurus) {
    return {
      success: false,
      message: "Sesi login telah berakhir. Silakan login kembali.",
    };
  }

  const parsed = ticketRequestSchema.safeParse({
    bucket: input.bucket,
    folder: input.folder,
    files: input.files.map((item) => ({
      prefix: item.prefix,
      ext: item.ext.toLowerCase(),
    })),
  });

  if (!parsed.success) {
    return {
      success: false,
      message: "Permintaan izin unggah berkas tidak valid.",
    };
  }

  const { bucket, folder, files } = parsed.data;
  if (!hasPermissionForTarget(pengurus.profile.role, bucket, folder)) {
    return {
      success: false,
      message: "Anda tidak memiliki izin mengunggah berkas ke modul ini.",
    };
  }

  const supabase = await createClient();

  const tickets = await Promise.all(
    files.map(async (item): Promise<SignedUploadTicket | { error: string }> => {
      const safePrefix =
        item.prefix
          .toLowerCase()
          .replace(/[^a-z0-9_-]+/g, "-")
          .replace(/^-+|-+$/g, "")
          .slice(0, 40) || "asset";

      const uniqueSuffix = `${Date.now()}-${crypto.randomUUID().slice(0, 6)}`;
      const storagePath = `${folder}/${safePrefix}-${uniqueSuffix}.${item.ext}`;

      const { data, error } = await supabase.storage
        .from(bucket)
        .createSignedUploadUrl(storagePath);

      if (error || !data?.token) {
        return {
          error: error?.message ?? "Gagal membuat token unggah ke penyimpanan.",
        };
      }

      const publicUrl =
        bucket === "public-assets"
          ? supabase.storage.from("public-assets").getPublicUrl(storagePath)
              .data.publicUrl
          : null;

      return {
        path: storagePath,
        token: data.token,
        publicUrl,
      };
    })
  );

  const failed = tickets.find(
    (item): item is { error: string } => "error" in item
  );
  if (failed) {
    return {
      success: false,
      message: `Gagal menyiapkan unggahan: ${failed.error}`,
    };
  }

  return {
    success: true,
    tickets: tickets as SignedUploadTicket[],
  };
}
