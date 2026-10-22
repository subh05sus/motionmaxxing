import { AnimatePresence, motion } from "motion/react";
import { Command, Film, House, Library, Palette, PanelLeft, PanelRight, Plus, Search, Settings } from "lucide-react";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { ChatPanel } from "@/components/chat";
import { Palette as CommandPalette } from "@/components/palette";
import { api, useApi, useEvents } from "@/lib/api";
import { notify } from "@/lib/alerts";
import { Link, navigate, useRoute } from "@/lib/router";
import { SPRING_DEFAULT } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { EditorPage } from "@/pages/editor";
import { HomePage } from "@/pages/home";
import { LibraryPage } from "@/pages/library";
import { NewVideoPage } from "@/pages/new-video";
import { SettingsPage } from "@/pages/settings";
import { SetupPage } from "@/pages/setup";
import { StylesPage } from "@/pages/styles";
import { VideosPage } from "@/pages/videos";

const NAV = [
  { href: "/", label: "Home", icon: House },
  { href: "/new", label: "New video", icon: Plus },
  { href: "/videos", label: "Videos", icon: Film },
  { href: "/styles", label: "Styles", icon: Palette },
  { href: "/library", label: "Library", icon: Library },
];

function useStored(key: string, initial: boolean): [boolean, (v: boolean) => void] {
  const [v, setV] = useState(() => { try { const s = localStorage.getItem(key); return s == null ? initial : s === "1"; } catch { return initial; } });
  return [v, (n: boolean) => { setV(n); try { localStorage.setItem(key, n ? "1" : "0"); } catch { /* private window */ } }];
}

export interface PageProps { setTitle: (t: ReactNode, actions?: ReactNode) => void }

export function App() {
  const route = useRoute();
  const [rail, setRail] = useStored("motionmaxxing:rail", false);
  const [chat, setChat] = useStored("motionmaxxing:chat", true);
  const [palette, setPalette] = useState(false);
  const [title, setTitleState] = useState<{ t: ReactNode; actions?: ReactNode }>({ t: "" });
  const setTitle = useCallback((t: ReactNode, actions?: ReactNode) => setTitleState({ t, actions }), []);
  const setup = useApi<{ rows: { ok: boolean }[] }>("/api/setup");
  const [skipSetup, setSkipSetup] = useStored("motionmaxxing:setup-skipped", false);

  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "k") { e.preventDefault(); setPalette((p) => !p); }
      if (mod && e.key.toLowerCase() === "b") { e.preventDefault(); setRail(!rail); }
      if (mod && e.key === "/") { e.preventDefault(); setChat(!chat); }
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [rail, chat, setRail, setChat]);

  // A cut finished, Claude asked something: say so, even from another app.
  const seen = useState(() => new Map<string, string>())[0];
  useEvents((type, data) => {
    if (type !== "video" || !data?.id) return;
    api<{ title: string; status: string }>(`/api/videos/${encodeURIComponent(data.id)}`).then((v) => {
      const before = seen.get(data.id);
      seen.set(data.id, v.status);
      if (before && before !== v.status && v.status === "ready") notify("The cut is ready", v.title);
    }).catch(() => undefined);
  });

  const needsSetup = setup.data && setup.data.rows.some((r) => !r.ok) && !skipSetup;
  const [, page] = [route.parts[0] ?? "", route.parts];
  let body: ReactNode;
  if (route.parts[0] === "setup" || (needsSetup && route.parts[0] !== "settings")) body = <SetupPage setTitle={setTitle} onDone={() => { setup.reload(); setSkipSetup(true); navigate("/"); }} />;
  else if (route.parts[0] === "new") body = <NewVideoPage setTitle={setTitle} />;
  else if (route.parts[0] === "videos" && route.parts[1]) body = <EditorPage id={route.parts[1]} setTitle={setTitle} chatOpen={chat} />;
  else if (route.parts[0] === "videos") body = <VideosPage setTitle={setTitle} />;
  else if (route.parts[0] === "styles") body = <StylesPage setTitle={setTitle} />;
  else if (route.parts[0] === "library") body = <LibraryPage setTitle={setTitle} />;
  else if (route.parts[0] === "settings") body = <SettingsPage setTitle={setTitle} />;
  else body = <HomePage setTitle={setTitle} />;
  void page;
  const inEditor = route.parts[0] === "videos" && !!route.parts[1];

  return (
    <div className="flex h-full bg-background">
      {/* Sidebar: solid (content layer), folds to an icon rail with ⌘B. */}
      <motion.aside animate={{ width: rail ? 52 : 216 }} transition={SPRING_DEFAULT}
        className="hidden shrink-0 flex-col overflow-hidden border-r bg-sidebar md:flex">
        <div className="flex h-[52px] items-center gap-2 px-3.5">
          <img src="/icon.png" alt="" className="size-7 shrink-0 -mx-0.5" />
          {!rail && <span className="truncate headline">motionmaxxing</span>}
        </div>
        <nav className="flex flex-1 flex-col gap-0.5 px-2">
          {NAV.map(({ href, label, icon: Icon }) => {
            const on = href === "/" ? route.path === "/" : route.path.startsWith(href) && !(href === "/videos" && false);
            return (
              <Link key={href} href={href} title={rail ? label : undefined} aria-current={on ? "page" : undefined}
                className={cn("row row-hover text-foreground", rail && "justify-center px-0")}>
                <Icon className={cn("size-4 shrink-0", on ? "text-primary" : "text-muted-foreground")} />
                {!rail && <span className="truncate">{label}</span>}
              </Link>
            );
          })}
          <div className="flex-1" />
          <Link href="/settings" title={rail ? "Settings" : undefined} aria-current={route.path.startsWith("/settings") ? "page" : undefined}
            className={cn("row row-hover mb-2", rail && "justify-center px-0")}>
            <Settings className="size-4 shrink-0 text-muted-foreground" />{!rail && <span>Settings</span>}
          </Link>
        </nav>
      </motion.aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/* Toolbar: the page's title and actions, the palette, the panels. */}
        <header className="flex h-[52px] shrink-0 items-center gap-2 border-b bg-toolbar px-3">
          <button onClick={() => setRail(!rail)} title="Show or hide the sidebar (⌘B)" className="hidden size-7 place-items-center rounded-md text-muted-foreground hover:bg-foreground/8 md:grid"><PanelLeft className="size-4" /></button>
          <div className="min-w-0 flex-1 truncate headline">{title.t}</div>
          {title.actions}
          <button onClick={() => setPalette(true)} className="hidden h-7 w-56 items-center gap-2 rounded-md bg-input px-2 text-faint-foreground hover:text-muted-foreground lg:flex">
            <Search className="size-3.5" /><span className="flex-1 text-left">Search or do anything</span><span className="kbd flex items-center gap-0.5"><Command className="size-3" />K</span>
          </button>
          <button onClick={() => setChat(!chat)} title="Claude (⌘/)" className={cn("hidden size-7 place-items-center rounded-md hover:bg-foreground/8 lg:grid", chat ? "text-primary" : "text-muted-foreground")}><PanelRight className="size-4" /></button>
        </header>
        <div className="flex min-h-0 flex-1">
          <main className="min-w-0 flex-1 overflow-hidden">{body}</main>
          <AnimatePresence initial={false}>
            {chat && !inEditor && (
              <motion.aside key="chat" initial={{ width: 0, opacity: 0 }} animate={{ width: 340, opacity: 1 }} exit={{ width: 0, opacity: 0, transition: { duration: 0.16 } }} transition={SPRING_DEFAULT}
                className="hidden shrink-0 overflow-hidden border-l bg-sidebar lg:block">
                <div className="h-full w-[340px]"><ChatPanel sid="studio" title="Studio" hint={<span>Ask Claude anything about your videos, styles or the studio.</span>} /></div>
              </motion.aside>
            )}
          </AnimatePresence>
        </div>
      </div>
      <CommandPalette open={palette} onClose={() => setPalette(false)} />
      {/* Phone: a floating tab bar of glass, iOS style. */}
      <nav className="liquid-glass fixed inset-x-4 bottom-[max(env(safe-area-inset-bottom),12px)] z-40 flex h-[62px] items-center justify-around rounded-full md:hidden">
        {NAV.slice(0, 3).concat({ href: "/settings", label: "Settings", icon: Settings }).map(({ href, label, icon: Icon }) => {
          const on = href === "/" ? route.path === "/" : route.path.startsWith(href);
          return <Link key={href} href={href} className={cn("flex flex-col items-center gap-0.5 text-[10px]", on ? "text-primary" : "text-muted-foreground")}><Icon className="size-5" />{label}</Link>;
        })}
      </nav>
    </div>
  );
}
