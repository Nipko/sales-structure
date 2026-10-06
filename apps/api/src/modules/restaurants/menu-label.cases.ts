/**
 * Shared cases for the allergen matcher. Run through the JavaScript candidates (unit test) and
 * the SQL expression (Postgres test); both must give the same candidate set, and a dish stored
 * with the second label must be EXCLUDED when the customer types the first (and the reverse).
 */

/** [typed by the customer, stored by the kitchen]: the dish must be excluded, in both directions. */
export const MENU_LABEL_MATCHES: Array<[string, string]> = [
    // case, accents, spaces
    ['Mariscos', 'mariscos'], ['MARISCOS', 'mariscos'], ['  mariscos ', 'mariscos'], ['marisco', 'mariscos'], ['Mariscós', 'mariscos'],
    ['Glúten', 'gluten'], ['GLUTEN', ' gluten '],
    // Spanish plurals
    ['nuez', 'nueces'], ['Nueces', 'Nuez'], ['maní', 'maníes'], ['mani', 'maní'], ['camarón', 'camarones'], ['piñón', 'piñones'],
    ['pez', 'peces'], ['huevo', 'huevos'], ['dulce', 'dulces'], ['carne', 'carnes'], ['leche', 'leches'],
    ['frutos secos', 'fruto seco'], ['Frutos  secos', 'fruto seco'], ['frutos\tsecos', 'fruto seco'],
    // Portuguese
    ['amendoim', 'amendoins'], ['noz', 'nozes'], ['camarão', 'camarões'], ['Maçã', 'maçãs'], ['pão', 'pães'], ['Coração', 'coração'],
    // French
    ['arachide', 'arachides'], ['amande', 'amandes'], ['moule', 'moules'], ['huître', 'huîtres'], ['sardine', 'sardines'],
    ['crustacé', 'crustacés'], ['Crustacés', 'crustacé'],
    // English
    ['pecan', 'pecans'], ['bean', 'beans'], ['soybean', 'soybeans'], ['peanut', 'peanuts'], ['shellfish', 'Shellfish'],
    // minimum synonyms
    ['lácteos', 'leche'], ['lactosa', 'leche'], ['Lactose', 'lactosa'], ['dairy', 'leche'], ['milk', 'lácteos'],
    ['Sésamo', 'ajonjolí'], ['sesame', 'sésamo'], ['trigo', 'gluten'], ['wheat', 'Gluten'],
    ['frutos secos', 'nueces'], ['nuez', 'frutos secos'],
    // stored decomposed (NFD): letter + combining mark
    ['maní', 'maníes'], ['piñón', 'piñones'], ['Mariscós', 'mariscós'], ['huître', 'huîtres'],
];

/** [typed, stored]: different foods that must NOT match. */
export const MENU_LABEL_MISSES: Array<[string, string]> = [
    ['mani', 'manzana'], ['leche', 'lechuga'], ['pez', 'pecan'], ['gluten', 'glucosa'], ['marisco', 'mariscal'],
    ['nuez', 'nudo'], ['ajo', 'ajonjolí'], ['arroz', 'arrozal'], ['noz', 'nuez'], ['soja', 'sal'], ['huevo', 'hueso'],
];

/** Every label the two tables mention, plus blanks and Nordic letters: all go through the JS-vs-SQL comparison. */
export const MENU_LABEL_ALL: string[] = [...new Set([
    ...MENU_LABEL_MATCHES.flat(), ...MENU_LABEL_MISSES.flat(), '', '   ', 'Røkt', 'Håndbrød', 'Ål', 'soja',
])];
