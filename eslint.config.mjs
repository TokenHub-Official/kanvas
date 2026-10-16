import eslint from "@eslint/js";
import eslintReact from "@eslint-react/eslint-plugin";
import htmlReact from "@html-eslint/eslint-plugin-react";
import eslintConfigPrettier from "eslint-config-prettier/flat";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";

const noMagicNumbersRule = [
  "error",
  {
    detectObjects: false,
    enforceConst: true,
    ignore: [-1, 0, 0.5, 1, 2, 100],
    ignoreArrayIndexes: true,
    ignoreClassFieldInitialValues: true,
    ignoreDefaultValues: true,
    ignoreEnums: true,
    ignoreNumericLiteralTypes: true,
    ignoreReadonlyClassProperties: true,
    ignoreTypeIndexes: true,
  },
];

export default tseslint.config(
  {
    ignores: [
      ".agents/**",
      ".codex/**",
      ".playwright-cli/**",
      ".tmp/**",
      "**/coverage/**",
      "**/dist/**",
      "**/generated/**",
      "**/node_modules/**",
      "apps/web/public/models/**",
      "apps/web/public/onnxruntime/**",
      "architecture-fixtures/**",
      "artifacts/**",
      "eval-data/**",
      "output/**",
      "prototypes/**",
      "scenario-packs/**",
    ],
  },
  {
    linterOptions: {
      reportUnusedDisableDirectives: "error",
      reportUnusedInlineConfigs: "error",
    },
  },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked.map((configuration) => ({
    ...configuration,
    files: ["**/*.ts", "**/*.tsx"],
  })),
  {
    files: ["**/*.ts", "**/*.tsx"],
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/consistent-type-imports": [
        "error",
        {
          fixStyle: "inline-type-imports",
        },
      ],
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-import-type-side-effects": "error",
      "no-nested-ternary": "error",
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@kanvas/*/src", "@kanvas/*/src/*"],
              message:
                "Consume a declared package export, never another workspace's source tree.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["apps/web/**/*.{js,ts,tsx}"],
    languageOptions: {
      globals: globals.browser,
    },
  },
  {
    files: ["apps/web/src/**/*.tsx"],
    ...eslintReact.configs["recommended-type-checked"],
  },
  {
    files: ["apps/web/src/**/*.tsx"],
    ...reactHooks.configs.flat["recommended-latest"],
  },
  {
    files: ["apps/web/src/**/*.tsx"],
    ...htmlReact.configs.recommended,
  },
  {
    files: ["apps/web/src/**/*.tsx"],
    rules: {
      "@eslint-react/exhaustive-deps": "off",
      "@eslint-react/rules-of-hooks": "off",
    },
  },
  {
    files: ["apps/web/src/**/*.tsx"],
    ignores: ["apps/web/src/**/*.test.tsx"],
    rules: {
      "no-magic-numbers": noMagicNumbersRule,
    },
  },
  {
    files: [
      "apps/web/src/api/**/*.ts",
      "apps/web/src/auth/**/*.ts",
      "apps/web/src/components/**/*.ts",
      "apps/web/src/features/capability-bindings/**/*.ts",
      "apps/web/src/features/provider-settings/**/*.ts",
      "apps/web/src/features/usage/**/*.ts",
      "apps/web/src/features/workflows/**/*.ts",
    ],
    ignores: ["apps/web/src/**/*.test.ts"],
    rules: {
      "no-magic-numbers": noMagicNumbersRule,
    },
  },
  {
    files: ["apps/web/src/features/editor/**/*.ts"],
    ignores: [
      "apps/web/src/**/*.test.ts",
      "apps/web/src/features/editor/*-catalog*.ts",
      "apps/web/src/features/editor/*-geometry*.ts",
      "apps/web/src/features/editor/canvas-entrypoint-tools.ts",
      "apps/web/src/features/editor/canvas-export-renderer.ts",
      "apps/web/src/features/editor/canvas-image-inspector-model-v1.ts",
      "apps/web/src/features/editor/canvas-quick-tools-v1.ts",
      "apps/web/src/features/editor/canvas-text-formatting-v1.ts",
      "apps/web/src/features/editor/editor-node-factory-v1.ts",
      "apps/web/src/features/editor/editor-state*.ts",
      "apps/web/src/features/editor/image-adjustments-v1.ts",
      "apps/web/src/features/editor/image-edit.ts",
    ],
    rules: {
      "no-magic-numbers": noMagicNumbersRule,
    },
  },
  {
    files: ["apps/web/src/features/browser-executor/**/*.ts"],
    ignores: [
      "apps/web/src/**/*.test.ts",
      "apps/web/src/features/browser-executor/browser-batch-c-runtime.ts",
      "apps/web/src/features/browser-executor/u2net-browser-background-remove.ts",
    ],
    rules: {
      "no-magic-numbers": noMagicNumbersRule,
    },
  },
  {
    files: [
      "apps/web/src/auth/instance-setup-page-state.ts",
      "apps/web/src/components/app-shell-overlay-state.ts",
      "apps/web/src/features/assets/use-workspace-asset-library.ts",
      "apps/web/src/features/capability-bindings/capability-configuration-draft.ts",
      "apps/web/src/features/capability-bindings/capability-bindings-dialog-state.ts",
      "apps/web/src/features/capability-bindings/capability-bindings-runtime.ts",
      "apps/web/src/features/capability-bindings/capability-order-draft.ts",
      "apps/web/src/features/capability-bindings/use-capability-bindings-controller.ts",
      "apps/web/src/features/editor/canvas-workspace-v1.tsx",
      "apps/web/src/features/editor/canvas-workspace-notice-v1.tsx",
      "apps/web/src/features/editor/canvas-workspace-view-model-v1.ts",
      "apps/web/src/features/editor/use-canvas-draft-autosave-v1.ts",
      "apps/web/src/features/editor/use-canvas-draft-persistence-controller-v1.ts",
      "apps/web/src/features/editor/use-canvas-draft-persistence-state-v1.ts",
      "apps/web/src/features/editor/use-canvas-operation-catalog-v1.ts",
      "apps/web/src/features/editor/use-canvas-operation-dispatcher-v1.ts",
      "apps/web/src/features/editor/use-canvas-operation-preview-resources-v1.ts",
      "apps/web/src/features/editor/use-canvas-operation-run-reconciliation-v1.ts",
      "apps/web/src/features/editor/use-canvas-operation-session-storage-v1.ts",
      "apps/web/src/features/people/people-invite-draft-state.ts",
      "apps/web/src/features/people/use-people-directory.ts",
      "apps/web/src/features/provider-settings/provider-create-draft-state.ts",
      "apps/web/src/features/provider-settings/provider-secret-draft-state.ts",
      "apps/web/src/features/provider-settings/provider-settings-runtime.ts",
      "apps/web/src/features/provider-settings/use-provider-settings-lifecycle.ts",
      "apps/web/src/features/usage/budget-limit-draft-state.ts",
      "apps/web/src/features/usage/unknown-hold-resolution-state.ts",
    ],
    rules: {
      "no-magic-numbers": noMagicNumbersRule,
    },
  },
  {
    files: ["**/*.{js,cjs,mjs}"],
    languageOptions: {
      globals: globals.node,
    },
  },
  eslintConfigPrettier,
);
