# 0021 — Ventana de vigencia de 2 s para las verificaciones de la evaluación

- Estado: aprobada
- Fecha: 2026-11-06 · Decide: Claude con la delegación del dueño (decisiones del rediseño con la opción más recomendada) · Autor: Claude (E2s)
- Ámbito: `apps/api/src/modules/evaluation-revision/evaluation-revision.service.ts` (`captureFresh`, usado por `assertCurrent`). No cambia `capture` ni lo que recibe el cliente.

## Contexto

Cada llamada al modelo dentro de una evaluación (ensayo, Agent Test, aprendizaje, publicación) verifica la revisión del tenant antes y después (`dataSourceAuthority`). Una verificación hashea todas las tablas de dependencia del tenant: unas 249 en los tenants QA, ~0,8 s de CPU de PostgreSQL y ~250 idas y vueltas.

Con el ensayo concurrente (#384, ADR 0018) esas verificaciones saturaron los 2 núcleos del VPS: E2r tuvo 254 intentos con timeout de herramientas (3 s) contra 8 en E2q. Agrupar las verificaciones que se solapan (#396) no alcanzó (E2s: 224). Subir el pool de conexiones tampoco (hotel solo: 5 timeouts, mediana 17 s).

## Decisión

Una verificación puede usar una captura que **empezó** como mucho 2 s (`FRESHNESS_WINDOW_MS`) antes de que se pidiera, esté corriendo o terminada. Si no hay ninguna así, espera la siguiente, que arranca cuando termina la que corre (#396). Una captura fallida nunca se reutiliza.

## Consecuencias

- Una edición del tenant durante una evaluación se detecta en la primera verificación que ocurra más de 2 s después de la edición, en vez de en la siguiente verificación inmediata. Como se verifica antes y después de cada llamada y al cierre, la evaluación igual se invalida; solo puede quedar una llamada intermedia hecha con el dato nuevo dentro de esa ventana.
- Medido con el hotel solo (40 casos, 3 a la vez): 0 timeouts y mediana 4,3 s, contra 3 a 5 timeouts y 15–17 s sin la ventana.
- Si alguna vez se necesita la garantía estricta, se baja `FRESHNESS_WINDOW_MS` a 0 y se vuelve a un caso a la vez por tenant.
