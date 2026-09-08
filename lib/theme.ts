export const THEMES = ["system", "light", "dark"] as const;

export type Theme = (typeof THEMES)[number];

export const THEME_STORAGE_KEY = "thursday.theme";

export const THEME_BOOT = `(function(){try{var t=localStorage.getItem(${JSON.stringify(
  THEME_STORAGE_KEY,
)});var d=t==="dark"||(t!=="light"&&matchMedia("(prefers-color-scheme: dark)").matches);var h=document.documentElement;h.classList.toggle("dark",d);h.style.colorScheme=d?"dark":"light"}catch(e){}})();`;
