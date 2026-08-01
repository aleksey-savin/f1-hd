import { fileURLToPath, URL } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig(({ command }) => ({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  // console/debugger вырезаем только из прод-сборки (vite build); в dev (serve)
  // они нужны для отладки. Раньше тут стоял несуществующий
  // build.esbuildOptions.drop — Vite его молча игнорировал, и логи уезжали в прод.
  esbuild: {
    drop: command === "build" ? ["console", "debugger"] : [],
  },
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
    // Rollup options for better optimization
    rollupOptions: {
      output: {
        // Manual chunk splitting for better caching
        manualChunks: {
          // Vendor chunk for third-party libraries
          vendor: ["react", "react-dom", "react-router"],
          // UI libraries chunk
          ui: ["react-icons", "framer-motion"],
          // Date utilities
          dates: ["date-fns", "date-fns-tz"],
          // Form and input utilities
          forms: ["react-image-crop"],
          // Editor and rich text
          editor: ["dompurify"],
          // Utilities
          utils: ["zustand"],
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
    include: ["react", "react-dom", "react-router", "date-fns", "zustand"],
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
}));
