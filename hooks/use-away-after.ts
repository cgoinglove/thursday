"use client";

import { useEffect, useState } from "react";

/** True once `on` has held for `ms`, and false again the moment it drops. */
export function useAwayAfter(on: boolean, ms: number) {
  const [away, setAway] = useState(false);
  useEffect(() => {
    if (!on) {
      setAway(false);
      return;
    }
    const out = setTimeout(() => setAway(true), ms);
    return () => clearTimeout(out);
  }, [on, ms]);
  return on && away;
}
