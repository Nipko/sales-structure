# Paquete actual de gates externos

Fecha de revisión: 13 de septiembre de 2026.

La autoridad de estado es
[`closure-report.md`](./closure-report.md). Hoy registra **25 filas aceptadas,
27 bloqueadas por un gate externo concreto, 0 abiertas y 1 diferida**. Esto
significa que el barrido no conoce trabajo local pendiente dentro de esos
programas; no significa que el producto ya esté certificado o listo para abrir
tráfico. Siguen en cero los **76 perfiles certificados**, los **5 canales
operados** y los **5 canales certificados**.

Los números de certificación salen de
[`certification-manifest.md`](./certification-manifest.md) y los del canario
pequeño de `plan-certification-canary.cjs`. No se copian cifras de informes
anteriores.

## Decisiones que faltan

Hay ocho gates. Se pueden preparar en paralelo, pero cada ejecución necesita la
autorización indicada y evidencia propia.

1. Cuentas de canal para pilotos reales.
2. Proveedor LLM, modelo, presupuesto y autorización de ejecución.
3. Personas nuevas para sesiones moderadas.
4. Cuentas de alternativas y revisores ciegos.
5. Autorización para push, candidato, migración, cutover y activación gradual.
6. WABA y número reales con moneda, financiación, permisos, plantillas y método
   de pago configurados en Meta.
7. Destinatario consentido, presupuesto y autorización para llamadas reales a
   Meta.
8. Aprobación legal y financiera de contratos y copy comercial.

## Gate 1 — cuentas de canal

Bloquea A2, A3, A4, B1, C1, E3, F3, G3 y parte de M1/M5/R6.

- **Alcance:** una WABA y un número de prueba, una cuenta profesional de
  Instagram, una página de Messenger y un bot de Telegram controlados por
  Parallly; Web Chat usa un tenant piloto del mismo equipo.
- **Credenciales:** las variables que corresponden a cada canal, entre ellas
  `META_APP_ID`, `META_APP_SECRET`, `META_CONFIG_ID`, `META_VERIFY_TOKEN`,
  `SYSTEM_USER_ID`, `WHATSAPP_VERIFY_TOKEN`, `INSTAGRAM_APP_SECRET` y el token
  del bot de Telegram. Los valores se cargan como secretos, nunca en documentos,
  commits o logs.
- **Datos:** conversaciones sintéticas del equipo. No se usan clientes reales.
- **Aborto:** cualquier destinatario fuera de la lista, efecto duplicado,
  respuesta con una acción no respaldada por tools, o recibo que haga retroceder
  el estado.
- **Evidencia:** run id, revisión, cuenta/canal, casos ejecutados, recibos,
  deduplicación y resultado por capacidad en `/admin/channels/certification`.

## Gate 2 — certificación con modelo

Bloquea C3, D2, F1, H1, H2 y parte de H3.

- **Decisión mínima:** elegir un modelo certificable y un techo de gasto.
- **Alcance actual:** **93.320 casos y 260.620 llamadas por modelo**, 76 perfiles
  × 4 idiomas × 5 canales. El tiempo máximo derivado es 434 horas de modelo.
- **Techos calculados:** desde **US$449,80** con `gpt-4o-mini` hasta
  **US$6.671,00** con `claude-sonnet-4-6`. La tabla completa y las variables
  exactas están en [`certification-manifest.md`](./certification-manifest.md).
- **Control:** el ejecutor reserva presupuesto antes de arrendar cada caso,
  admite `pause`, `resume` y `cancel`, corta por deadline y conserva el modelo
  realmente servido.
- **Datos:** sólo corpus sintético. No publica configuración ni envía mensajes.
- **Evidencia:** ledger completo por perfil, tarea, canal, idioma y modelo, gasto
  liquidado y motivos de cada rechazo.

Antes de la matriz completa se ejecuta el canario derivado actual: **244 casos,
724 llamadas y techo US$1,24**. Si cambian catálogo, canales o verificadores,
`check-canary-figures.cjs --check` obliga a actualizar esta cifra.

## Gate 3 — sesiones con personas nuevas

Bloquea D1, D3, F3, F4, G2, L6 y parte de H3.

- **Participantes:** entre 5 y 8 personas que no conozcan el producto, más una
  persona que use lector de pantalla.
- **Recorridos:** alta, conexión de canal, creación y publicación del primer
  agente, explicación de tools, corrección guiada por Assist y recuperación de
  un error.
- **Datos:** tenants de prueba sin datos de clientes.
- **Resultado:** tiempo, ayudas solicitadas, pasos abandonados, errores de
  comprensión y revisión humana de una muestra de respuestas/aprendizaje.

## Gate 4 — benchmark externo

Bloquea H3, F4 y parte de M1/R3.

- **Decisión:** alternativas concretas, cuentas autorizadas, duración de la
  suscripción y revisores ciegos.
- **Método:** mismo corpus y condiciones para cada sujeto; Parallly debe estar
  incluido; las etiquetas no revelan el proveedor.
- **Aborto:** corpus diferente, un solo sujeto, pérdida de ceguera o comparación
  sin evidencia ejecutada.
- **Evidencia:** `benchmark_runs`, `benchmark_attempts` y `benchmark_reviews`,
  con fecha, versión y coste.

## Gate 5 — candidato y cutover en el VPS actual

Bloquea E3, M4, R6 y la publicación del release.

La decisión del dueño es usar **el mismo VPS de producción**, con tenants piloto
ya existentes. Por eso no se crea otro “staging”. Se construyen imágenes de
candidato antes del merge, se ensayan migraciones sobre una base desechable y se
abre sólo la lista de tenants piloto. El procedimiento completo y reanudable es
[`docs/runbooks/october-cutover.md`](../../runbooks/october-cutover.md).

- **Antes de empujar:** revisión del diff, artefactos al día, suite completa,
  build, Playwright, backup reciente y censo de huérfanos de términos en cero.
- **Repositorio:** environment protegido `candidate-images`, revisores,
  `CANDIDATE_AUTHORIZED_ACTORS`, `CANDIDATE_PUBLIC_API_URL`,
  `CANDIDATE_PUBLIC_WA_URL` y los secretos públicos de build enumerados por
  `candidate.yml`.
- **Host:** acceso, capacidad, Node disponible para validar el manifiesto,
  base desechable con nombre de rehearsal/eval, ids exactos de tenants piloto y
  ventana acordada.
- **Orden:** push de la rama → checks → candidato → backup → rehearsal de
  migración/restore → contenedores candidato → canario con ingress controlado →
  atestación humana → apertura → activación por tenant.
- **Aborto:** error de backup, inventario cambiado sin aceptación, migración o
  restore incompletos, healthcheck rojo, duplicado, gasto sin reserva o canario
  sin atestación.
- **Rollback:** imágenes y datos se restauran juntos antes de reabrir; los
  efectos remotos ya aceptados se reconcilian y nunca se “desenvían”.

El VPS no se toca desde una validación local. Push, publicación de imágenes,
migración y cutover requieren autorización explícita.

## Gate 6 — financiación y método de pago de Meta

Bloquea M1, M2, M5 y R6.

Cada negocio agrega su tarjeta o método de pago **en la superficie segura de
Meta asociada a su propia WABA**. Parallly guía, abre el destino de Meta y relee
el estado; no captura, tokeniza, almacena ni paga esa tarjeta.

Esto es independiente de:

- la suscripción que el negocio paga a Parallly;
- las credenciales que el negocio conecta para cobrar a sus propios clientes;
- y cualquier tarjeta guardada por el comercio en otro proveedor.

Antes del piloto deben constar WABA, número, moneda real, financiación lista,
permisos, plantillas y método de pago. Un error `131042` pausa sólo el número
afectado, no reintenta el mismo envío y sólo se levanta después de que Meta
acepta una nueva verificación. La guía operativa y el copy autorizado están en
[`docs/whatsapp-meta-pricing-2026-10.md`](../../whatsapp-meta-pricing-2026-10.md).

## Gate 7 — canario real de Meta

Bloquea R6 y las afirmaciones de entrega/coste real.

- **Destinatario:** número controlado, con consentimiento documentado.
- **Presupuesto:** techo explícito calculado desde la moneda/tarifa que la WABA
  expone; si la tarifa no se puede resolver, no se presume cero.
- **Modo inicial:** `observe`; `enforce` se activa por tenant sólo después de
  comparar reservas, recibos y factura.
- **Evidencia:** cantidad de POST, wamid, estados aceptado/entregado/leído o
  rechazo conclusivo, liquidación del ledger, franquicia y ausencia de segundo
  POST por reintento.
- **Aborto:** destinatario incorrecto, dos POST para un efecto lógico, gasto sin
  reserva, moneda mezclada o `131042` reintentado.

## Gate 8 — aprobación legal y financiera

Bloquea L5 y cualquier publicación contractual o comercial nueva.

- **Legal:** términos, privacidad, tratamiento de datos, roles de Parallly/Meta,
  retención, eliminación y textos de consentimiento en es/en/pt/fr.
- **Finanzas:** separación de los tres cobros, impuestos, moneda, márgenes y
  afirmaciones de precio.
- **Evidencia:** versión aprobada, responsables, fecha y alcance. Una aprobación
  verbal no cambia el artefacto ni el estado del gate.

## Qué ya puede hacerse sin abrir gates

Se puede revisar el PR, repetir pruebas locales, regenerar artefactos, inspeccionar
el VPS de forma sólo lectura cuando se autorice el acceso y preparar la ventana.
No se debe afirmar “listo para desplegar” hasta que el candidato, la migración,
el canario y los controles externos correspondientes produzcan evidencia real.
