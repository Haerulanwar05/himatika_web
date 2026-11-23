"use client";

import React, { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  ArrowDown,
  ArrowUp,
  Edit3,
  ExternalLink,
  Images,
  Info,
  Loader2,
  Plus,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import {
  deleteAboutGalleryPhoto,
  reorderAboutGalleryPhoto,
  upsertAboutGalleryPhoto,
} from "@/actions/about.actions";
import { useLockBodyScroll } from "@/components/common/SmoothScroller";
import { uploadFilesFromClient } from "@/lib/supabase/client-upload";
import { useOptimisticVaultItems } from "./useOptimisticVaultItems";
import type { AboutGalleryPhotoJson } from "@/types/database.types";

interface AboutGalleryPanelProps {
  photos: AboutGalleryPhotoJson[];
  canEditProfile: boolean;
}

const MAX_PHOTOS = 6;

export function AboutGalleryPanel({
  photos,
  canEditProfile,
}: AboutGalleryPanelProps) {
  const {
    items: visiblePhotos,
    refreshInBackground,
    deleteItemOptimistic,
    reorderItemOptimistic,
  } = useOptimisticVaultItems(photos);
  const [editing, setEditing] = useState<Partial<AboutGalleryPhotoJson> | null>(
    null
  );
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewObjectUrl, setPreviewObjectUrl] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  useLockBodyScroll(Boolean(editing));

  useEffect(() => {
    return () => {
      if (previewObjectUrl) {
        URL.revokeObjectURL(previewObjectUrl);
      }
    };
  }, [previewObjectUrl]);

  const updateSelectedFile = (file: File | null) => {
    setSelectedFile(file);
    setPreviewObjectUrl(file ? URL.createObjectURL(file) : null);
  };

  const activePreviewUrl = previewObjectUrl ?? (editing?.imageUrl || null);

  const openNewModal = () => {
    updateSelectedFile(null);
    setModalError(null);
    setFeedback(null);
    setEditing({
      id: "",
      imageUrl: "",
      tag: "KEGIATAN HIMATIKA",
      caption: "",
    });
  };

  const openEditModal = (photo: AboutGalleryPhotoJson) => {
    updateSelectedFile(null);
    setModalError(null);
    setFeedback(null);
    setEditing(photo);
  };

  const closeModal = () => {
    updateSelectedFile(null);
    setModalError(null);
    setEditing(null);
  };

  const handleSave = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (!editing) return;

    const formData = new FormData(e.currentTarget);
    formData.set("photo_id", editing.id ?? "");
    formData.delete("image_file");

    setSubmitting(true);
    setModalError(null);
    setFeedback(null);

    try {
      if (selectedFile) {
        const tagStr = String(formData.get("tag") ?? "galeri");
        const uploadOutcome = await uploadFilesFromClient({
          files: [selectedFile],
          bucket: "public-assets",
          folder: "about",
          prefixBuilder: () => `gal-${tagStr}`,
        });

        if (uploadOutcome.usedDirectUpload && uploadOutcome.uploaded[0]?.url) {
          formData.set("uploaded_image_url", uploadOutcome.uploaded[0].url);
          formData.set("uploaded_asset_path", uploadOutcome.uploaded[0].path);
        } else if (uploadOutcome.compressedFiles[0]) {
          formData.set("image_file", uploadOutcome.compressedFiles[0]);
        }
      }

      const res = await upsertAboutGalleryPhoto(formData);
      if (res.success) {
        setFeedback({ type: "success", text: res.message });
        closeModal();
        refreshInBackground();
      } else {
        setModalError(res.message);
      }
    } catch (err) {
      setModalError(
        err instanceof Error
          ? err.message
          : "Gagal mengunggah atau menyimpan foto galeri."
      );
    } finally {
      setSubmitting(false);
    }
  };

  const handleReorder = async (photoId: string, direction: "up" | "down") => {
    setBusyId(photoId);
    setFeedback(null);
    const res = await reorderItemOptimistic(photoId, direction, () =>
      reorderAboutGalleryPhoto(photoId, direction)
    );
    setBusyId(null);
    setFeedback({
      type: res.success ? "success" : "error",
      text: res.message,
    });
  };

  const handleDelete = async (photo: AboutGalleryPhotoJson) => {
    if (
      !window.confirm(
        `Hapus foto "${photo.tag}" dari galeri halaman Tentang?`
      )
    ) {
      return;
    }

    setFeedback(null);
    const res = await deleteItemOptimistic(photo.id, () =>
      deleteAboutGalleryPhoto(photo.id)
    );
    setFeedback({
      type: res.success ? "success" : "error",
      text: res.message,
    });
  };

  return (
    <div className="space-y-5">
      {/* Section Header */}
      <div className="p-6 bg-surface border border-hairline flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="inline-flex items-center gap-2 font-mono text-xs text-blue-400 uppercase tracking-wider">
            <Images className="w-4 h-4" />
            <span>GALERI FOTO TENTANG (/ABOUT) • {visiblePhotos.length}/{MAX_PHOTOS} FOTO</span>
          </div>
          <h2 className="font-display text-2xl sm:text-3xl uppercase tracking-tight text-main">
            JEJAK KEGIATAN &amp; GALERI TENTANG
          </h2>
          <p className="font-sans text-xs sm:text-sm text-secondary max-w-2xl">
            Foto tampil penuh berwarna (full-color) dengan efek tirai terbuka dan muncul berurutan dari bawah ke atas saat halaman /about di-scroll.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-3 font-mono text-xs shrink-0">
          {!canEditProfile && (
            <Link
              href="/about"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-4 py-2.5 border border-hairline bg-canvas hover:border-blue-500/50 text-secondary hover:text-main transition-colors"
            >
              <span>LIHAT /ABOUT</span>
              <ExternalLink className="w-3.5 h-3.5" />
            </Link>
          )}

          <button
            type="button"
            disabled={visiblePhotos.length >= MAX_PHOTOS}
            onClick={openNewModal}
            className="inline-flex items-center gap-2 px-4 py-2.5 bg-blue-600 hover:bg-blue-500 text-white transition-colors cursor-pointer disabled:opacity-45 disabled:cursor-not-allowed"
          >
            <Plus className="w-4 h-4" />
            <span>TAMBAH FOTO</span>
          </button>
        </div>
      </div>

      {!canEditProfile && (
        <div className="p-3.5 border border-hairline bg-surface/60 flex items-start gap-2.5 font-mono text-[11px] text-secondary">
          <Info className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
          <span>
            Peran Medkraf dapat mengelola galeri foto di atas. Teks Profil, Logo, Periode, dan Visi Misi organisasi dikelola oleh Admin HIMATIKA.
          </span>
        </div>
      )}

      {visiblePhotos.length === 0 && (
        <div className="p-4 border border-blue-500/40 bg-blue-500/10 flex items-start gap-3 font-sans text-xs sm:text-sm text-blue-200">
          <Info className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
          <p>
            Belum ada foto galeri tersimpan. Seksi galeri di halaman /about disembunyikan otomatis sampai ada minimal 1 foto.
          </p>
        </div>
      )}

      {feedback && (
        <div
          className={`p-3.5 border flex items-center justify-between gap-3 font-mono text-xs ${
            feedback.type === "success"
              ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-300"
              : "border-red-500/40 bg-red-500/10 text-red-300"
          }`}
        >
          <span>{feedback.text}</span>
          <button
            type="button"
            onClick={() => setFeedback(null)}
            aria-label="Tutup notifikasi"
            className="p-1 hover:text-white cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Photo Grid */}
      {visiblePhotos.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {visiblePhotos.map((photo, index) => {
            const isBusy = busyId === photo.id;
            const badgeText =
              index === 0
                ? `#01 • UTAMA`
                : `#${String(index + 1).padStart(2, "0")}`;

            return (
              <div
                key={photo.id}
                className="border border-hairline bg-surface flex flex-col justify-between"
              >
                <div className="relative aspect-[16/10] w-full bg-black border-b border-hairline overflow-hidden">
                  <Image
                    src={photo.imageUrl}
                    alt={photo.caption}
                    fill
                    sizes="(max-width: 768px) 100vw, 50vw"
                    unoptimized
                    className="object-cover object-center"
                  />

                  <div className="absolute top-3 left-3 font-mono text-[10px] px-2 py-1 border border-white/20 bg-black/75 text-white tracking-wider">
                    {badgeText}
                  </div>
                </div>

                <div className="p-4 flex flex-col justify-between gap-4 flex-1">
                  <div className="space-y-1.5">
                    <span className="font-mono text-[11px] text-blue-400 uppercase tracking-wider block">
                      {photo.tag}
                    </span>
                    <p className="font-sans text-xs sm:text-sm text-secondary leading-relaxed line-clamp-2">
                      {photo.caption}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-hairline font-mono text-[11px]">
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        disabled={isBusy || index === 0}
                        onClick={() => handleReorder(photo.id, "up")}
                        aria-label={`Naikkan urutan ${photo.tag}`}
                        title="Naikkan urutan"
                        className="p-2 border border-hairline bg-canvas text-secondary hover:text-main hover:border-blue-500/50 disabled:opacity-35 disabled:cursor-not-allowed cursor-pointer transition-colors"
                      >
                        <ArrowUp className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        disabled={isBusy || index === visiblePhotos.length - 1}
                        onClick={() => handleReorder(photo.id, "down")}
                        aria-label={`Turunkan urutan ${photo.tag}`}
                        title="Turunkan urutan"
                        className="p-2 border border-hairline bg-canvas text-secondary hover:text-main hover:border-blue-500/50 disabled:opacity-35 disabled:cursor-not-allowed cursor-pointer transition-colors"
                      >
                        <ArrowDown className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => openEditModal(photo)}
                        className="inline-flex items-center gap-1.5 px-3 py-2 border border-hairline bg-canvas text-main hover:border-blue-500/60 hover:text-blue-400 transition-colors cursor-pointer disabled:opacity-50"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                        <span>EDIT</span>
                      </button>

                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => handleDelete(photo)}
                        aria-label={`Hapus ${photo.tag}`}
                        className="inline-flex items-center gap-1.5 px-3 py-2 border border-red-500/40 bg-red-500/10 text-red-400 hover:bg-red-600 hover:text-white transition-colors cursor-pointer disabled:opacity-50"
                      >
                        {isBusy ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="w-3.5 h-3.5" />
                        )}
                        <span>HAPUS</span>
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add / Edit Modal */}
      {editing && (
        <div
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => !submitting && closeModal()}
        >
          <div
            data-lenis-prevent
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-xl max-h-[90vh] overflow-y-auto overscroll-contain bg-surface border border-hairline p-6 space-y-5"
          >
            <div className="flex items-center justify-between gap-4 pb-4 border-b border-hairline">
              <div>
                <span className="font-mono text-[10px] text-blue-400 uppercase tracking-wider block">
                  {editing.id
                    ? "PERBARUI FOTO GALERI TENTANG"
                    : "TAMBAH FOTO GALERI BARU"}
                </span>
                <h3 className="font-display text-2xl uppercase tracking-tight text-main">
                  {editing.id ? editing.tag || "EDIT FOTO" : "UNGGAH FOTO TENTANG"}
                </h3>
              </div>

              <button
                type="button"
                disabled={submitting}
                onClick={closeModal}
                aria-label="Tutup modal"
                className="p-2 border border-hairline bg-canvas text-secondary hover:text-main cursor-pointer disabled:opacity-50"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSave} className="space-y-4">
              <div className="space-y-2.5 border border-hairline bg-canvas/50 p-3.5">
                <label className="font-mono text-[11px] text-secondary block uppercase">
                  FOTO DOKUMENTASI {editing.id ? "(OPSIONAL GANTI)" : "(WAJIB)"}
                </label>

                {activePreviewUrl ? (
                  <div className="relative aspect-[16/10] w-full border border-hairline bg-black overflow-hidden">
                    <Image
                      src={activePreviewUrl}
                      alt="Preview galeri tentang"
                      fill
                      sizes="(max-width: 640px) 100vw, 560px"
                      unoptimized
                      className="object-cover object-center"
                    />
                  </div>
                ) : (
                  <div className="aspect-[16/10] w-full border border-hairline bg-canvas flex items-center justify-center font-mono text-xs text-muted">
                    BELUM ADA FOTO DIPILIH
                  </div>
                )}

                <label className="flex items-center gap-3 p-3 border border-dashed border-hairline bg-canvas cursor-pointer hover:border-blue-500/60 transition-colors">
                  <Upload className="w-4 h-4 text-blue-400 shrink-0" />
                  <span className="font-mono text-[11px] text-secondary truncate">
                    {selectedFile
                      ? `${selectedFile.name} (${(selectedFile.size / (1024 * 1024)).toFixed(2)} MB)`
                      : activePreviewUrl
                        ? "GANTI FOTO (JPG / PNG / WEBP • MAKS 5 MB)"
                        : "UNGGAH FOTO (JPG / PNG / WEBP • MAKS 5 MB)"}
                  </span>
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="hidden"
                    onChange={(e) => {
                      updateSelectedFile(e.target.files?.[0] ?? null);
                      e.target.value = "";
                    }}
                  />
                </label>
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="about-gallery-tag"
                  className="font-mono text-[11px] text-secondary block uppercase"
                >
                  LABEL / TAG KEGIATAN
                </label>
                <input
                  id="about-gallery-tag"
                  name="tag"
                  required
                  minLength={2}
                  maxLength={50}
                  defaultValue={editing.tag ?? ""}
                  placeholder="Contoh: SOLIDARITAS & KEPEMIMPINAN"
                  className="w-full bg-canvas border border-hairline focus:border-blue-500 px-3 py-2.5 font-mono text-xs text-main outline-none"
                />
              </div>

              <div className="space-y-1.5">
                <label
                  htmlFor="about-gallery-caption"
                  className="font-mono text-[11px] text-secondary block uppercase"
                >
                  KETERANGAN SINGKAT FOTO
                </label>
                <textarea
                  id="about-gallery-caption"
                  name="caption"
                  required
                  rows={3}
                  minLength={5}
                  maxLength={220}
                  defaultValue={editing.caption ?? ""}
                  placeholder="Contoh: Pembinaan karakter mahasiswa baru dalam malam puncak T-Camp HIMATIKA."
                  className="w-full bg-canvas border border-hairline focus:border-blue-500 px-3 py-2.5 font-sans text-xs sm:text-sm text-main outline-none"
                />
              </div>

              {modalError && (
                <div className="p-3 border border-red-500/40 bg-red-500/10 font-mono text-xs text-red-300">
                  {modalError}
                </div>
              )}

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-hairline font-mono text-xs">
                <button
                  type="button"
                  onClick={closeModal}
                  disabled={submitting}
                  className="px-4 py-2.5 border border-hairline bg-canvas text-secondary hover:text-main cursor-pointer disabled:opacity-50"
                >
                  BATAL
                </button>
                <button
                  type="submit"
                  disabled={submitting}
                  className="inline-flex items-center gap-2 px-5 py-2.5 bg-blue-600 hover:bg-blue-500 text-white transition-colors cursor-pointer disabled:opacity-50"
                >
                  {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
                  <span>{submitting ? "MENYIMPAN..." : "SIMPAN FOTO"}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
