import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["Inter", "Helvetica", "Arial", "sans-serif"],
        mono: ["'IBM Plex Mono'", "ui-monospace", "monospace"],
        serif: ["'Playfair Display'", "Georgia", "serif"],
        shanshui: ["'Noto Serif SC'", "serif"],
      },
    },
  },
  plugins: [],
} satisfies Config;
