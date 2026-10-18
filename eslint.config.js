/**
 * ESLint Configuration
 * Lint rules for all TypeScript/React files: recommended JS + TypeScript
 * rules, React Hooks rules, and the Vite fast-refresh rule.
 */

import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
      {
        files: ["src/app/router.tsx"],
        rules: {
          "react-refresh/only-export-components": "off",
        },
      },
      {
        files: ["src/components/ui/button.tsx"],
        rules: {
          "react-refresh/only-export-components": [
            "warn",
            {
              allowConstantExport: true,
              allowExportNames: ["buttonVariants"],
            },
          ],
        },
      },
    ],
    languageOptions: {
      globals: globals.browser,
    },
  },
])
