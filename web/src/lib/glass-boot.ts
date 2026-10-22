// From the apple-glass design kit.
/**
 * Server-safe half of the glass preference (see glass-preference.ts): the
 * storage key and the inline script the root layout puts in <head> to apply
 * the saved mode before first paint. No React here, so a Server Component
 * can import it.
 *
 * Any saved choice -- including "on" (Clear) -- becomes `data-glass` on
 * <html>. With nothing saved there is no attribute, which is what lets the
 * OS Reduce Transparency setting apply (globals.css) until one is picked.
 */
export const GLASS_STORAGE_KEY = "motionmaxxing:glass";

export const GLASS_BOOT_SCRIPT = `try{var m=localStorage.getItem("${GLASS_STORAGE_KEY}");if(m==="on"||m==="off"||m==="frosted")document.documentElement.dataset.glass=m}catch(e){}`;
