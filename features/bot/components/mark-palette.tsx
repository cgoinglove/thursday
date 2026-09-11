"use client";

import { Swatch } from "@/components/ui/swatch";
import { MARK_PALETTE_ROWS } from "../mark.const";

/**
 * A mark's colours, centred under the face they paint: the theme dot on its own,
 * then the light row over the dark row. The dark row starts under the first
 * light colour, so the dot is the only thing that stands apart. Thursday's face
 * and a bot's page both pick from it; they differ only in what the dot means.
 */
export function MarkPalette({
  color,
  themePicked,
  onTheme,
  onPick,
}: {
  /** The picked colour; anything outside the palette matches no swatch. */
  color: string | undefined;
  themePicked: boolean;
  onTheme: () => void;
  onPick: (color: string) => void;
}) {
  return (
    // both rows centre as one block and left-align inside it
    <div className="flex justify-center px-2">
      <div className="flex flex-col gap-2.5">
        <div className="flex flex-wrap items-center gap-2">
          <Swatch color={null} picked={themePicked} onPick={onTheme} />
          <span className="w-2" />
          {MARK_PALETTE_ROWS[0].map((each) => (
            <Swatch
              key={each}
              color={each}
              picked={color === each}
              onPick={() => onPick(each)}
            />
          ))}
        </div>
        {/* the dot, its gap, the spacer and the next gap: 44px */}
        <div className="flex flex-wrap items-center gap-2 pl-11">
          {MARK_PALETTE_ROWS[1].map((each) => (
            <Swatch
              key={each}
              color={each}
              picked={color === each}
              onPick={() => onPick(each)}
            />
          ))}
        </div>
      </div>
    </div>
  );
}
