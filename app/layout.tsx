import type { Metadata } from "next";
import { Geist, Geist_Mono, Noto_Sans_KR } from "next/font/google";
import Script from "next/script";
import "./globals.css";
import { AppEventSource } from "@/app/api/events/app-event.client";
import { ThemeSync } from "@/components/ui/theme-sync";
import { Toaster } from "@/components/ui/toast";
import { APP_NAME } from "@/config";
import { THEME_BOOT } from "@/lib/theme";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

/** Geist has no Hangul; Noto Sans KR follows it in the font stack. */
const notoKr = Noto_Sans_KR({
  variable: "--font-noto-kr",
  // `subsets` only controls preloading. Hangul still loads via unicode-range
  // @font-face blocks; "korean" is not an accepted subset name for this font.
  subsets: ["latin"],
  weight: ["400", "500", "600"],
});

export const metadata: Metadata = {
  title: APP_NAME,
  description: `The "${APP_NAME}" is a voice agent that can help you with your daily tasks.`,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${geistSans.variable} ${geistMono.variable} ${notoKr.variable} h-full antialiased`}
    >
      <body className="h-screen w-full flex flex-col">
        <Script id="theme-boot" strategy="beforeInteractive">
          {THEME_BOOT}
        </Script>
        <ThemeSync />
        <AppEventSource />
        {children}
        <Toaster />
      </body>
    </html>
  );
}
