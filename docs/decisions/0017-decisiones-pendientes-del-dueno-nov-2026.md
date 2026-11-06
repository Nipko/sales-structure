# 0017 — Decisiones pendientes del dueño (noviembre 2026)

- Estado: aprobada (el dueño delegó cada decisión en la opción más recomendada el 2026-11-06: «hagamos todas las decisiones con lo que mejor encaje y sea mas recomendado»)
- Fecha: 2026-11-06 · Decide: dueño · Autor: Claude
- Entorno: pruebas, sin clientes reales.

## Contexto

Al cerrar las mediciones E2o y E2p quedaron decisiones abiertas del dueño. Venían de la fase D, del ensayo y de la limpieza K3, y frenaban arreglos o retiros de código. Este ADR registra cada una con su motivo y lo que se ejecuta.

## Decisiones

### 1. Triaje de seguridad en el dental: sigue apagado hasta la revisión clínica

`agentRuntime.safetyTriage` corrige la urgencia dental P08-7, que hoy falla 3 de 3. Su definición exige que una persona con criterio clínico revise las plantillas, y el dueño eligió esperar esa revisión. Mientras tanto P08-7 se cuenta como fallo conocido y no se ajusta el agente para disimularlo.

### 2. Valores automáticos de la base de datos: opción B

Un valor que la base pone sola porque el campo nunca se llenó no es un dato del negocio hasta que este lo confirme. Ejemplos: mínimo 1 y máximo 10 viajeros por tour, cargo de limpieza 0.

- El agente no lo afirma: dice que no lo tiene confirmado y ofrece una persona.
- El motor de reservas sigue aplicando el límite. Solo cambia lo que el agente afirma.
- La evaluación de salud pide al negocio confirmar esos campos. Guardar el formulario los confirma, aunque quede el mismo valor.

Se implementa extendiendo la regla L4 de `legacy-status.ts`, que ya trata así el país, el check-in y check-out, la financiación y la política de pago. Es coherente con D1j: un 0 no respalda una negación.

### 3. Catálogo sembrado: no se presenta como oferta confirmada

Algunos ítems y servicios vienen de plantillas de alta (`contentStatus` seeded o example) y no los cargó el negocio. El agente puede mencionarlos, pero aclara que están pendientes de confirmación. Es la misma regla que la decisión 2, aplicada al catálogo, y explica la mayor parte de la caída de C01 en E2p: el juez penaliza afirmar oferta sembrada.

### 4. Puerta de salida a producción: sombra ahora, aplicar antes del primer cliente real

`readiness.goLiveGate` sigue en modo sombra: registra la decisión sin bloquear. Se enciende en modo aplicar cuando se cumplan dos condiciones:

- dos mediciones completas seguidas sin bajar de la anterior;
- antes de conectar el primer cliente real.

Encenderla ahora silenciaría los canales en vivo de los tenants QA no publicados, que se usan para probar a mano.

### 5. Límite de 10 minutos del ensayo: se mantiene y el ensayo corre 3 casos a la vez

R7 pide 40 casos en menos de 10 minutos. En E2o las 21 ejecuciones se cortaron en hora pico UTC, a 16 s por caso.

- No se sube el límite ni se deja seguir al ensayo con aviso.
- El ensayo corre hasta 3 casos a la vez (`CASE_CONCURRENCY`, #384).
- El reloj se mira antes de empezar cada caso.

### 6. Limpieza K3

- **Tablas sin uso.** Son 14 por tenant, más `kb_unanswered_queries` y las públicas viejas. Se retiran en dos fases:
  1. Contar filas, respaldar con `pg_dump` y quitar del código.
  2. En un PR aparte, borrar las tablas solo después de comprobar el respaldo.
- **SMS.** Se retira: módulos, adaptador Twilio, pantallas e interruptor. No hay créditos vendidos a clientes reales. Las 3 tablas de créditos quedan para la fase 2.
- **Ayuda al usuario.** La fuente única es la ayuda de Assist, que es la que llega al producto.
- **Landing.** Primero se cambian los validadores. Después se retiran las piezas desmontadas y `ToolsTour.tsx`.
- **Arreglos sin decisión.** Cifras del canario: el test no escribe en documentos reales. Se unifica `apps/api/CLAUDE.md` y se reubican artefactos generados fuera de `docs/audits`.

### 7. Revisión de lo decidido en modo autónomo

Se prepara un resumen de una página de los ADR 0004 a 0017. Marca lo que el dueño debería mirar primero: lo irreversible, lo que afecta a clientes y lo que sigue a prueba.

## Consecuencias

- Las decisiones 2 y 3 bajan algunas respuestas «afirmativas» en los tenants QA, que usan valores automáticos y catálogo sembrado. A cambio, el agente no afirma lo que el negocio no decidió. El juez ya mide así.
- Ningún borrado de tablas entra sin respaldo comprobado.
- Cada cambio de código entra entre mediciones, nunca durante una.
