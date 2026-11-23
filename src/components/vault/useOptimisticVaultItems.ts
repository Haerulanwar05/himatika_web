"use client";

import { useCallback, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { ActionResult } from "@/types/finance.types";

interface PatchEntry<T> {
  patch: Partial<T>;
  baseItem: T;
}

interface ReorderState {
  ids: string[];
  serverSig: string;
}

/**
 * Provides instant optimistic delete, field patch, and reorder over server-rendered
 * Vault lists while running Next.js router.refresh() in the background without flash-back.
 */
export function useOptimisticVaultItems<T extends { id: string }>(
  serverItems: T[]
) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [hiddenIds, setHiddenIds] = useState<string[]>([]);
  const [patches, setPatches] = useState<Record<string, PatchEntry<T>>>({});
  const [reorderState, setReorderState] = useState<ReorderState | null>(null);

  const patchesRef = useRef(patches);
  const reorderRef = useRef(reorderState);

  const serverSig = useMemo(
    () => serverItems.map((item) => item.id).join("|"),
    [serverItems]
  );

  const items = useMemo(() => {
    const hiddenSet = new Set(hiddenIds);
    const orderedServer =
      reorderState && reorderState.serverSig === serverSig
        ? (() => {
            const byId = new Map(serverItems.map((item) => [item.id, item]));
            const ordered = reorderState.ids
              .map((id) => byId.get(id))
              .filter((item): item is T => Boolean(item));
            for (const item of serverItems) {
              if (!reorderState.ids.includes(item.id)) ordered.push(item);
            }
            return ordered;
          })()
        : serverItems;

    return orderedServer
      .filter((item) => !hiddenSet.has(item.id))
      .map((item) => {
        const entry = patches[item.id];
        if (entry && entry.baseItem === item) {
          return { ...item, ...entry.patch };
        }
        return item;
      });
  }, [serverItems, serverSig, hiddenIds, patches, reorderState]);

  const refreshInBackground = useCallback(() => {
    startTransition(() => {
      router.refresh();
    });
  }, [router]);

  const deleteItemOptimistic = useCallback(
    async (id: string, action: () => Promise<ActionResult>): Promise<ActionResult> => {
      setHiddenIds((prev) => (prev.includes(id) ? prev : [...prev, id]));

      try {
        const res = await action();
        if (!res.success) {
          setHiddenIds((prev) => prev.filter((itemId) => itemId !== id));
        } else {
          refreshInBackground();
        }
        return res;
      } catch {
        setHiddenIds((prev) => prev.filter((itemId) => itemId !== id));
        return {
          success: false,
          message: "Terjadi gangguan koneksi saat menghapus data.",
        };
      }
    },
    [refreshInBackground]
  );

  const patchItemOptimistic = useCallback(
    async (
      id: string,
      patch: Partial<T>,
      action: () => Promise<ActionResult>
    ): Promise<ActionResult> => {
      const baseItem = serverItems.find((item) => item.id === id);
      if (!baseItem) {
        return action();
      }

      const prevPatchForId = patchesRef.current[id];
      const existingPatch =
        prevPatchForId?.baseItem === baseItem ? prevPatchForId.patch : {};
      const nextPatches = {
        ...patchesRef.current,
        [id]: { baseItem, patch: { ...existingPatch, ...patch } },
      };
      patchesRef.current = nextPatches;
      setPatches(nextPatches);

      const rollback = () => {
        const restored = { ...patchesRef.current };
        if (prevPatchForId) {
          restored[id] = prevPatchForId;
        } else {
          delete restored[id];
        }
        patchesRef.current = restored;
        setPatches(restored);
      };

      try {
        const res = await action();
        if (!res.success) {
          rollback();
        } else {
          refreshInBackground();
        }
        return res;
      } catch {
        rollback();
        return {
          success: false,
          message: "Terjadi gangguan koneksi saat memperbarui data.",
        };
      }
    },
    [serverItems, refreshInBackground]
  );

  const reorderItemOptimistic = useCallback(
    async (
      id: string,
      direction: "up" | "down",
      action: () => Promise<ActionResult>
    ): Promise<ActionResult> => {
      const currentIds = items.map((item) => item.id);
      const idx = currentIds.indexOf(id);
      const targetIdx = direction === "up" ? idx - 1 : idx + 1;
      if (idx === -1 || targetIdx < 0 || targetIdx >= currentIds.length) {
        return { success: true, message: "Urutan sudah di batas." };
      }

      const nextIds = [...currentIds];
      const [moved] = nextIds.splice(idx, 1);
      nextIds.splice(targetIdx, 0, moved);

      const prevReorder = reorderRef.current;
      const nextReorder = { ids: nextIds, serverSig };
      reorderRef.current = nextReorder;
      setReorderState(nextReorder);

      const rollback = () => {
        reorderRef.current = prevReorder;
        setReorderState(prevReorder);
      };

      try {
        const res = await action();
        if (!res.success) {
          rollback();
        } else {
          refreshInBackground();
        }
        return res;
      } catch {
        rollback();
        return {
          success: false,
          message: "Terjadi gangguan koneksi saat mengubah urutan.",
        };
      }
    },
    [items, serverSig, refreshInBackground]
  );

  return {
    items,
    hiddenIds,
    refreshInBackground,
    deleteItemOptimistic,
    patchItemOptimistic,
    reorderItemOptimistic,
  };
}
