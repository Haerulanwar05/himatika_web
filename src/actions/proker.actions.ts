"use server";

import { revalidatePath, updateTag } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { canManageProker, getCurrentPengurus } from "@/lib/auth/session";
import { normalizeWhatsappUrl } from "@/lib/utils";
import {
  filterTrustedStoragePaths,
  isTrustedPublicAssetUrl,
  removeUnusedPublicAssets,
  uploadPublicAsset,
} from "@/lib/supabase/storage";
import type { ActionResult } from "@/types/finance.types";
import type {
  ProkerContactJson,
  ProkerRundownJson,
  ProkerStatus,
} from "@/types/database.types";

const prokerSchema = z.object({
  id: z.string().uuid().optional().or(z.literal("")),
  highlight_number: z.string().trim().max(10).optional(),
  title: z.string().trim().min(3, "Judul program kerja minimal 3 karakter.").max(160),
  slug: z
    .string()
    .trim()
    .min(3, "Slug minimal 3 karakter.")
    .regex(/^[a-z0-9-]+$/, "Slug hanya boleh berisi huruf kecil, angka, dan tanda hubung (-)."),
  division_code: z.string().trim().min(2, "Pilih divisi penyelenggara."),
  status: z.enum(["upcoming", "ongoing", "completed"]),
  execution_label: z.string().trim().min(2, "Jadwal pelaksanaan wajib diisi.").max(80),
  location: z.string().trim().min(2, "Lokasi wajib diisi.").max(160),
  target_audience: z.string().trim().min(2, "Sasaran peserta wajib diisi.").max(160),
  short_desc: z.string().trim().min(10, "Ringkasan minimal 10 karakter.").max(400),
  full_content: z.string().trim().optional(),
  objectives_text: z.string().trim().optional(),
  registration_link: z
    .string()
    .trim()
    .url("Link pendaftaran harus berupa URL valid (https://...)")
    .optional()
    .or(z.literal("")),
  contact_name: z.string().trim().max(100).optional(),
  contact_role: z.string().trim().max(100).optional(),
  contact_phone: z.string().trim().max(160).optional(),
  existing_cover_url: z.string().trim().optional(),
  existing_gallery_json: z.string().trim().optional(),
  uploaded_cover_url: z.string().trim().optional(),
  uploaded_gallery_urls_json: z.string().trim().optional(),
  uploaded_asset_paths_json: z.string().trim().optional(),
  remove_cover: z.boolean().optional(),
  is_featured: z.boolean(),
  is_white_background: z.boolean(),
});

const DIVISION_NAME_MAP: Record<string, string> = {
  KOLABORASI: "KOLABORASI HIMPUNAN",
  PRESIDIUM: "PIMPINAN HIMPUNAN",
  BPH_SEK: "SEKRETARIS",
  BPH_BEN: "BENDAHARA",
  BPSDM: "BADAN PENGEMBANGAN SDM",
  HUMAS: "HUBUNGAN MASYARAKAT",
  RISET: "RISET DAN KEILMUAN",
  PMB: "PENGEMBANGAN MINAT & BAKAT",
  SARLOG: "SARANA DAN LOGISTIK",
  MEDKRAF: "MEDIA KREATIF",
};

/**
 * Create or update a work program in Supabase and invalidate public proker caches.
 */
export async function upsertWorkProgram(formData: FormData): Promise<ActionResult> {
  const pengurus = await getCurrentPengurus();
  if (!pengurus || !canManageProker(pengurus.profile.role)) {
    return {
      success: false,
      message: "Akses ditolak. Hanya Medkraf atau Admin yang dapat mengelola Program Kerja.",
    };
  }

  const parsed = prokerSchema.safeParse({
    id: formData.get("id") || "",
    highlight_number: formData.get("highlight_number") || "",
    title: formData.get("title"),
    slug: formData.get("slug"),
    division_code: formData.get("division_code"),
    status: formData.get("status"),
    execution_label: formData.get("execution_label"),
    location: formData.get("location"),
    target_audience: formData.get("target_audience"),
    short_desc: formData.get("short_desc"),
    full_content: formData.get("full_content") || "",
    objectives_text: formData.get("objectives_text") || "",
    registration_link: formData.get("registration_link") || "",
    contact_name: formData.get("contact_name") || "",
    contact_role: formData.get("contact_role") || "",
    contact_phone: formData.get("contact_phone") || "",
    existing_cover_url: formData.get("existing_cover_url") || "",
    existing_gallery_json: formData.get("existing_gallery_json") || "[]",
    uploaded_cover_url: formData.get("uploaded_cover_url") || "",
    uploaded_gallery_urls_json:
      formData.get("uploaded_gallery_urls_json") || "[]",
    uploaded_asset_paths_json:
      formData.get("uploaded_asset_paths_json") || "[]",
    remove_cover: formData.get("remove_cover") === "true",
    is_featured: formData.get("is_featured") === "true",
    is_white_background: formData.get("is_white_background") === "true",
  });

  if (!parsed.success) {
    return {
      success: false,
      message: parsed.error.issues[0]?.message ?? "Data program kerja tidak valid.",
    };
  }

  const supabase = await createClient();
  const isEdit = Boolean(parsed.data.id);

  let existingRow: {
    cover_image_url: string | null;
    gallery_images: string[] | null;
  } | null = null;
  if (isEdit && parsed.data.id) {
    const { data } = await supabase
      .from("work_programs")
      .select("cover_image_url, gallery_images")
      .eq("id", parsed.data.id)
      .maybeSingle();
    existingRow = data;
  }

  let preUploadedPaths: string[] = [];
  try {
    preUploadedPaths = filterTrustedStoragePaths(
      JSON.parse(parsed.data.uploaded_asset_paths_json || "[]"),
      "prokers"
    );
  } catch {
    preUploadedPaths = [];
  }

  const newlyUploadedPaths: string[] = [...preUploadedPaths];
  let coverUrl: string | null = parsed.data.remove_cover
    ? null
    : parsed.data.existing_cover_url || null;

  if (isTrustedPublicAssetUrl(parsed.data.uploaded_cover_url, "prokers")) {
    coverUrl = parsed.data.uploaded_cover_url;
  }

  const coverFile = formData.get("cover_file");
  if (coverFile instanceof File && coverFile.size > 0) {
    const uploadRes = await uploadPublicAsset(
      supabase,
      coverFile,
      "prokers",
      parsed.data.slug
    );
    if (uploadRes.error || !uploadRes.url) {
      if (newlyUploadedPaths.length > 0) {
        await supabase.storage.from("public-assets").remove(newlyUploadedPaths);
      }
      return { success: false, message: uploadRes.error ?? "Gagal mengunggah poster." };
    }
    if (uploadRes.path) newlyUploadedPaths.push(uploadRes.path);
    coverUrl = uploadRes.url;
  }

  // Preserve remaining gallery URLs and append direct-uploaded or multipart gallery files
  let preservedGallery: string[] = [];
  try {
    const rawGallery = JSON.parse(parsed.data.existing_gallery_json || "[]");
    if (Array.isArray(rawGallery)) {
      preservedGallery = rawGallery.filter(
        (item): item is string => typeof item === "string" && item.trim().length > 0
      );
    }
  } catch {
    preservedGallery = [];
  }

  let preUploadedGalleryUrls: string[] = [];
  try {
    const rawUploadedGallery = JSON.parse(
      parsed.data.uploaded_gallery_urls_json || "[]"
    );
    if (Array.isArray(rawUploadedGallery)) {
      preUploadedGalleryUrls = rawUploadedGallery.filter((item): item is string =>
        isTrustedPublicAssetUrl(item, "prokers")
      );
    }
  } catch {
    preUploadedGalleryUrls = [];
  }

  const rawGalleryFiles = formData
    .getAll("gallery_files")
    .filter((entry): entry is File => entry instanceof File && entry.size > 0);

  const fileUploadResults = await Promise.all(
    rawGalleryFiles.map((entry) =>
      uploadPublicAsset(supabase, entry, "prokers", `${parsed.data.slug}-gal`)
    )
  );

  for (const res of fileUploadResults) {
    if (res.path) newlyUploadedPaths.push(res.path);
  }

  const failedFileUpload = fileUploadResults.find((res) => res.error);
  if (failedFileUpload) {
    if (newlyUploadedPaths.length > 0) {
      await supabase.storage.from("public-assets").remove(newlyUploadedPaths);
    }
    return {
      success: false,
      message: failedFileUpload.error ?? "Gagal mengunggah foto galeri.",
    };
  }

  const uploadedGalleryUrls = [
    ...preUploadedGalleryUrls,
    ...fileUploadResults
      .map((res) => res.url)
      .filter((url): url is string => Boolean(url)),
  ];

  const combinedGallery = Array.from(
    new Set([...preservedGallery, ...uploadedGalleryUrls])
  );

  let divisionId: string | null = null;
  if (parsed.data.division_code !== "KOLABORASI") {
    const { data: divRow } = await supabase
      .from("divisions")
      .select("id")
      .eq("code", parsed.data.division_code)
      .maybeSingle();
    divisionId = divRow?.id ?? null;
  }

  const objectives = (parsed.data.objectives_text ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const contactName = parsed.data.contact_name?.trim() ?? "";
  const contactPhone = parsed.data.contact_phone?.trim() ?? "";
  const contactPerson: ProkerContactJson | null =
    contactName && contactPhone
      ? {
          name: contactName,
          role: parsed.data.contact_role?.trim() || "Narahubung Kegiatan",
          contact: normalizeWhatsappUrl(contactPhone),
        }
      : null;

  const payload = {
    highlight_number: parsed.data.highlight_number || null,
    title: parsed.data.title,
    slug: parsed.data.slug,
    division_id: divisionId,
    division_code: parsed.data.division_code,
    division_name:
      DIVISION_NAME_MAP[parsed.data.division_code] ?? parsed.data.division_code,
    status: parsed.data.status,
    execution_label: parsed.data.execution_label,
    location: parsed.data.location,
    target_audience: parsed.data.target_audience,
    short_desc: parsed.data.short_desc,
    full_content: parsed.data.full_content || parsed.data.short_desc,
    objectives,
    rundown: [] as ProkerRundownJson[],
    cover_image_url: coverUrl,
    gallery_images: combinedGallery,
    registration_link: parsed.data.registration_link || null,
    contact_person: contactPerson,
    is_featured: parsed.data.is_featured,
    is_white_background: parsed.data.is_white_background,
  };

  const { error } =
    isEdit && parsed.data.id
      ? await supabase.from("work_programs").update(payload).eq("id", parsed.data.id)
      : await supabase.from("work_programs").insert(payload);

  if (error) {
    if (newlyUploadedPaths.length > 0) {
      await supabase.storage.from("public-assets").remove(newlyUploadedPaths);
    }
    const isDuplicateSlug =
      error.code === "23505" || error.message.toLowerCase().includes("duplicate");
    return {
      success: false,
      message: isDuplicateSlug
        ? "Slug URL sudah digunakan program kerja lain. Ubah Slug URL agar unik."
        : `Gagal menyimpan program kerja: ${error.message}`,
    };
  }

  if (existingRow) {
    await removeUnusedPublicAssets(
      supabase,
      [existingRow.cover_image_url, ...(existingRow.gallery_images ?? [])],
      [coverUrl, ...combinedGallery]
    );
  }

  updateTag("prokers");
  updateTag("divisions");
  revalidatePath("/proker");
  revalidatePath(`/proker/${parsed.data.slug}`);
  revalidatePath("/struktur");
  revalidatePath("/");
  revalidatePath("/vault");

  return {
    success: true,
    message: parsed.data.id
      ? "Program kerja berhasil diperbarui."
      : "Program kerja baru berhasil ditambahkan.",
  };
}

/**
 * Quickly switch status of a work program (upcoming / ongoing / completed).
 */
export async function updateProkerStatus(
  id: string,
  status: ProkerStatus
): Promise<ActionResult> {
  const pengurus = await getCurrentPengurus();
  if (!pengurus || !canManageProker(pengurus.profile.role)) {
    return { success: false, message: "Akses ditolak." };
  }

  const idCheck = z.string().uuid().safeParse(id);
  const statusCheck = z.enum(["upcoming", "ongoing", "completed"]).safeParse(status);
  if (!idCheck.success || !statusCheck.success) {
    return { success: false, message: "Parameter status tidak valid." };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("work_programs")
    .update({ status: statusCheck.data })
    .eq("id", idCheck.data);

  if (error) {
    return { success: false, message: `Gagal memperbarui status: ${error.message}` };
  }

  updateTag("prokers");
  updateTag("divisions");
  revalidatePath("/proker");
  revalidatePath("/struktur");
  revalidatePath("/");
  revalidatePath("/vault");

  return { success: true, message: "Status program kerja diperbarui." };
}

/**
 * Delete a work program by ID.
 */
export async function deleteWorkProgram(id: string): Promise<ActionResult> {
  const pengurus = await getCurrentPengurus();
  if (!pengurus || !canManageProker(pengurus.profile.role)) {
    return { success: false, message: "Akses ditolak." };
  }

  const idCheck = z.string().uuid().safeParse(id);
  if (!idCheck.success) {
    return { success: false, message: "ID program kerja tidak valid." };
  }

  const supabase = await createClient();
  const { data: existingRow } = await supabase
    .from("work_programs")
    .select("cover_image_url, gallery_images")
    .eq("id", idCheck.data)
    .maybeSingle();

  const { error } = await supabase
    .from("work_programs")
    .delete()
    .eq("id", idCheck.data);

  if (error) {
    return { success: false, message: `Gagal menghapus program kerja: ${error.message}` };
  }

  if (existingRow) {
    await removeUnusedPublicAssets(
      supabase,
      [existingRow.cover_image_url, ...(existingRow.gallery_images ?? [])],
      []
    );
  }

  updateTag("prokers");
  updateTag("divisions");
  revalidatePath("/proker");
  revalidatePath("/struktur");
  revalidatePath("/");
  revalidatePath("/vault");

  return { success: true, message: "Program kerja berhasil dihapus." };
}
