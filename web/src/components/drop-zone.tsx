import { Film, Upload } from "lucide-react";
import { useRef, useState } from "react";
import { cn } from "@/lib/utils";

/** Drop a raw take here, or click to choose one. */
export function DropZone({ onFile, compact, busy, progress }: { onFile: (f: File) => void; compact?: boolean; busy?: boolean; progress?: number }) {
  const [over, setOver] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files[0]; if (f) onFile(f); }}
      onClick={() => !busy && input.current?.click()}
      className={cn("relative grid place-items-center overflow-hidden rounded-[14px] border-2 border-dashed text-center transition-colors",
        compact ? "h-36" : "h-60", over ? "border-primary bg-primary/8" : "border-foreground/15 hover:border-foreground/25 hover:bg-foreground/[0.03]")}>
      <input ref={input} type="file" accept="video/*,.mov,.mp4,.m4v" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ""; }} />
      {busy ? (
        <div className="w-56 space-y-2">
          <Film className="mx-auto size-6 text-primary" />
          <p className="font-medium">Adding your video…</p>
          <div className="h-1.5 overflow-hidden rounded-full bg-foreground/10"><div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${Math.round((progress ?? 0) * 100)}%` }} /></div>
        </div>
      ) : (
        <div className="space-y-1.5">
          <div className="mx-auto grid size-11 place-items-center rounded-full bg-primary/12 text-primary"><Upload className="size-5" /></div>
          <p className="title-2">Drop your raw take</p>
          <p className="label-2">Every take, every filler. Last take wins. Or click to choose a file.</p>
        </div>
      )}
    </div>
  );
}
