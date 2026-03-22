import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: ["dist/", "node_modules/", "coverage/", "tests/e2e/"],
  },
  ...tseslint.configs.recommended,
  {
    rules: {
      // Relax for existing codebase — tighten over time
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
      "@typescript-eslint/no-require-imports": "off",
      "no-console": ["warn", { allow: ["warn", "error"] }],
      "prefer-const": "warn",
    },
  },
  {
    files: ["tests/**/*.ts"],
    rules: {
      // Tests can be looser
      "@typescript-eslint/no-unused-vars": "off",
      "no-console": "off",
    },
  },
);
