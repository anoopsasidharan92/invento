/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        brand: {
          50: "#f0f9ff",
          100: "#e0f2fe",
          500: "#0ea5e9",
          600: "#0284c7",
          700: "#0369a1",
          900: "#0c4a6e",
        },
        ui: {
          text: "#111111",
          bg: "#F7F7F7",
          card: "#FFFFFF",
          border: "#EAEAEA",
          accent: "#6B7280",
        }
      },
      fontFamily: {
        sans: ["Inter", "SF Pro", "Satoshi", "sans-serif"],
      }
    },
  },
  plugins: [],
};

