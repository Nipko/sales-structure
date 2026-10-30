'use strict';
/**
 * Entrada de Node para la lectura de la especificación desde disco (`@parallext/business-spec/load`).
 * El núcleo (`index`) es puro y no la exporta; la API la usa en tiempo de ejecución desde `dist/`.
 * Los tipos salen de `load.d.ts`; jest y los scripts con ts-node resuelven `src/load.ts`.
 */
module.exports = require('./dist/load');
