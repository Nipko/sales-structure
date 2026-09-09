import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

/**
 * Accessibility rules, on purpose rather than by inheritance.
 *
 * `eslint-config-next` turns on six `jsx-a11y` rules as warnings and that was
 * the whole of the project's a11y checking — warnings nobody reads, in a
 * dashboard whose operators include people running a business from a phone.
 * The plugin ships with Next and is already registered by the configs spread
 * above; only the rule selection is ours.
 *
 * The split below is measured, not aspirational. Everything in ERRORS is
 * already clean across `src/`, so it is a gate: it can only fire on new code.
 * Everything in DEBT has existing violations, counted here so the number is a
 * fact instead of a feeling, and left as a warning so the gate above can be
 * real today. Moving a rule up is the point; adding one to DEBT to make a
 * build pass is not.
 */
const A11Y_ERRORS = [
    "anchor-has-content",
    "anchor-is-valid",
    "aria-activedescendant-has-tabindex",
    "aria-props",
    "aria-proptypes",
    "aria-unsupported-elements",
    "autocomplete-valid",
    "heading-has-content",
    "iframe-has-title",
    "img-redundant-alt",
    "media-has-caption",
    "mouse-events-have-key-events",
    "no-access-key",
    "no-distracting-elements",
    "no-redundant-roles",
    "role-has-required-aria-props",
    "role-supports-aria-props",
    "scope",
    "tabindex-no-positive",
];

/** Rule → violations in `src/` when this list was written (8 sep 2026). */
const A11Y_DEBT = {
    "no-static-element-interactions": 235,
    "click-events-have-key-events": 231,
    "no-autofocus": 23,
    "label-has-associated-control": 20,
    "no-noninteractive-element-interactions": 12,
    "alt-text": 1,
    "interactive-supports-focus": 1,
    "no-noninteractive-tabindex": 1,
};

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "off",
      "react-hooks/set-state-in-effect": "off",
      "react/no-unescaped-entities": "off",
      ...Object.fromEntries(A11Y_ERRORS.map((rule) => [`jsx-a11y/${rule}`, "error"])),
      // `role` is also an ordinary prop name — this codebase passes a user role
      // to components that way — and the rule cannot tell a business role from
      // an ARIA one. Restricted to real DOM elements, where it is unambiguous.
      "jsx-a11y/aria-role": ["error", { ignoreNonDOM: true }],
      ...Object.fromEntries(Object.keys(A11Y_DEBT).map((rule) => [`jsx-a11y/${rule}`, "warn"])),
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
