import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  plugins: [tailwindcss(), react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  server: {
    watch: {
      // Keep HMR focused on app files instead of workspace notes/logs.
      ignored: [
        "**/.codex/**",
        "**/apk/**",
        "**/docs/**",
        "**/spider-diagnostics/**",
        "**/app-data/**",
        "**/temp/**",
        "**/tmp/**",
        "**/*.md",
        "**/*.txt",
        "**/*.log",
      ],
    },
  },
});
