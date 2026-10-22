import { useEffect, useState, type AnchorHTMLAttributes } from "react";

/** A tiny router: paths in the address bar, history for Back, no reloads. */
export function navigate(to: string, replace = false): void {
  if (to === location.pathname + location.search) return;
  if (replace) history.replaceState({}, "", to); else history.pushState({}, "", to);
  window.dispatchEvent(new Event("mm:navigate"));
}

export function useRoute(): { path: string; parts: string[]; query: URLSearchParams } {
  const [, tick] = useState(0);
  useEffect(() => {
    const on = () => tick((n) => n + 1);
    window.addEventListener("popstate", on);
    window.addEventListener("mm:navigate", on);
    return () => { window.removeEventListener("popstate", on); window.removeEventListener("mm:navigate", on); };
  }, []);
  return { path: location.pathname, parts: location.pathname.split("/").filter(Boolean).map(decodeURIComponent), query: new URLSearchParams(location.search) };
}

export function Link({ href, onClick, ...props }: AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  return (
    <a
      href={href}
      onClick={(e) => {
        onClick?.(e);
        if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        navigate(href);
      }}
      {...props}
    />
  );
}
