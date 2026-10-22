/** A soft chime and a macOS notification when Claude needs the user or a render is done, while they look elsewhere. */
const KEY = "motionmaxxing:alerts";

export function alertsOn(): boolean { try { return localStorage.getItem(KEY) !== "off"; } catch { return true; } }
export function setAlerts(on: boolean): void { try { localStorage.setItem(KEY, on ? "on" : "off"); } catch { /* private window */ } }

let ctx: AudioContext | null = null;
export function chime(): void {
  if (!alertsOn()) return;
  try {
    ctx ??= new AudioContext();
    const now = ctx.currentTime;
    for (const [f, at] of [[880, 0], [1318.5, 0.11]] as const) {
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = "sine"; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, now + at);
      g.gain.exponentialRampToValueAtTime(0.06, now + at + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, now + at + 0.45);
      o.connect(g).connect(ctx.destination);
      o.start(now + at); o.stop(now + at + 0.5);
    }
  } catch { /* no audio */ }
}

export async function askNotifications(): Promise<boolean> {
  if (!("Notification" in window)) return false;
  if (Notification.permission === "granted") return true;
  return (await Notification.requestPermission()) === "granted";
}

export function notify(title: string, body: string): void {
  if (!alertsOn()) return;
  chime();
  if (document.hidden && "Notification" in window && Notification.permission === "granted") {
    try { new Notification(title, { body, silent: true }); } catch { /* not allowed here */ }
  }
}
