import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    watch: {
      usePolling: true,
    },
    port: 3000,
  },
  build: {
    // Enable source maps for debugging in production
    sourcemap: false,
    // Optimize chunk size
    chunkSizeWarningLimit: 1000,
    // Enable minification with esbuild
    minify: "esbuild",
    esbuildOptions: {
      drop: ["console", "debugger"],
    },
    // Rollup options for better optimization
    rollupOptions: {
      output: {
        // Manual chunk splitting for better caching
        manualChunks: {
          // Vendor chunk for third-party libraries
          vendor: ["react", "react-dom", "react-router"],
          // UI libraries chunk
          ui: ["react-bootstrap", "bootstrap", "react-icons", "framer-motion"],
          // Calendar and date utilities
          calendar: [
            "@fullcalendar/core",
            "@fullcalendar/daygrid",
            "@fullcalendar/list",
            "@fullcalendar/react",
            "date-fns",
            "date-fns-tz",
            "react-datepicker",
          ],
          // Form and input utilities
          forms: ["react-select", "react-image-crop"],
          // Editor and rich text
          editor: ["dompurify"],
          // Utilities
          utils: ["pad", "prop-types", "zustand"],
        },
        // Optimize asset filenames for better caching
        assetFileNames: (assetInfo) => {
          if (/\.(png|jpe?g|svg|gif|tiff|bmp|ico)$/i.test(assetInfo.names[0])) {
            return `assets/[name]-[hash][extname]`;
          }
          if (/\.(woff2?|eot|ttf|otf)$/i.test(assetInfo.names[0])) {
            return `assets/[name]-[hash][extname]`;
          }
          return `assets/[name]-[hash][extname]`;
        },
        chunkFileNames: "assets/[name]-[hash].js",
        entryFileNames: "assets/[name]-[hash].js",
      },
    },
    // Target modern browsers for better optimization
    target: "esnext",
    // Enable CSS code splitting
    cssCodeSplit: true,
  },
  // Optimize dependencies
  optimizeDeps: {
    include: [
      "react",
      "react-dom",
      "react-router",
      "react-bootstrap",
      "bootstrap",
      "date-fns",
      "zustand",
      "pad",
    ],
  },
  // Configure CSS preprocessing
  css: {
    preprocessorOptions: {
      scss: {
        // Add any SCSS global variables here if needed
      },
    },
    // Enable CSS modules if needed
    modules: {
      localsConvention: "camelCaseOnly",
    },
  },
  // Configure asset handling
  assetsInclude: ["**/*.woff", "**/*.woff2", "**/*.ttf", "**/*.eot"],
  // Environment variables
  define: {
    // Remove console.log in production
    __DEV__: JSON.stringify(process.env.NODE_ENV === "development"),
  },
  // Configure preview server
  preview: {
    port: 3000,
    host: true,
  },
  // Enable experimental features for better performance
  experimental: {
    renderBuiltUrl(filename, { hostType }) {
      if (hostType === "js") {
        return { js: `/${filename}` };
      }
      return { relative: true };
    },
  },
});
