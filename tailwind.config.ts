import type { Config } from "tailwindcss";

export default {
  content: ["./popup.html", "./src/popup/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: "#17202A",
        muted: "#607085",
        panel: "#F7F9FC"
      }
    }
  },
  plugins: []
} satisfies Config;
