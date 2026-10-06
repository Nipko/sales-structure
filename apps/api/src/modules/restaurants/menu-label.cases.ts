/**
 * One table of [typed text, canonical form], run through the JavaScript normaliser (unit test)
 * and the SQL expression (Postgres test). If the two ever diverge, an allergen the customer
 * names would stop matching what the kitchen stored.
 */
export const MENU_LABEL_CASES: Array<[string, string]> = [
    ['Mariscos', 'marisco'], ['MARISCOS', 'marisco'], ['  mariscos ', 'marisco'], ['Mariscós', 'marisco'], ['marisco', 'marisco'],
    ['Glúten', 'gluten'], ['GLUTEN', 'gluten'], ['Trigo', 'gluten'], ['wheat', 'gluten'],
    ['Frutos  secos', 'nuez'], ['fruto seco', 'nuez'], ['Nuez', 'nuez'], ['nueces', 'nuez'], ['  NUECES  ', 'nuez'],
    ['maní', 'mani'], ['maníes', 'mani'], ['Mani', 'mani'],
    ['camarón', 'camaron'], ['camarones', 'camaron'], ['piñón', 'pinon'], ['piñones', 'pinon'],
    ['pez', 'pez'], ['peces', 'pez'], ['huevos', 'huevo'],
    ['amendoim', 'amendoim'], ['amendoins', 'amendoim'], ['noz', 'noz'], ['nozes', 'noz'],
    ['Lácteos', 'leche'], ['lactosa', 'leche'], ['Lactose', 'leche'], ['leche', 'leche'], ['leches', 'leche'], ['dairy', 'leche'],
    ['Sésamo', 'sesamo'], ['ajonjolí', 'sesamo'], ['sesame', 'sesamo'],
    ['Coração', 'coracao'], ['Røkt', 'rokt'], ['Håndbrød', 'handbrod'], ['Ål', 'al'],
    ['soja', 'soja'], ['', ''], ['   ', ''],
];
