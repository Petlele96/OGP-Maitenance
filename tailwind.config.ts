import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-inter)", "system-ui", "sans-serif"],
      },
      colors: {
        // Used by /ops and /owner (internal tools) - untouched by the signup page redesign.
        brand: {
          50: "#eefdf3",
          100: "#d6fae1",
          400: "#3fc17a",
          500: "#22a35b",
          600: "#178249",
          700: "#146a3c",
          900: "#0e3f24",
        },
        // OGP customer-facing brand palette (public pages: signup, terms, thank-you,
        // cancelled, pay - not /ops or /owner, which keep the brand-* palette above).
        navy: "#123B6D",
        skyblue: "#1B8DD1",
        cta: "#F07A22",
        // Footer background across those same public pages.
        cream: "#FAF6EE",
      },
    },
  },
  plugins: [],
};

export default config;
