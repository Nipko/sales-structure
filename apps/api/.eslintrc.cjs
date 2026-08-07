module.exports = {
  root: true,
  parser: "@typescript-eslint/parser",
  parserOptions: {
    project: "./tsconfig.json",
    sourceType: "module",
  },
  plugins: ["@typescript-eslint"],
  extends: ["eslint:recommended", "plugin:@typescript-eslint/recommended"],
  env: {
    node: true,
    jest: true,
  },
  ignorePatterns: ["dist", "node_modules"],
  rules: {
    "@typescript-eslint/no-explicit-any": "off",
    "@typescript-eslint/no-unused-vars": "off",

    // `catch {}` deliberado. El codebase traga el error a propósito en decenas
    // de puntos best-effort —invalidar una caché, escribir telemetría, un
    // mkdir de arranque, un cleanup— donde fallar sería peor que seguir, y el
    // camino principal ya maneja el caso. `allowEmptyCatch` es exactamente la
    // opción que ESLint provee para eso; la regla sigue atrapando if/for/
    // función vacíos, que es lo que `no-empty` realmente busca cazar.
    "no-empty": ["error", { allowEmptyCatch: true }],

    // `while (true)` con `break` adentro es un patrón legítimo (pools de
    // workers, loops de reintento) y aparece así en simulation.service. En
    // ESLint 8 `checkLoops` solo acepta booleano —el valor fino
    // "allExceptWhileTrue" recién existe en v9—, así que se apaga el chequeo
    // en loops. Las condiciones constantes en if/ternario se siguen reportando.
    "no-constant-condition": ["error", { checkLoops: false }],
  },
};
