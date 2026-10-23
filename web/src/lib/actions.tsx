import { useCallback, useState, type ReactNode } from "react";
import { Confirm } from "@/components/confirm";
import { Rename } from "@/components/rename";
import { api } from "@/lib/api";
import { toast } from "@/lib/toast";

export type ItemKind = "videos" | "demos" | "scripts" | "broll";
const NOUN: Record<ItemKind, string> = { videos: "video", demos: "demo", scripts: "script", broll: "clip" };

/** Rename and delete for a video, a demo, a script or a b-roll clip: the sheet, the alert, and Undo on the toast.
 *  Render `dialogs`. */
export function useItemActions(kind: ItemKind, after?: () => void) {
  const [renaming, setRenaming] = useState<{ id: string; title: string } | null>(null);
  const [deleting, setDeleting] = useState<{ ids: string[]; title: string } | null>(null);
  const remove = async (ids: string[]) => {
    const keys: string[] = [];
    for (const id of ids) {
      try { keys.push((await api<{ key: string }>(`/api/${kind}/${encodeURIComponent(id)}/delete`, { method: "POST" })).key); }
      catch (e) { toast(`Could not delete: ${(e as Error).message}`); }
    }
    after?.();
    if (keys.length) {
      toast(keys.length === 1 ? `Deleted “${deleting?.title ?? NOUN[kind]}”` : `Deleted ${keys.length} ${NOUN[kind]}s`, {
        label: "Undo",
        run: async () => { for (const k of keys) await api(`/api/trash/${encodeURIComponent(k)}/restore`, { method: "POST" }); after?.(); },
      });
    }
  };
  const dialogs: ReactNode = (
    <>
      <Rename open={!!renaming} title={renaming?.title ?? ""} onClose={() => setRenaming(null)}
        onSave={async (t) => { if (renaming) { await api(`/api/${kind}/${encodeURIComponent(renaming.id)}/rename`, { json: { title: t } }); after?.(); } }} />
      <Confirm open={!!deleting} action="Delete"
        title={deleting && deleting.ids.length > 1 ? `Delete ${deleting.ids.length} ${NOUN[kind]}s?` : `Delete “${deleting?.title ?? ""}”?`}
        body={<>It moves to Recently deleted in the Library, where you can restore it.{kind === "broll" ? " Edits that already use it keep their copy." : " Its Claude conversation stops."}</>}
        onCancel={() => setDeleting(null)}
        onConfirm={() => { const d = deleting; setDeleting(null); if (d) void remove(d.ids); }} />
    </>
  );
  // stable, so pages can list them as effect dependencies
  const rename = useCallback((id: string, title: string) => setRenaming({ id, title }), []);
  const del = useCallback((ids: string[], title: string) => setDeleting({ ids, title }), []);
  return { rename, del, dialogs };
}
