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
        // OGP customer-facing brand palette (signup page only).
        navy: "#123B6D",
        skyblue: "#1B8DD1",
        cta: "#F07A22",
      },
    },
  },
  plugins: [],
};

export default config;
