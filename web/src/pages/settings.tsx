import { Bell, Check, Globe, KeyRound, Loader2, Moon, Sparkles, Wrench, X } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import { GlassSegmented } from "@/components/ui/glass-segmented";
import { Switch } from "@/components/ui/switch";
import { alertsOn, askNotifications, chime, setAlerts } from "@/lib/alerts";
import { api, useApi } from "@/lib/api";
import { Link } from "@/lib/router";
import type { PageProps } from "@/app";

function Group({ title, footer, children }: { title: string; footer?: ReactNode; children: ReactNode }) {
  return (
    <section>
      <h2 className="mb-1.5 px-1 caption uppercase tracking-wide">{title}</h2>
      <div className="panel divide-y overflow-hidden">{children}</div>
      {footer && <p className="mt-1.5 px-1 caption">{footer}</p>}
    </section>
  );
}

function Row({ icon, label, sub, children }: { icon: ReactNode; label: string; sub?: ReactNode; children?: ReactNode }) {
  return (
    <div className="flex min-h-11 items-center gap-3 px-3 py-2">
      <span className="grid size-6 shrink-0 place-items-center rounded-[6px] bg-foreground/8 text-muted-foreground">{icon}</span>
      <div className="min-w-0 flex-1"><p>{label}</p>{sub && <p className="caption">{sub}</p>}</div>
      {children}
    </div>
  );
}

const STOCK = { pexels: { name: "Pexels", url: "https://www.pexels.com/api/" }, pixabay: { name: "Pixabay", url: "https://pixabay.com/api/docs/" } } as const;

function KeyRow({ name, has, reload }: { name: keyof typeof STOCK; has: boolean; reload: () => void }) {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string>();
  const save = async () => {
    setBusy(true); setMsg(undefined);
    try { await api("/api/keys", { json: { name, key: key.trim() } }); setKey(""); setOpen(false); reload(); }
    catch (e) { setMsg((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <div className="px-3 py-2">
      <div className="flex min-h-7 items-center gap-3">
        <span className="grid size-6 shrink-0 place-items-center rounded-[6px] bg-foreground/8 text-muted-foreground"><KeyRound className="size-3.5" /></span>
        <div className="min-w-0 flex-1"><p>{STOCK[name].name}</p><p className="caption">{has ? "Connected: free stock video and photos" : "Free stock video and photos. Optional."}</p></div>
        {has ? <span className="flex items-center gap-1 caption text-success"><Check className="size-3.5" />Works</span> : null}
        <button onClick={() => setOpen(!open)} className="h-6 rounded-md px-2 text-primary hover:bg-primary/10">{has ? "Change" : "Add key"}</button>
      </div>
      {open && (
        <div className="mt-2 space-y-1.5 pl-9">
          <p className="caption">Make a free key at <a href={STOCK[name].url} target="_blank" rel="noreferrer" className="text-primary hover:underline">{STOCK[name].url.replace("https://", "")}</a> and paste it here. It is checked once, then saved only on this Mac.</p>
          <div className="flex gap-1.5">
            <input type="password" autoComplete="off" value={key} onChange={(e) => setKey(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && key.trim()) void save(); }} placeholder="Paste the key"
              className="h-7 flex-1 rounded-md bg-input px-2 font-mono text-[12px] outline-none focus:ring-2 focus:ring-primary/40" />
            <button disabled={!key.trim() || busy} onClick={save} className="h-7 rounded-md bg-primary px-3 font-medium text-primary-foreground active:scale-[0.97] disabled:opacity-40">{busy ? <Loader2 className="size-3.5 animate-spin" /> : "Check and save"}</button>
          </div>
          {msg && <p className="caption text-destructive">{msg}</p>}
        </div>
      )}
    </div>
  );
}

/** The recording browser: the sites Claude may drive for demos, and signing in to one (in that browser, never the user's own). */
function RecorderGroup() {
  const sites = useApi<Record<string, { allowed: string }>>("/api/recorder/sites");
  const [url, setUrl] = useState("");
  const [msg, setMsg] = useState<string>();
  const open = async () => {
    setMsg(undefined);
    try { await api("/api/recorder/login", { json: { url } }); setMsg("The recording browser is opening. Sign in there, then close its window."); setUrl(""); sites.reload(); }
    catch (e) { setMsg((e as Error).message); }
  };
  const list = Object.entries(sites.data ?? {});
  return (
    <Group title="Recording browser" footer="Claude records demos in its own Chrome window with its own sign-ins. Your Chrome, its cookies and accounts are never used.">
      {list.map(([h]) => (
        <div key={h} className="flex min-h-9 items-center gap-3 px-3">
          <span className="grid size-6 shrink-0 place-items-center rounded-[6px] bg-foreground/8 text-muted-foreground"><Globe className="size-3.5" /></span>
          <span className="flex-1">{h === "*" ? "Every website" : h}</span>
          <span className="caption">allowed</span>
          <button title="Ask again next time" onClick={async () => { await api(`/api/recorder/sites/${encodeURIComponent(h)}`, { method: "DELETE" }); sites.reload(); }} className="grid size-6 place-items-center rounded-md text-faint-foreground hover:bg-foreground/8 hover:text-foreground"><X className="size-3.5" /></button>
        </div>
      ))}
      <div className="space-y-1.5 px-3 py-2.5">
        <p>Sign in to a site</p>
        <div className="flex gap-1.5">
          <input value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && url.trim()) void open(); }} placeholder="claude.ai"
            className="h-7 flex-1 rounded-md bg-input px-2 outline-none focus:ring-2 focus:ring-primary/40" />
          <button disabled={!url.trim()} onClick={open} className="h-7 rounded-md bg-foreground/10 px-3 font-medium hover:bg-foreground/15 active:scale-[0.97] disabled:opacity-40">Open</button>
        </div>
        {msg && <p className="caption">{msg}</p>}
      </div>
    </Group>
  );
}

export function SettingsPage({ setTitle }: PageProps) {
  const keys = useApi<Record<string, boolean>>("/api/keys");
  const state = useApi<{ library: string; home: string; version: string }>("/api/state");
  const [theme, setTheme] = useState(() => (document.documentElement.classList.contains("dark") ? "dark" : "light"));
  const [alerts, setAlertsState] = useState(alertsOn());
  useEffect(() => { setTitle("Settings"); }, [setTitle]);
  return (
    <div className="h-full overflow-y-auto pb-24 md:pb-0">
      <div className="mx-auto max-w-[560px] space-y-6 px-6 py-8">
        <h1 className="title-1">Settings</h1>
        <Group title="Appearance">
          <Row icon={<Moon className="size-3.5" />} label="Theme">
            <GlassSegmented value={theme} onChange={(v) => {
              setTheme(v as string);
              document.documentElement.classList.toggle("dark", v === "dark");
              try { localStorage.setItem("motionmaxxing:theme", v as string); } catch { /* private window */ }
            }} options={[{ value: "dark", label: "Dark" }, { value: "light", label: "Light" }]} />
          </Row>
        </Group>
        <Group title="Alerts" footer="A soft chime when a cut is ready or Claude needs you, and a Mac notification while you are in another app.">
          <Row icon={<Bell className="size-3.5" />} label="Chime and notify">
            <Switch checked={alerts} onCheckedChange={async (on) => { setAlerts(on); setAlertsState(on); if (on) { await askNotifications(); chime(); } }} />
          </Row>
        </Group>
        <Group title="Stock footage" footer="Wikimedia Commons needs no key. Keys never go into the chat.">
          {(["pexels", "pixabay"] as const).map((n) => <KeyRow key={n} name={n} has={!!keys.data?.[n]} reload={keys.reload} />)}
        </Group>
        <RecorderGroup />
        <Group title="Claude">
          <Row icon={<Sparkles className="size-3.5" />} label="Your Claude login" sub="The studio runs Claude Code on this Mac with your own Claude plan. No API key, nothing billed separately." />
        </Group>
        <Group title="This Mac" footer={state.data ? <>Library: <span className="font-mono">{state.data.library.replace(/^\/Users\/[^/]+/, "~")}</span> · motionmaxxing {state.data.version}</> : null}>
          <Link href="/setup" className="block hover:bg-foreground/5"><Row icon={<Wrench className="size-3.5" />} label="Check the setup" sub="ffmpeg, whisper.cpp, the editing tools and the model"><span className="text-faint-foreground">›</span></Row></Link>
        </Group>
      </div>
    </div>
  );
}
