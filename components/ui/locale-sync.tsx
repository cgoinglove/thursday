"use client";

import { useEffect } from "react";
import { useLocale } from "@/hooks/use-locale";

/** Renders nothing; keeps `<html lang>` on the stored locale after hydration. */
export function LocaleSync() {
  const locale = useLocale();
  useEffect(() => {
    document.documentElement.setAttribute("lang", locale);
  }, [locale]);
  return null;
}
