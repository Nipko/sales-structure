# Directiva para Claude: cerrar el candidato de release sin tocar producción

Fecha: 10 de septiembre de 2026. Punto de partida verificado: `bce5e8555260fbeffe537d1766f66b4ea49e52b0`.
Rama y PR de revisión: `claude/agent-platform-finalization-20260909`, draft PR #21.

## Mandato

Continúa desde el HEAD indicado y toma propiedad de todo el cierre técnico previo al despliegue. No vuelvas a hacer una auditoría general desde cero ni cierres la tarea después de un hallazgo parcial: reproduce cada problema, corrígelo, agrega evidencia que habría fallado antes y continúa hasta que no quede trabajo local ejecutable.

Mantén el PR como draft. No hagas merge, no empujes a `main`, no despliegues, no migres producción, no actives flags productivos, no llames proveedores reales y no gastes en modelos. El dueño va a introducir un tema funcional importante antes del merge; por tanto, deja el candidato preparado y espera ese tema después de completar esta directiva.

Trabaja sobre la misma rama de revisión y actualiza el mismo PR cuando las verificaciones locales pasen. Haz commits incrementales por unidad lógica y usa rutas explícitas al preparar cada commit; nunca `git add .` ni `git add -A`.

Preserva exactamente las cuatro entradas locales ajenas actuales:

- `CLAUDE.md`;
- `docs/plan-profitability-2026-07.md`;
- `.validate-index.cjs`;
- `docs/whatsapp-meta-pricing-2026-10.md`.

No las reformatees, restaures, incluyas en commits ni uses como evidencia del lote.

## Estado que debes conservar como verdad de partida

- La construcción local A1-H3 reporta 7 filas aceptadas, 18 bloqueadas por gates externos y 0 abiertas.
- Hay 0 de 76 perfiles certificados con modelo real.
- El PR tiene 300 commits y 977 archivos frente a `origin/main`; es mergeable y sus checks de PR están verdes, pero sigue sin revisión y no ejecutó los jobs `Merge and nightly infrastructure evidence` ni `Weekly full regression and release preflight`.
- La evidencia local publicada declara 603 suites, 6.568 pruebas y 168 pruebas Playwright, sin fallos ni omisiones.
- Las migraciones nuevas son aditivas y el deploy tiene backup previo fail-closed, pero todavía falta un preflight automático para términos comerciales huérfanos.
- No existe staging. Los únicos secretos de host conocidos apuntan a producción.
- Playwright llega a la pantalla de publicación del agente, pero no ejecuta el acto completo de publicar, comprobar la configuración servida y revertirla.

No presentes “cero filas abiertas” como “producto certificado” ni “listo para publicar”.

## P0 — automatizar el preflight de términos huérfanos

El runbook exige consultar `GET /tenant-payments/:tenantId/agreed-terms/orphans` antes del despliegue, pero `deploy.yml` no aplica ese criterio automáticamente a todos los tenants. Corregirlo es requisito de release porque A1/C2 cambian comportamiento de cobro al cargar el runtime nuevo, aunque el outbox permanezca apagado.

Construye un comando de sólo lectura, apto para ejecutarse dentro de la imagen candidata, que:

1. derive todos los tenants y sus schemas desde la autoridad global, sin una lista manual;
2. ejecute el inventario canónico de términos huérfanos para cada tenant;
3. emita únicamente identificadores operativos y conteos, nunca PII ni muestras de clientes;
4. termine con código distinto de cero si no puede enumerar tenants, no puede inspeccionar un schema, recibe una forma inválida o encuentra un total mayor que cero;
5. distinga schema aún no aprovisionado de una consulta rota sin convertir errores en cero;
6. produzca un resumen estable y parseable con tenants inspeccionados, familias inspeccionadas, huérfanos y errores;
7. no fabrique términos ni modifique filas históricas. Los casos reales deben pasar a revisión humana.

Intégralo en `.github/workflows/deploy.yml` antes de las migraciones y antes de recrear contenedores, usando la imagen candidata y la conexión directa apropiada. El deploy debe abortar cerrado. Conserva el backup previo y deja claro qué ocurre primero. Si la imagen candidata no puede ejecutar el comando antes de una migración requerida, separa una inspección compatible con el schema anterior y prueba ambas versiones; no muevas el control después del cambio que pretende proteger.

Prueba al menos: cero huérfanos, una familia con huérfanos, múltiples tenants, tabla opcional ausente, schema inválido, fallo de consulta, salida no numérica y base inalcanzable. Añade una prueba contractual que falle si el workflow deja de invocar el preflight antes de migrar.

## P0 — recorrer la publicación real del agente

Cubre el acto completo que hoy falta. Debe existir evidencia ejecutada, sin proveedor externo, de este recorrido:

1. crear o modificar un borrador de agente;
2. producir y fijar la evaluación/evidencia exigida;
3. abrir el espacio de publicación desde el agente o desde el traspaso de Assist;
4. revisar la diferencia que se va a publicar;
5. publicar con `requestKey`, hashes y revisión esperada;
6. comprobar el recibo durable y la nueva versión operativa;
7. resolver el agente por su conexión y demostrar, mediante el runtime real con proveedor falso determinista, que un turno nuevo usa la configuración publicada;
8. ejecutar rollback y demostrar que otro turno usa la versión anterior;
9. demostrar que doble clic/reintento es idempotente y que un hash, candidato o evidencia obsoletos no publican nada.

Hazlo en dos niveles:

- integración API contra PostgreSQL real, atravesando controller/service/store y la resolución efectiva de persona;
- Playwright desde la UI, incluyendo confirmación, estado final, error recuperable y rollback.

Incluye negativos de aislamiento de tenant y roles. Un `tenant_agent` no puede publicar; un administrador de otro tenant no puede observar ni mutar el candidato. No sustituyas el recorrido por llamadas directas al método que se pretende probar.

## P0 — ejecutar la puerta de release sobre el HEAD final

Después de los cambios anteriores:

- verifica artefactos generados y regenera sólo mediante sus generadores;
- typecheck en frío de api, dashboard, whatsapp, landing, mobile y shared;
- builds de las cinco apps;
- bootstrap real de Nest;
- suite API completa con PostgreSQL, pgvector, Valkey y PgBouncer conectados, cero suites omitidas;
- al menos tres órdenes de suite, incluyendo dos semillas distintas;
- Playwright completo dos veces, escritorio y móvil;
- migraciones en schema limpio, upgrade desde el estado anterior y bajo escritores concurrentes;
- `git diff --check` y los lint/contratos que el primer PR hizo ejecutables.

Ejecuta en la rama el nivel manual `release` de `vertical-quality.yml` si puede correr sin credenciales reales, llamadas externas, gasto ni despliegue. Antes de lanzarlo demuestra por lectura de triggers y jobs que no toca producción. Si alguna parte necesita un gate externo, no la falsifiques: ejecuta todo lo restante, deja el job preparado y registra exactamente la variable y autorización que falta.

## P1 — preparar staging sin crear infraestructura externa

No existe staging y esta directiva no autoriza contratar ni aprovisionar recursos. Deja listo en código todo lo que sí puede prepararse:

- workflow manual separado o workflow reutilizable con environment `staging`;
- contrato de secretos propio de staging y rechazo explícito de valores/hostnames de producción;
- PostgreSQL, PgBouncer, Valkey, claves y túnel separados;
- datos sintéticos sembrados desde cero, nunca copia de producción por defecto;
- migración pública y de todos los schemas con los mismos fallos cerrados de producción;
- health checks, smoke de API/dashboard/widget/WhatsApp, publicación y rollback del agente;
- prueba del preflight de huérfanos;
- activación del outbox sólo para un tenant/canal sintético y apagado posterior;
- captura de métricas y logs sin PII;
- rollback a imagen anterior y criterio verificable de éxito.

Añade un runbook con los nombres de variables, orden, abortos, rollback y evidencia esperada. No declares la fase de staging cerrada hasta ejecutarla en un host real separado.

## P1 — hacer revisable el alcance del PR

El PR contiene 300 commits y 977 archivos. No lo dividas mecánicamente ni reescribas historia sin necesidad. Produce primero un inventario derivado del diff contra `origin/main` que agrupe:

- runtime por subsistema;
- migraciones y datos afectados;
- cambios de dashboard/mobile/landing;
- pruebas y evidencia;
- documentación;
- funciones apagadas por flag;
- comportamiento que cambia inmediatamente al desplegar;
- efectos remotos posibles;
- rollback por grupo.

Comprueba que cada commit pertenece al release. Si encuentras cambios no relacionados, sácalos mediante commits normales y auditables o documenta por qué no deben separarse. Actualiza título y cuerpo del draft PR para que un revisor entienda el cambio final, los riesgos, el plan de staging, el preflight de cobros y la activación gradual.

## Correcciones documentales

- Evita afirmar un costo único de certificación sin nombrar el modelo. El manifiesto actual muestra importes diferentes por proveedor/modelo.
- Mantén separadas construcción local, evidencia ejecutada, certificación real, staging y activación productiva.
- El reporte final debe indicar `HEAD`, rango, commits nuevos, archivos cambiados, pruebas, omisiones, artefactos, checks remotos y árbol de trabajo.
- Si `closure-report.json` conserva una revisión anterior porque desde entonces sólo cambió documentación sin afectar sus autoridades, explícalo; no cambies el hash a mano.

## Gates externos que deben permanecer abiertos y honestos

No intentes cerrar sin autorización:

- modelo, credencial y presupuesto para certificar 76 perfiles;
- cuentas de prueba para WhatsApp, Instagram, Messenger y Telegram;
- 5-8 participantes nuevos y una persona con lector de pantalla;
- cuentas de competidores y revisores ciegos;
- host y secretos separados para staging;
- aprobación humana del PR, merge, producción y activación gradual.

Puedes preparar un canario barato de certificación —un perfil, cuatro idiomas y web chat, con presupuesto calculado— pero no ejecutarlo. La certificación completa y el benchmark no son requisitos para desplegar código con flags apagados, pero sí para activar ampliamente o afirmar superioridad de mercado.

## Condición de entrega

Detente únicamente cuando:

1. el preflight de huérfanos sea automático y fail-closed;
2. publicación y rollback del agente estén recorridos de extremo a extremo;
3. todas las verificaciones locales repetibles estén verdes sobre el HEAD final;
4. staging esté preparado en código y sólo falten infraestructura/secrets;
5. el PR sea revisable, actualizado y siga en draft;
6. no quede ningún defecto local conocido;
7. el único remanente sea uno de los gates externos enumerados.

Entrega un informe adversarial: qué intentaste romper, qué rompiste, commits que lo corrigieron, evidencia ejecutada y gates externos exactos. No hagas merge ni despliegue. Espera el nuevo tema funcional del dueño antes de pedir aprobación final.
