import { code } from "@streamdown/code";
import { math } from "@streamdown/math";
import { mermaid } from "@streamdown/mermaid";
import { ComponentProps, memo } from "react";
import { Streamdown } from "streamdown";

const defaultProps: ComponentProps<typeof Streamdown> = {
  plugins: {
    code: code,
    mermaid: mermaid,
    math: math,
  },
};

function PureMarkdown(props: ComponentProps<typeof Streamdown>) {
  return <Streamdown {...defaultProps} {...props} />;
}

export const Markdown = memo(PureMarkdown);
