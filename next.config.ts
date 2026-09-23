import type { NextConfig } from "next";
import { FILE_THUMB } from "./config";

const nextConfig: NextConfig = {
  devIndicators: false,
  /**
   * File tiles draw pictures a bot made — a few megabytes each, at ~180 px. Optimizing
   * them is the difference between a screen of finished work pulling 83 MB and pulling
   * one. The only source is the workspace file route, at the one width a tile uses
   * (config FILE_THUMB); a picture opened to be looked at is still served whole.
   * `sharp` already ships with the package as a dependency of Next itself.
   */
  images: {
    localPatterns: [{ pathname: "/api/file/**" }],
    imageSizes: [48, 96, FILE_THUMB.imageWidth],
    minimumCacheTTL: FILE_THUMB.cacheSeconds,
    // The default is half of whatever the disk has free, which is no way for a local
    // app to behave. A tile is tens of kilobytes, so this holds thousands of them.
    maximumDiskCacheSize: 200_000_000,
  },
  // The npm package ships a running server, not a source tree: `standalone`
  // traces what the app actually imports into `.next/standalone`, so `npx`
  // installs ~90 MB instead of every dependency (scripts/pack.mts, bin/thursday).
  output: "standalone",
  // Files handed over from the write line travel as one server action: config.ts
  // GIVEN_FILES (8 files of 25 MB) plus room for the multipart framing
  experimental: { serverActions: { bodySizeLimit: "201mb" } },
  redirects: async () => [
    {
      source: "/artifacts/:path+",
      destination: "/artifact/artifacts/:path+",
      permanent: false,
    },
  ],
  // Tracing follows imports; these are read from disk by name at run time
  // (skills.discover walks the folder, migrate reads the SQL), so the trace
  // finds the folder but not what is in it.
  outputFileTracingIncludes: {
    "/*": ["skills/**/*", "database/migrations/**/*"],
  },
};

export default nextConfig;
