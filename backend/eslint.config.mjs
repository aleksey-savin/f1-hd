import { defineConfig } from "eslint/config";
import js from "@eslint/js";
import globals from "globals";
import nodePlugin from "eslint-plugin-node";
import importPlugin from "eslint-plugin-import";
import securityPlugin from "eslint-plugin-security";
import promisePlugin from "eslint-plugin-promise";

export default defineConfig([
  // Base JS configuration
  {
    files: ["**/*.{js,mjs,cjs}"],
    plugins: {
      js,
      node: nodePlugin,
      import: importPlugin,
      security: securityPlugin,
      promise: promisePlugin,
    },
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        ...globals.node,
        process: "readonly",
        require: "readonly",
        __dirname: "readonly",
        __filename: "readonly",
        exports: "readonly",
        module: "readonly",
        Buffer: "readonly",
      },
    },
    extends: [
      "js/recommended",
      "plugin:node/recommended",
      "plugin:import/errors",
      "plugin:import/warnings",
      "plugin:security/recommended",
      "plugin:promise/recommended",
    ],
    rules: {
      // Error prevention
      "no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "no-console": ["warn", { allow: ["warn", "error", "info"] }],
      "no-return-await": "error",
      "require-await": "error",
      "no-param-reassign": "error",
      "no-throw-literal": "error",
      "no-duplicate-imports": "error",

      // Node.js specific
      "node/no-deprecated-api": "error",
      "node/no-missing-require": "error",
      "node/no-unpublished-require": "off", // Turn off to allow dev dependencies
      "node/handle-callback-err": "error",
      "node/no-new-require": "error",
      "node/no-path-concat": "error",

      // Async patterns
      "promise/always-return": "error",
      "promise/no-return-wrap": "error",
      "promise/param-names": "error",
      "promise/catch-or-return": "error",
      "promise/no-nesting": "warn",
      "promise/no-promise-in-callback": "warn",
      "promise/no-callback-in-promise": "warn",

      // Import rules
      "import/first": "error",
      "import/no-mutable-exports": "error",
      "import/no-cycle": "error",
    },
  },

  // Browser globals for client-side files (if needed)
  {
    files: ["**/public/**/*.js", "**/client/**/*.js"],
    languageOptions: { globals: globals.browser },
  },

  // Test files (if you have them)
  {
    files: ["**/*.test.js", "**/__tests__/**/*.js"],
    rules: {
      "node/no-unpublished-require": "off",
      "security/detect-non-literal-fs-filename": "off",
    },
  },
]);
