"use client";

import { cjk } from "@streamdown/cjk";
import { code } from "@streamdown/code";
import { math } from "@streamdown/math";
import { mermaid } from "@streamdown/mermaid";
import {
  Children,
  type ComponentProps,
  isValidElement,
  memo,
  type ReactElement,
} from "react";
import { Streamdown } from "streamdown";
import { useIsDark } from "@/hooks/use-theme";

const defaultProps: ComponentProps<typeof Streamdown> = {
  plugins: {
    code: code,
    mermaid: mermaid,
    math: math,
    // Bold that ends in punctuation before a Chinese, Japanese or Korean letter,
    // `**5.11%**다`, closes; CommonMark alone prints its asterisks
    cjk: cjk,
  },
};

// Mermaid paints its colours into the svg, so each theme is its own config. The
// default theme starts charts on a near-white series; these follow the dark theme's hues.
const MERMAID_THEME = {
  light: {
    config: {
      theme: "default",
      themeVariables: {
        xyChart: {
          plotColorPalette:
            "#2563eb,#16a34a,#dc2626,#ca8a04,#6b7280,#171717,#334155,#7c3aed",
        },
      },
    },
  },
  dark: { config: { theme: "dark" } },
} as const;

type HastChild = { type?: string; tagName?: string };

/**
 * Streamdown draws an image as a block with its own controls and lifts it out of a paragraph
 * it is alone in — but an image with words beside it stays inside the `<p>`, which no `<p>`
 * may hold. That paragraph is a `div`; everything else is Streamdown's own rule.
 */
function Paragraph({
  children,
  node,
  ...rest
}: ComponentProps<"p"> & { node?: { children?: HastChild[] } }) {
  const parts = Children.toArray(children);
  const only =
    parts.length === 1 && isValidElement(parts[0])
      ? (parts[0] as ReactElement<{ node?: HastChild }>)
      : null;
  const tag = only?.props.node?.tagName;
  if (tag === "img" || (tag === "code" && only && "data-block" in only.props))
    return <>{children}</>;
  const Tag = node?.children?.some((child) => child.tagName === "img")
    ? "div"
    : "p";
  return <Tag {...rest}>{children}</Tag>;
}

/**
 * An image a bot wrote into its report, which is whatever it made — often a few
 * megabytes. Streamdown asks for every one of them at once, so a long report pulls
 * its whole gallery before a word of it is on screen; these wait until they are.
 */
function Picture({
  node,
  ...rest
}: ComponentProps<"img"> & { node?: unknown }) {
  // biome-ignore lint/performance/noImgElement: a report's own image, at whatever size it was made
  return <img {...rest} alt={rest.alt ?? ""} loading="lazy" decoding="async" />;
}

function PureMarkdown(props: ComponentProps<typeof Streamdown>) {
  const theme = useIsDark() ? "dark" : "light";
  return (
    // Streamdown's memo ignores a changed `mermaid` prop, so a new theme remounts it
    <Streamdown
      key={theme}
      {...defaultProps}
      mermaid={MERMAID_THEME[theme]}
      {...props}
      components={{ p: Paragraph, img: Picture, ...props.components }}
    />
  );
}

export const Markdown = memo(PureMarkdown);
