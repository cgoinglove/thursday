import type { MetadataRoute } from "next";
import { APP_NAME } from "@/config";

/**
 * What lets a browser install the app: its own window and its own place in the
 * Dock or the taskbar, instead of one tab among many that closes by accident and
 * takes the wake phrase, the shortcut and her calls with it. Still the same local
 * page; nothing about where it runs changes.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: APP_NAME,
    short_name: APP_NAME,
    description: "A voice assistant on your computer, with bots behind it.",
    start_url: "/",
    display: "standalone",
    background_color: "#0a0a0a",
    theme_color: "#0a0a0a",
    icons: [
      { src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" },
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "maskable",
      },
    ],
  };
}
