# Autoridad del agente al guardar entregas aprobadas de Web Chat

La entrega aprobada de una imagen o un enlace de pago debe conservar la autoridad del agente que originó la propuesta hasta que el mensaje y el recibo `stored` quedan confirmados en PostgreSQL. El scope proviene del ledger del servidor, fuera de los argumentos del modelo y del trabajo de cola.

## Frontera del cambio

La transacción de entrega local toma privacidad, tenant, tabla/agente, efecto/ticket/ledger y conversación/contacto en ese orden. Comprueba tenant, actividad, versión, hash operativo y selección vigente de la conexión antes de guardar. Relee los vínculos después de adquirir los locks; cambiar el canal durante la clasificación no permite entrar por una ruta sin la comprobación. El lock compartido de tabla precede a los locks de filas e impide que un INSERT concurrente de otro agente cambie la prioridad de routing antes del COMMIT local.

El origen exacto de borrador, cuando existe, liga agente y versión. En ambos modos, la autoridad procede del scope privado del ledger y se contrasta con el agente seleccionado actualmente para la conexión. La conversación conserva su primera atribución para auditoría; esa identidad histórica no sustituye al origen de una propuesta nueva. Así, una entrega originada legítimamente por B puede guardarse en una conversación iniciada por A. Si C toma la conexión con mayor prioridad, la entrega pendiente de B se rechaza aunque B no haya cambiado de versión o hash.

Una autoridad ausente, ajena o retirada impide guardar una entrega nueva. Los recibos ya confirmados se conservan: recuperar un efecto `stored` no crea otro mensaje ni exige que aquella configuración siga publicada. `stored` acredita persistencia en el historial; la recepción requiere el recibo de la sesión autenticada y no demuestra lectura humana.

El enlace de pago continúa contrastándose con la operación canónica que lo creó. Suprimir la entrega nueva no elimina esa operación, no recrea el enlace y no revierte un pago o una conciliación ya aceptados.

## Fallos y recuperación

El mensaje y el recibo se guardan de forma atómica. Ante un rollback se registra un fallo acotado usando el estado observado, sin sobrescribir otro intento ni un resultado terminal. Una confirmación incierta del COMMIT requiere comprobar el estado bajo lock; un recibo confirmado impide tratarlo como un nuevo envío.

La publicación de la referencia hacia la sesión ocurre después del COMMIT. Recuperar la conexión consulta el historial persistido. Las respuestas humanas, avisos operativos y automatizaciones conservan sus contratos existentes.

## Límites

Este bloque cubre exclusivamente entregas aprobadas de imágenes y enlaces de pago de Web Chat. No completa el control de versión para respuestas normales del agente, despachos externos, handoff ni Flow; tampoco habilita publicación HTTP, pilotos o rollback integral.

La selección previa al guardar se corrigió por separado en `9e5016f8`: la reanudación usa el agente actual de la conexión y contrasta el scope original, conservando la primera atribución para auditoría. La [evidencia de reanudación](approval-resume-routing.md) distingue ese preflight del guard transaccional de esta entrega.

Implementación registrada en `e8cea802`. La verificación sobre los archivos exactos del índice pasó TypeScript API y **10 suites / 90 pruebas**, incluidas **65 pruebas PostgreSQL en tres suites**, sin casos omitidos. Incluye autoridad ausente/alterada, otra identidad activa, versión/hash/desactivación, nueva aprobación con atribución histórica, publicación concurrente, replay, cambios de canal, pago canónico conservado, rollback, límite de fallos y confirmación perdida del COMMIT. La [bitácora incremental](incremental-commits-resumed.md) conserva la secuencia; las cifras se solapan con otras tandas. Las pruebas locales no certifican un perfil ni una entrega a un proveedor externo.

`92f9d2fa` añade la selección vigente por conexión y elimina el anclaje de política a la atribución histórica. TypeScript API y **10 suites / 94 pruebas**, incluidas **69 PostgreSQL en tres suites**, pasan sobre el índice exacto, sin omitidos. Los cuatro casos adicionales prueban el segundo agente en modos borrador/política, el desplazamiento por una conexión más específica y la serialización de un INSERT concurrente hasta guardar el mensaje y su recibo. El lock se limita a esa transacción local; no se mantiene durante llamadas a proveedores.
