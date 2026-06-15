import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ command }) => ({
  plugins: [react()],
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
      // Lexical: перечисляем все пакеты и подпути react-плагинов одним списком,
      // чтобы Vite оптимизировал их совместно и дедуплицировал. Иначе при
      // раздельном предбандлинге @lexical/link и @lexical/table вшиваются
      // копиями внутрь своих react-плагинов — отдельные createCommand() и
      // классы узлов, из-за чего INSERT_TABLE_COMMAND/TOGGLE_LINK_COMMAND из
      // тулбара не совпадают с теми, что слушают плагины (команды молча
      // игнорируются, без ошибок в консоли).
      "lexical",
      "@lexical/rich-text",
      "@lexical/list",
      "@lexical/link",
      "@lexical/table",
      "@lexical/html",
      "@lexical/selection",
      "@lexical/utils",
      "@lexical/react/LexicalComposer",
      "@lexical/react/LexicalComposerContext",
      "@lexical/react/LexicalRichTextPlugin",
      "@lexical/react/LexicalContentEditable",
      "@lexical/react/LexicalHistoryPlugin",
      "@lexical/react/LexicalListPlugin",
      "@lexical/react/LexicalLinkPlugin",
      "@lexical/react/LexicalTablePlugin",
      "@lexical/react/LexicalOnChangePlugin",
      "@lexical/react/LexicalErrorBoundary",
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
