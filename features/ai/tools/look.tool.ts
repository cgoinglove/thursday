import { readFile, stat } from "node:fs/promises";
import { type ToolSet, tool } from "ai";
import z from "zod";
import { LOOK } from "@/config";
import { TOOL_NAMES } from "@/features/ai/tools/tool-name";
import { mimeOf, viewKindOf } from "@/features/workspace/file-kind";
import { insideWorkspace } from "@/features/workspace/workspace";

/**
 * Seeing a picture: a screenshot a bot took, an image the user handed over, a chart a script
 * drew. Everything else a model reads arrives as text; this is the one tool whose answer is
 * the image itself. What is stored and drawn is the small record `execute` returns — the
 * path, never the bytes — and `toModelOutput` turns it into the picture for the run that
 * asked, so a row stays a line and a resumed thread reads that a picture was looked at
 * rather than carrying it again. Held only by a model whose provider carries an image
 * inside a tool result (ai/model seesToolImages): to the rest it would arrive as nothing.
 */

type Looked = { path: string; mediaType: string; bytes: number };

export function createLookTool(): ToolSet {
  return {
    [TOOL_NAMES.look_at]: tool({
      description:
        "See an image file yourself: a screenshot you took, a picture the user handed over, a chart you made. For what a picture shows — text files are read in the shell.",
      inputSchema: z.object({
        path: z
          .string()
          .describe("Workspace-relative path to a png, jpg, webp or gif."),
      }),
      execute: async ({ path }): Promise<Looked | string> => {
        const full = await insideWorkspace(path.trim());
        const info = full ? await stat(full).catch(() => null) : null;
        if (!full || !info?.isFile())
          return `There is no file at ${path}. Give the path from the workspace root, as \`ls\` shows it.`;
        if (viewKindOf(path) !== "image")
          return `${path} is not an image. Read it in the shell instead.`;
        if (info.size > LOOK.maxBytes)
          return `${path} is ${Math.ceil(info.size / 1024 / 1024)} MB, over the ${LOOK.maxBytes / 1024 / 1024} MB one look takes. Make a smaller copy in the shell first (on a Mac: sips -Z 1600 in.png --out out.png), then look at that.`;
        return { path: path.trim(), mediaType: mimeOf(path), bytes: info.size };
      },
      toModelOutput: async ({ output }) => {
        if (typeof output === "string") return { type: "text", value: output };
        const full = await insideWorkspace(output.path);
        const data = full ? await readFile(full).catch(() => null) : null;
        if (!data)
          return { type: "text", value: `${output.path} is no longer there.` };
        return {
          type: "content",
          value: [
            { type: "text", text: `${output.path}, as an image:` },
            {
              type: "file",
              mediaType: output.mediaType,
              data: { type: "data", data: data.toString("base64") },
            },
          ],
        };
      },
    }),
  };
}
