import eslint from "@eslint/js";
import eslintConfigPrettier from "eslint-config-prettier";
import simpleImportSort from "eslint-plugin-simple-import-sort";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  // Ignore patterns (must be first)
  {
    ignores: [
      "dist/**",
      "node_modules/**",
      "scripts/**",
      "test/**",
      "src/asana/api-client/generated/**",
      "src/test-runner/**",
      "src/main.ts",
      "coverage/**",
      "*.config.js",
    ],
  },

  // Base ESLint recommended rules
  eslint.configs.recommended,

  // TypeScript recommended rules
  ...tseslint.configs.recommended,

  // Prettier compatibility (disables conflicting rules)
  eslintConfigPrettier,

  // CommonJS files configuration (jest.config.js, etc.)
  {
    files: ["**/*.js"],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },

  // TypeScript files configuration
  {
    files: ["**/*.ts"],
    languageOptions: {
      parserOptions: {
        project: true,
      },
    },
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      // Allow underscore-prefixed variables to indicate intentionally unused
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],
    },
  },

  // Test files: relax no-explicit-any for mock objects
  {
    files: ["**/*.test.ts", "**/*.spec.ts"],
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
    },
  },

  // Import sorting configuration (applies to all files)
  {
    plugins: {
      "simple-import-sort": simpleImportSort,
    },
    rules: {
      "simple-import-sort/imports": [
        "error",
        {
          groups: [
            // 1. Side effect imports
            ["^\\u0000"],
            // 2. Node.js builtins and third-party packages
            ["^node:", "^@?\\w"],
            // 3. Alias imports (@asana, @functions, @utils) - sorted alphabetically
            ["^@(asana|functions|utils)"],
            // 4. Relative imports
            ["^\\."],
          ],
        },
      ],
      "simple-import-sort/exports": "error",
    },
  }
);
