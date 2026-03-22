import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { fileURLToPath } from 'url';

// Standard Node.js way to get the directory name in an ES module environment
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig({
  // We've removed the Replit-specific plugins for a cleaner setup
  plugins: [
    react(),
  ],
  resolve: {
    alias: {
      // Use the reliable __dirname to resolve paths
      "@": path.resolve(__dirname, "client", "src"),
      "@shared": path.resolve(__dirname, "shared"),
      "@assets": path.resolve(__dirname, "attached_assets"),
    },
  },
  root: path.resolve(__dirname, "client"),
  // CDN_ORIGIN: When set, Vite will prefix all asset URLs with the CDN domain.
  // This allows assets to be served from CloudFront/Cloudflare while the API stays on origin.
  // Example: CDN_ORIGIN=https://cdn.observatory-qa.com → <script src="https://cdn.observatory-qa.com/assets/index-abc123.js">
  base: process.env.CDN_ORIGIN ? `${process.env.CDN_ORIGIN}/` : "/",
  build: {
    outDir: path.resolve(__dirname, "dist/public"),
    emptyOutDir: true,
    // Generate source maps for Sentry error tracking (uploaded separately, not served to clients)
    sourcemap: "hidden",
    rollupOptions: {
      output: {
        manualChunks: {
          // Isolate Recharts into its own chunk — only loaded by pages that need charts
          recharts: ["recharts"],
        },
      },
    },
  },
  server: {
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
}); 
