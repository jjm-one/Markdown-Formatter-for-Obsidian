// SPDX-License-Identifier: LGPL-3.0-only

// Type-aware linting for src/ and tests/ (the shared core and plugin surface also
// get the Obsidian rules; the CLI surface and tests get plain TypeScript rules;
// `tsconfig.json` + `tests/tsconfig.json` supply the types). Build/CI scripts get
// a light untyped pass that catches dead code.

import { defineConfig, globalIgnores } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";
import globals from "globals";
import tseslint from "typescript-eslint";

const typedLanguageOptions = {
  globals: {
    ...globals.browser,
    ...globals.nodeBuiltin,
  },
  parserOptions: {
    projectService: true,
    tsconfigRootDir: import.meta.dirname,
    onUnsupportedTypeScriptVersion: "error",
  },
};

export default defineConfig(
  globalIgnores([
    "coverage/**",
    "main-build/**",
    "main.js",
    "markdown-formatter-cli.cjs",
    "fuzz/core.cjs",
    "node_modules/**",
    "release/**",
  ]),
  // Shared core and Obsidian plugin runtime.
  {
    files: ["src/core/**/*.ts", "src/plugin/**/*.ts"],
    extends: obsidianmd.configs.recommended,
    languageOptions: typedLanguageOptions,
  },
  // Standalone CLI and the test suite.
  {
    files: ["src/cli/**/*.ts", "tests/**/*.ts"],
    extends: tseslint.configs.recommendedTypeChecked,
    languageOptions: typedLanguageOptions,
  },
  // Tests use `any` freely against the Obsidian mock.
  {
    files: ["tests/**/*.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-call": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-return": "off",
    },
  },
  // Build/CI scripts: plain Node ESM, no type information.
  {
    files: ["scripts/**/*.mjs"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "module",
      globals: { ...globals.node },
    },
    rules: {
      "no-unused-vars": "error",
      "no-undef": "error",
    },
  },
  // Fuzz targets: plain Node CommonJS.
  {
    files: ["fuzz/**/*.cjs"],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: "commonjs",
      globals: { ...globals.node },
    },
    rules: {
      "no-unused-vars": "error",
      "no-undef": "error",
    },
  },
);
