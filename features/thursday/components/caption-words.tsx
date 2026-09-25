"use client";

import { type ReactNode, useMemo } from "react";
import { queryKey } from "@/app/api/query-key";
import { Letters, type LetterWrap } from "@/components/ui/letters";
import { fileOpens } from "@/features/bot/thread.store";
import { fileTarget } from "@/features/workspace/components/file-view";
import { workspaceRelative } from "@/features/workspace/file-kind";
import { openFileAction } from "@/features/workspace/workspace.action";
import { useServerAction } from "@/lib/protocol/use-server-action";
import { MARKDOWN_LINK } from "@/lib/utils";

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });
const count = (text: string) => Array.from(graphemes.segment(text)).length;

/**
 * Her words on the call screen, with the links `captionText` kept drawn as links: a file
 * she names opens over the call as the corner's cards open theirs, a page on the web in a
 * tab. Letter by letter when `animate`, the links arriving in turn with the rest.
 */
export function CaptionWords({
  text,
  animate,
}: {
  text: string;
  animate: boolean;
}) {
  const { shown, links } = useMemo(() => {
    const links: { from: number; to: number; href: string }[] = [];
    let shown = "";
    let at = 0;
    for (const match of text.matchAll(MARKDOWN_LINK)) {
      shown += text.slice(at, match.index);
      const from = count(shown);
      shown += match[1];
      links.push({ from, to: count(shown), href: match[2] });
      at = match.index + match[0].length;
    }
    return { shown: shown + text.slice(at), links };
  }, [text]);

  if (animate)
    return (
      <Letters
        text={shown}
        wraps={links.map(
          (link): LetterWrap => ({
            from: link.from,
            to: link.to,
            render: (letters) => (
              <CaptionLink href={link.href}>{letters}</CaptionLink>
            ),
          }),
        )}
      />
    );

  const letters = Array.from(graphemes.segment(shown), (part) => part.segment);
  const pieces: ReactNode[] = [];
  let at = 0;
  for (const link of links) {
    pieces.push(letters.slice(at, link.from).join(""));
    pieces.push(
      <CaptionLink key={link.from} href={link.href}>
        {letters.slice(link.from, link.to).join("")}
      </CaptionLink>,
    );
    at = link.to;
  }
  pieces.push(letters.slice(at).join(""));
  return <>{pieces}</>;
}

const LINK =
  "pointer-events-auto underline decoration-current/35 underline-offset-4 transition-colors hover:decoration-current";

/** One link in her words; an address that is neither the web nor this workspace stays words. */
function CaptionLink({
  href,
  children,
}: {
  href: string;
  children: ReactNode;
}) {
  const [openWithOs] = useServerAction(openFileAction);
  if (/^https?:\/\//i.test(href))
    return (
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        className={LINK}
        // a caption takes a click to bring it level; this one is the link's
        onClick={(event) => event.stopPropagation()}
      >
        {children}
      </a>
    );
  const path = workspaceRelative(href);
  if (!path) return children;
  return (
    <a
      href={queryKey.fileView(path)}
      className={LINK}
      onClick={(event) => {
        event.preventDefault();
        event.stopPropagation();
        const target = fileTarget(href);
        if (target.how === "os") void openWithOs(href);
        else if (!fileOpens.open(target.path))
          window.open(queryKey.fileView(target.path), "_blank");
      }}
    >
      {children}
    </a>
  );
}
