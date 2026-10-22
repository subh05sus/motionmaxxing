/** A short message at the bottom of the window, with one action (Undo). Any page can raise one. */
export interface Toast { id: number; text: string; action?: { label: string; run: () => void | Promise<void> } }

export function toast(text: string, action?: Toast["action"]): void {
  window.dispatchEvent(new CustomEvent<Toast>("mm:toast", { detail: { id: Date.now() + Math.random(), text, action } }));
}
