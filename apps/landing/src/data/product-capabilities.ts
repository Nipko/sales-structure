/**
 * Code-backed product counts used by the landing.
 * `check:claims` cross-checks these values against the vertical registry,
 * channel adapters, locale files, knowledge modules and prompt assembler.
 */
export const PRODUCT_CAPABILITY_COUNTS = {
  verticals: 18,
  channels: 6,
  interfaceLanguages: 4,
  knowledgeTiers: 5,
  promptLayers: 3,
} as const;
