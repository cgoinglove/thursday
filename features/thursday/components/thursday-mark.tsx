"use client";

import { BotMark } from "@/features/bot/components/bot-mark";
import { useThursdayFace } from "@/features/thursday/face.store";

/** The seed her mark is drawn from, wherever it is drawn (the tab's icon too). */
export const THURSDAY_SEED = "thursday";

/** Thursday's mark at any size. Always the mark, never the orb, whatever face is set. */
export function ThursdayMark({
  size = 16,
  className,
}: {
  size?: number;
  className?: string;
}) {
  const face = useThursdayFace();

  return (
    <BotMark
      size={size}
      seed={THURSDAY_SEED}
      color={face.color}
      shape={face.shape}
      outline={face.outline}
      notify={false}
      className={className}
    />
  );
}
