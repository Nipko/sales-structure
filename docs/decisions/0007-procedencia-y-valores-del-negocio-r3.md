# 0007 — Procedencia y valores del negocio: lo que C0 no fijaba (R3)

- Estado: aprobada (decidida con la autorización autónoma del dueño del 30-oct-2026; se revisa con él a su regreso)
- Fecha: 2026-10-30 · Decide: dueño · Autor: Claude (R3)
- Ámbito: `requirement_values` y `requirement_value_versions`, columnas de procedencia de los 12 catálogos y textos, `BusinessFactsService`, `SnapshotReader`, `apps/api/scripts/readiness/backfill-provenance`, siembra de verticales.

## Contexto

R3 implementa C0 §2.1, §2.2, §2.5 y §2.9. Al construirlo aparecieron decisiones que el diseño no fijaba. Se toman aquí para que el código no las esconda.

## Decisión

1. **La procedencia de una fila vale mientras la fila no cambie.** Cada escritura de procedencia deja `source_ref.row_updated_at`. Si una pantalla actual (que no conoce las columnas nuevas) edita la fila después, el lector vuelve a las reglas L. El default de columna `content_status='confirmed'` no prueba nada: la lectura exige `origin` y la estampa.
2. **Valores migrados frente a fuentes viejas.** Un valor escrito por `BusinessFactsService` reemplaza todo lo heredado de ese requisito y alcance. Un valor migrado lleva `source_ref = {migrated_from, migrated_hash}` y solo reemplaza la fuente de la que se copió, mientras esa fuente siga igual. Si la fuente cambió, la copia se ignora; las demás fuentes viejas se siguen leyendo, así las contradicciones siguen visibles.
3. **Una fila por requisito y alcance.** El backfill copia el registro que gana por §7.2. Si dos fuentes confirmadas se contradicen, copia la más reciente y anota la otra en `contradiction_with`.
4. **Lo que el backfill no copia:** los defaults de columna (L4: el requisito queda ausente), la región (sigue en `tenants.operating_*`), el horario derivado de la agenda, las promociones y los valores heredados que no validan (por ejemplo, un público fuera de B2C/B2B en 4 tenants). Estos últimos se siguen leyendo con las reglas L y el informe los lista.
5. **`quote` se separa a medias.** El backfill escribe `price_type=a_cotizar` y deja `price_status='quote'`, porque el runtime, el motor de reservas y el dashboard leen `'quote'`. Pasarlo a `confirmed` es el paso *contract*, cuando el runtime lea `price_type`.
6. **Alcance de ítem `item:<id>`**, el que ya usan el motor y qaTruth, en lugar del `item:<table>:<id>` de §2.1. Los ids son uuid, no chocan entre tablas.
7. **Actor del historial** en jsonb: `{kind:'user', userId, role, delegation?}` o `{kind:'script', name}`. `confirmed_by` guarda el usuario efectivo. Un `super_admin` sin impersonar recibe 403 al escribir.
8. **Aceptar defaults** escribe `value = null` («el default de la plataforma para esta `spec_version`»), solo en requisitos con predicado de default aceptado y sin pisar un valor del dueño. La re-aceptación por `default_changed_in` queda para cuando el YAML lo declare.
9. **La validación** comprueba solo lo normativo de `data.structure`: campos conocidos, requeridos, booleanos y enums cerrados. Las políticas admiten además `summary` y `title` (para migrar las de texto libre) y el horario admite `timezone`.
10. **El SQL de escritura vive en `business-facts.statements.ts`**, sin Nest ni Prisma, y lo reusa el backfill. Un test prohíbe `INSERT`/`UPDATE` sobre `requirement_values` fuera de ese archivo y del servicio, también en `apps/api/scripts` y `prisma`.
11. **Escribir un valor nuevo no actualiza el almacenamiento viejo.** Un `PUT` de `CORE.HOURS.REGULAR` no escribe `settings.businessHours`: la preparación usa el valor nuevo, pero el agente sigue leyendo el viejo hasta que R3b mueva sus lectores. Por eso **el control de salida (R4) no se activa antes de R3b**, o el panel diría «listo» con datos que el agente no ve.
12. **Motor:** un `price_status` *example* gana en todas las tablas; el chequeo de modelo de precio nunca cuenta un precio de ejemplo; «dato heredado: confírmalo» también sale con `origin` legacy o legacy_inferred; qaTruth trata las listas vacías de ítems heredados como ausentes.
13. **Siembra:** el alta y el cambio de vertical ya no siembran FAQs (se borran las funciones de siembra de FAQs de tours, dental e inmobiliaria). Los servicios de muestra nacen con `price=NULL`, la moneda del país y `price_status` example o quote; los planes de membresía, con precio 0 marcado example (la columna es NOT NULL). Las FAQs de la receta siguen en `vertical-definitions.ts` porque el asistente de configuración las muestra. Las FAQs ya sembradas se marcan `seeded`, pero no se despublican: eso requiere el aviso al dueño (D5).
14. **Guardas del backfill:** exige `--dry-run` o `--apply` (uno solo); no escribe en un esquema cuyo veredicto o `resultHash` cambie, ni en uno sin las tablas y columnas de R3; al terminar vuelve a planificar para confirmar que no queda nada.

## Consecuencias

- Las reglas L1–L7 no se retiran en este PR: el backfill no ha corrido en producción y las pantallas actuales escriben sin procedencia. `docs/domain/business-readiness-runtime.md` dice cuándo se retira cada una (L4 nunca por backfill).
- Ninguna tabla ni columna con datos se borra.
- La migración se ensayó dos veces sobre una copia solo-estructura de la base de producción (23 esquemas): idempotente, columnas en las 12 tablas y `requirement_values` en los 23.
