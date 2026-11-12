import js from "@eslint/js";
import globals from "globals";
import react from "eslint-plugin-react";
import tsParser from "@typescript-eslint/parser";
import tsPlugin from "@typescript-eslint/eslint-plugin";

export default [
  js.configs.recommended,

  {
    files: ["**/*.{js,jsx,ts,tsx}"],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: "latest",
        sourceType: "module",
        ecmaFeatures: { jsx: true },
        project: false, // без tsconfig.json
      },
      globals: {
        ...globals.browser,
        ...globals.node,
      },
    },
    plugins: {
      react,
      "@typescript-eslint": tsPlugin,
    },
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector:
            "Literal[value=/[Зз]аявк[а-я]*[ \u00a0]*№/], JSXText[value=/[Зз]аявк[а-я]*[ \u00a0]*№/], TemplateElement[value.raw=/[Зз]аявк[а-я]*[ \u00a0]*№/]",
          message:
            "Номер заявки пишется без символа №: используйте «Заявка 51713» (docs/ux-ui-guide.md, «Словарь действий»).",
        },
        {
          selector:
            "ObjectExpression:has(> Property[key.name='path'][value.value=/settings$/]) > Property[key.name='element']",
          message:
            "Настройки модулей размещаются только в /preferences#<раздел>. Для старого адреса оставьте redirect, а не отдельную страницу.",
        },
        {
          selector: "JSXAttribute[name.name='to'][value.value=/settings$/]",
          message:
            "Не добавляйте отдельное меню настроек модуля. Настройки находятся в глобальном разделе /preferences.",
        },
        {
          selector:
            "JSXAttribute[name.name='type'][value.value=/^(date|datetime-local)$/]",
          message:
            "Используйте app/DateField, app/DateRangeField или app/DateTimeField: нативный календарь не входит в дизайн-систему.",
        },
        {
          selector:
            "JSXAttribute[name.name='type'][value.expression.value=/^(date|datetime-local)$/]",
          message:
            "Используйте app/DateField, app/DateRangeField или app/DateTimeField: нативный календарь не входит в дизайн-систему.",
        },
      ],
      "react/react-in-jsx-scope": "off",
      "react/prop-types": "off",
      "no-unused-vars": "off",
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          vars: "all",
          args: "after-used",
          ignoreRestSiblings: true,
          varsIgnorePattern: "^_",
          argsIgnorePattern: "^_",
        },
      ],
    },
    settings: {
      react: {
        version: "detect",
      },
    },
  },

  // В ts/tsx неопределённые имена проверяет сам TypeScript; no-undef из
  // js.configs.recommended не понимает type-позиции (React.ComponentProps
  // без импорта React в shadcn-компонентах) и даёт ложные ошибки.
  {
    files: ["**/*.{ts,tsx}"],
    rules: {
      "no-undef": "off",
    },
  },
];
