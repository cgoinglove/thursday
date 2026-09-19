"use client";

import { Swatch } from "@/components/ui/swatch";
import {
  MARK_PAINT_IDS,
  MARK_PAINTS,
  MARK_PALETTE,
  type MarkPaint,
  paintSwatch,
} from "../mark.const";

/**
 * A mark's colours in one line under the face they paint: the theme dot, the
 * colours, then the paints. On a narrow bot page the dots shrink rather than wrap.
 */
export function MarkPalette({
  color,
  themePicked,
  onTheme,
  onPick,
  paint,
  onPaint,
}: {
  /** The picked colour; anything outside the palette matches no swatch. */
  color: string | undefined;
  themePicked: boolean;
  onTheme: () => void;
  onPick: (color: string) => void;
  paint?: MarkPaint;
  onPaint?: (paint: MarkPaint) => void;
}) {
  return (
    // As wide as the page, not as its dots: they shrink to it rather than push past it
    <div className="flex w-full items-center justify-center gap-1.5 px-2">
      <Swatch color={null} picked={themePicked} onPick={onTheme} />
      {MARK_PALETTE.map((each) => (
        <Swatch
          key={each}
          color={each}
          picked={color === each}
          onPick={() => onPick(each)}
        />
      ))}
      {onPaint &&
        MARK_PAINT_IDS.map((each) => (
          <Swatch
            key={each}
            color={null}
            background={paintSwatch(each)}
            label={MARK_PAINTS[each].label}
            picked={paint === each}
            onPick={() => onPaint(each)}
          />
        ))}
    </div>
  );
}
