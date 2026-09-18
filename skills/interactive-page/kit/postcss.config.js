import path from "node:path";

export default {
  plugins: {
    tailwindcss: { config: path.join(import.meta.dirname, "tailwind.config.js") },
    autoprefixer: {},
  },
};
