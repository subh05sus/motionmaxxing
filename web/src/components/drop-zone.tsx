import { Film, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { isVideo } from "@/lib/uploads";
import { cn } from "@/lib/utils";

/** Drop the raw takes here (one, or every part and the b-roll at once), or click to choose them. */
export function DropZone({ onFiles, compact, busy, progress }: { onFiles: (f: File[]) => void; compact?: boolean; busy?: boolean; progress?: number }) {
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const take = (list: FileList | null | undefined) => { const fs = [...(list ?? [])].filter(isVideo); if (fs.length) onFiles(fs); };
  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); take(e.dataTransfer.files); }}
      onClick={() => !busy && input.current?.click()}
      className={cn("relative grid place-items-center overflow-hidden rounded-[14px] border-2 border-dashed text-center transition-colors",
        compact ? "h-36" : "h-60", over ? "border-primary bg-primary/8" : "border-foreground/15 hover:border-foreground/25 hover:bg-foreground/[0.03]")}>
      <input ref={input} type="file" multiple accept="video/*,.mov,.mp4,.m4v" className="hidden" onChange={(e) => { take(e.target.files); e.target.value = ""; }} />
      {busy ? (
        <div className="w-56 space-y-2">
          <Film className="mx-auto size-6 text-primary" />
          <p className="font-medium">Adding your video…</p>
          <div className="h-1.5 overflow-hidden rounded-full bg-foreground/10"><div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${Math.round((progress ?? 0) * 100)}%` }} /></div>
        </div>
      ) : (
        <div className="space-y-1.5 px-4">
          <div className="mx-auto grid size-11 place-items-center rounded-full bg-primary/12 text-primary"><Upload className="size-5" /></div>
          <p className="title-2">Drop your raw takes</p>
          <p className="label-2">One take or every part, and your b-roll too: Claude tells them apart. Or click to choose.</p>
        </div>
      )}
    </div>
  );
}
