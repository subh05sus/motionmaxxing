import { api, currentProfile, useApi, useEvents } from "@/lib/api";

/** One creator's profile, as the studio shows it (the server's profiles.ts card). */
export interface ProfileCard { id: string; name: string; color?: string; picture: string | null; lang: string | null; handles: Record<string, string> }
export interface ProfileSettings {
  lang?: string; handles?: Record<string, string>; cta?: string; export_dir?: string;
  brand?: { colors?: string[]; font?: string; logo?: string; use_creator?: boolean };
  names?: (string | { name: string; domain?: string })[];
}

/** The library's profiles and the one this browser works as (null before one is picked, or without profiles). */
export function useProfiles() {
  const q = useApi<{ profiles: ProfileCard[]; current: string | null }>("/api/profiles");
  useEvents((t) => { if (t === "profiles") q.reload(); });
  const list = q.data?.profiles ?? [];
  const id = q.data ? q.data.current : currentProfile();
  return { ...q, list, current: list.find((p) => p.id === id) ?? null };
}

// Every tab of the studio works as one profile (the cookie is the browser's): a switch in one reloads the others.
const channel = typeof BroadcastChannel === "undefined" ? null : new BroadcastChannel("motionmaxxing:profile");
channel?.addEventListener("message", () => window.location.reload());

/** Work as this profile from now on: its videos, styles, scripts and chats. `to`: the page to open then. */
export async function switchProfile(id: string, to = "/"): Promise<void> {
  await api(`/api/profiles/${encodeURIComponent(id)}/select`, { method: "POST" });
  channel?.postMessage(id);
  window.location.assign(to);
}

/** The platforms a profile's handles are for, in the order the add sheet asks them. */
export const PLATFORMS = [
  { key: "instagram", label: "Instagram" },
  { key: "tiktok", label: "TikTok" },
  { key: "youtube", label: "YouTube" },
] as const;

/** "@Name " → "name": what a handle is, however it was typed or pasted (a profile link too). */
export const cleanHandle = (v: string): string =>
  v.trim().replace(/^https?:\/\/(www\.)?[^/]+\/(@)?/i, "").replace(/^@/, "").replace(/[/?#].*$/, "");
