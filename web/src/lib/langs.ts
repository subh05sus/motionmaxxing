/** The languages the cut reads (plugin/lib/mm/lang.py PACKS). The picker names each in its own language, as Apple's do. */
export const LANG_OPTIONS = [
  { value: "auto", label: "Auto", ariaLabel: "Hear the language" },
  { value: "en", label: "English" },
  { value: "de", label: "Deutsch", ariaLabel: "German" },
  { value: "hi", label: "हिन्दी", ariaLabel: "Hindi" },
  { value: "hinglish", label: "Hinglish" },
] as const;
export type LangChoice = (typeof LANG_OPTIONS)[number]["value"];

const NAMES: Record<string, string> = { en: "English", de: "German", hi: "Hindi", hinglish: "Hinglish" };
export const langName = (code?: string): string => (code ? NAMES[code] ?? code : "–");
