export default {
  extends: ["stylelint-config-standard"],
  ignoreFiles: [
    "**/coverage/**",
    "**/dist/**",
    "**/generated/**",
    "**/node_modules/**",
    "artifacts/**",
    "prototypes/**",
  ],
  reportDescriptionlessDisables: true,
  reportInvalidScopeDisables: true,
  reportNeedlessDisables: true,
  reportUnscopedDisables: true,
  rules: {
    "at-rule-no-unknown": [
      true,
      {
        ignoreAtRules: ["theme"],
      },
    ],
    "custom-property-pattern": [
      "^([a-z][a-z0-9]*)(-[a-z0-9]+)*(--[a-z0-9]+(-[a-z0-9]+)*)?$",
      {
        message:
          "Expected custom property to be kebab-case, optionally followed by a Tailwind theme modifier.",
      },
    ],
    "import-notation": "string",
    "no-descending-specificity": [
      true,
      {
        ignore: ["selectors-within-list"],
      },
    ],
  },
};
