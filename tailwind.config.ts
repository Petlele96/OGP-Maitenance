import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#eefdf3",
          100: "#d6fae1",
          400: "#3fc17a",
          500: "#22a35b",
          600: "#178249",
          700: "#146a3c",
          900: "#0e3f24",
        },
      },
    },
  },
  plugins: [],
};

export default config;
