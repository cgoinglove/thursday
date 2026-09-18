import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  devIndicators: false,
  // The npm package ships a running server, not a source tree: `standalone`
  // traces what the app actually imports into `.next/standalone`, so `npx`
  // installs ~90 MB instead of every dependency (scripts/pack.mts, bin/thursday).
  output: "standalone",
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
    "/*": ["skills/**/*", "seed-skills/**/*", "database/migrations/**/*"],
  },
};

export default nextConfig;
