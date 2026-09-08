"use client";

import { ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Text that stands folded and opens in place. The chevron appears only when the text is
 * actually clipped — measured rather than guessed from its length — and stays while it is
 * open, so the way back is where the way in was. Open, the text scrolls inside its own box
 * instead of growing the panel around it.
 */
export function FoldedText({
  text,
  subject,
  clamp = "line-clamp-3",
  tall = "max-h-40",
  className,
}: {
  text: string;
  /** What is being folded, for the control's label: "request", "message". */
  subject: string;
  /** Tailwind line clamp while folded; a literal, so the class is generated. */
  clamp?: string;
  /** The room it may take once open; past that it scrolls. */
  tall?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [clipped, setClipped] = useState(false);
  const box = useRef<HTMLParagraphElement>(null);

  // Holders are not remounted per subject, so new text starts folded again.
  useEffect(() => setOpen(false), [text]);

  useEffect(() => {
    const node = box.current;
    if (!node || open) return;
    setClipped(node.scrollHeight > node.clientHeight + 1);
  }, [open, text]);

  return (
    <div className={cn("flex items-start gap-1", className)}>
      <p
        ref={box}
        className={cn(
          "min-w-0 flex-1 text-[13px] leading-snug break-keep",
          open ? cn(tall, "overflow-y-auto scrollbar-none") : clamp,
        )}
      >
        {text}
      </p>

      {(clipped || open) && (
        <button
          type="button"
          onClick={() => setOpen((was) => !was)}
          aria-label={
            open ? `Fold the ${subject}` : `Read the whole ${subject}`
          }
          className="shrink-0 rounded-md p-0.5 opacity-60 outline-none transition-opacity hover:opacity-100 focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <ChevronDown className={cn("size-3.5", open && "rotate-180")} />
        </button>
      )}
    </div>
  );
}
