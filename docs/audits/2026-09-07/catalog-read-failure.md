# Catálogo — ausencia de producto y fallo de consulta

Fecha: 2026-09-07. Corrección registrada en `e3ac0917`, posterior a `b6db0507`.

`get_product` atrapaba cualquier fallo de la consulta y devolvía `Product not found`. Esto confundía una base no disponible con un producto ausente. Además, `send_product_image` reducía el error de su lector al campo `error`, perdiendo los datos de estado y recuperación.

El lector ahora usa el contrato común: `ok` con los hechos del catálogo y fecha de lectura, `empty` con `product: null` si la consulta no encuentra filas, y `error/read_failed` si falla. Conserva precio, moneda, stock desconocido, disponibilidad y requisito de receta; no devuelve metadata interna. El envío de imágenes conserva el fallo completo y distingue producto ausente de producto sin fotos, sin generar un efecto de media en ninguno de esos casos.

## Validación

La batería histórica de implementación pasó **6 suites / 56 pruebas** y TypeScript API pasa. Los seis casos nuevos cubren búsquedas por UUID/nombre, base no disponible frente a ausencia, proyección de hechos, fallos al resolver imágenes y resolución correcta de una imagen existente. Son pruebas con errores de base simulados; esta tanda no se presenta como prueba de PostgreSQL ni de entrega externa.

```powershell
node node_modules/jest/bin/jest.js --config apps/api/jest.config.js --runInBand --testPathPattern='read-semantics.spec|catalog-order-integrity.spec|trusted-price-context.spec|tool-error-sanitizer|tool-approval-effects.contracts.spec|app.bootstrap.spec' --globals '{"ts-jest":{"isolatedModules":true,"diagnostics":false}}' --silent
node node_modules/typescript/bin/tsc --project apps/api/tsconfig.json --noEmit --incremental false
```

La comprobación exacta del índice al registrar este bloque pasó **5 suites / 54 casos** y TypeScript API, según la [bitácora incremental](incremental-commits-resumed.md); se solapa con la batería histórica, no añade 54 pruebas independientes. La réplica comercial, la integración del ciclo de vida RAG, el resto de lectores y los pilotos continúan pendientes. El capturador RAG tiene su propia evidencia y no es parte de esta corrección. El límite de uso que bloqueó temporalmente commits quedó superado por la reanudación de registros; no hubo despliegue ni cambios en tenants existentes.
