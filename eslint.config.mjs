import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Local working files, and what the end-to-end tests write
    ".scratch/**",
    "e2e/.state/**",
    "e2e/.reports/**",
    "e2e/.tools/**",
  ]),
  // The end-to-end tests are not app code: Playwright's `use` is not a React
  // hook, API answers are read loosely, and the preload is CommonJS on purpose.
  {
    files: ["e2e/**"],
    rules: {
      "react-hooks/rules-of-hooks": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-require-imports": "off",
      "no-empty-pattern": "off",
    },
  },
]);

export default eslintConfig;
