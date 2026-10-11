import js from "@eslint/js";
import globals from "globals";

// Плоский конфиг ESLint 9. Набор правил намеренно узкий — js/recommended:
// он ловит настоящие ошибки (необъявленные имена, недостижимый код, дубли
// ключей) и проходит на всей кодовой базе. *.ts не линтуются: их проверяет tsc.
const rules = {
  ...js.configs.recommended.rules,
  "no-unused-vars": ["error", { argsIgnorePattern: "^_", varsIgnorePattern: "^_", caughtErrors: "none" }],
};

export default [
  { ignores: ["node_modules/**", ".pnpm-store/**", "uploads/**", "storage/**", "logs/**", "**/*.ts"] },
  {
    files: ["**/*.{js,cjs}"],
    languageOptions: { ecmaVersion: 2024, sourceType: "commonjs", globals: globals.node },
    rules,
  },
  {
    files: ["**/*.mjs"],
    languageOptions: { ecmaVersion: 2024, sourceType: "module", globals: globals.node },
    rules,
  },
];
