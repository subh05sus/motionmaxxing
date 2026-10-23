import { AnimatePresence, motion } from "motion/react";
import { Loader2 } from "lucide-react";
import { useCallback, useState, type ReactNode } from "react";
import { Confirm } from "@/components/confirm";
import { Avatar } from "@/components/profiles";
import { Rename } from "@/components/rename";
import { api } from "@/lib/api";
import { SPRING_SNAPPY } from "@/lib/motion";
import { useProfiles } from "@/lib/profiles";
import { toast } from "@/lib/toast";

export type ItemKind = "videos" | "demos" | "scripts" | "broll";
const NOUN: Record<ItemKind, string> = { videos: "video", demos: "demo", scripts: "script", broll: "clip" };

/** Rename and delete for a video, a demo, a script or a b-roll clip: the sheet, the alert, and Undo on the toast; a
 *  video can move to another profile too. Render `dialogs`. */
export function useItemActions(kind: ItemKind, after?: () => void) {
  const [renaming, setRenaming] = useState<{ id: string; title: string } | null>(null);
  const [moving, setMoving] = useState<{ id: string; title: string } | null>(null);
  const [movingTo, setMovingTo] = useState<string>();
  const { list, current } = useProfiles();
  const elsewhere = list.filter((p) => p.id !== current?.id);
  const moveTo = async (pid: string, name: string) => {
    if (!moving) return;
    setMovingTo(pid);
    try {
      await api(`/api/videos/${encodeURIComponent(moving.id)}/move`, { json: { to: pid } });
      toast(`Moved “${moving.title}” to ${name}, with its raw takes and its chat`);
      setMoving(null); after?.();
    } catch (e) { toast((e as Error).message); } finally { setMovingTo(undefined); }
  };
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
      <AnimatePresence>
        {moving && (
          <motion.div className="fixed inset-0 z-50 grid place-items-center bg-black/35" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.12 } }}
            onMouseDown={() => !movingTo && setMoving(null)}>
            <motion.div initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.97, transition: { duration: 0.12 } }} transition={SPRING_SNAPPY}
              onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label="Move to another profile" className="surface-sheet w-[340px] rounded-[14px] p-4">
              <h2 className="headline">Move “{moving.title}” to</h2>
              <p className="mt-0.5 caption">Its raw takes and its Claude chat go with it.</p>
              <div className="mt-3 space-y-0.5">
                {elsewhere.map((p) => (
                  <button key={p.id} onClick={() => void moveTo(p.id, p.name)} disabled={!!movingTo}
                    className="flex h-10 w-full items-center gap-2.5 rounded-md px-2 text-left hover:bg-foreground/8 disabled:opacity-60">
                    <Avatar p={p} size={26} /><span className="flex-1 truncate">{p.name}</span>
                    {movingTo === p.id && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
                  </button>
                ))}
              </div>
              <div className="mt-3 flex justify-end"><button onClick={() => setMoving(null)} disabled={!!movingTo} className="h-7 rounded-md px-3 hover:bg-foreground/10">Cancel</button></div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
  // stable, so pages can list them as effect dependencies
  const rename = useCallback((id: string, title: string) => setRenaming({ id, title }), []);
  const del = useCallback((ids: string[], title: string) => setDeleting({ ids, title }), []);
  const move = useCallback((id: string, title: string) => setMoving({ id, title }), []);
  return { rename, del, move: kind === "videos" && elsewhere.length ? move : undefined, dialogs };
}
