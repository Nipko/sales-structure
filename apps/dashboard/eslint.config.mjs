import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

/**
 * Accessibility rules, on purpose rather than by inheritance.
 *
 * `eslint-config-next` turns on six `jsx-a11y` rules as warnings and that was
 * the whole of the project's a11y checking — warnings nobody reads, in a
 * dashboard whose operators include people running a business from a phone.
 * The plugin ships with Next and is registered by the configs spread above
 * for the files they cover; only the rule selection is ours, and the block
 * below is scoped to the same files so the rules cannot outrun the plugin.
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
    // Scoped to exactly the glob `eslint-config-next/core-web-vitals` uses,
    // which is where it registers `jsx-a11y`.
    //
    // Without this the object applied to EVERY file, including ones those
    // configs do not match — and for those the plugin does not exist, so
    // `eslint .` died with "could not find plugin jsx-a11y" before checking a
    // single file. The accessibility gate described above therefore never
    // fired: not in CI, not anywhere. Registering the plugin again instead is
    // refused outright ("Cannot redefine plugin"), which is the flat config
    // saying the same thing.
    files: ["**/*.{js,jsx,mjs,ts,tsx,mts,cts}"],
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
  {
    /**
     * Las specs cargan los cuatro idiomas por ruta calculada.
     *
     * Todas comparten el mismo idiom: `['es','en','pt','fr'].map(locale =>
     * require(`../messages/${locale}.json`))`, para que la prueba lea las
     * traducciones REALES de los cuatro y no una copia que se desactualiza. Una
     * ruta calculada no puede ser un `import` estatico, asi que la regla se
     * apaga acá — en un solo lugar y con el motivo escrito — en vez de repetir
     * veinte comentarios de desactivacion. Los `require` de ruta fija que habia
     * sí se convirtieron en imports.
     */
    files: ["**/*.spec.ts", "**/*.spec.tsx"],
    rules: { "@typescript-eslint/no-require-imports": "off" },
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
