# Lo que hace falta de afuera, en una sola lista

Todo lo que se podía hacer sin nadie más está hecho: la tabla A1–H3 no tiene
ninguna fila `abierta`, y las 18 que siguen bloqueadas nombran cuál de estos
cinco portones las bloquea. Este documento es el paquete de cada uno — variables
por nombre y nunca con su valor, alcance, duración, costo máximo, datos usados,
criterio de aborto, rollback, qué consultar y qué evidencia queda.

Nada de esto se ejecuta todavía. Pedirlo es una decisión del dueño, y algunas de
estas decisiones cuestan dinero o tocan a clientes reales.

Los números salen de artefactos generados, no de estimaciones: el costo de
certificación lo calcula `generate-certification-manifest.cjs` desde el catálogo
de modelos que usa el router, y el alcance sale del catálogo de perfiles.

---

## Gate 1 — cuentas de canal para pilotos reales

Bloquea: A2, A3, A4, C1, E3 (junto con el 5), F3, G3.

| | |
|---|---|
| **Variables** | `META_APP_ID`, `META_APP_SECRET`, `META_CONFIG_ID`, `META_VERIFY_TOKEN`, `SYSTEM_USER_ID`, `WHATSAPP_VERIFY_TOKEN`, `INSTAGRAM_APP_SECRET`, `NEXT_PUBLIC_INSTAGRAM_APP_ID`, `NEXT_PUBLIC_INSTAGRAM_REDIRECT_URI`, `MESSENGER_FB_LOGIN_CONFIG_ID`, y un token de bot de Telegram por cuenta de prueba |
| **Alcance** | Una WABA de prueba, una cuenta de Instagram profesional, una página de Facebook y un bot de Telegram, todos del negocio, ninguno de un cliente. Números y cuentas **de prueba**: el piloto manda mensajes reales por infraestructura real |
| **Duración** | 2 semanas de piloto por canal, con un agente y un tenant |
| **Costo máximo** | El de Meta desde el 1-oct-2026: US$0,0008 por mensaje de servicio en Colombia, con 1.000 gratis por número por mes. Con un piloto de un número y menos de 1.000 mensajes/mes, cero. Telegram e Instagram/Messenger no cobran |
| **Datos usados** | Conversaciones del propio equipo escribiéndole al agente. Ningún cliente real sin autorización aparte |
| **Aborto** | Cualquier mensaje entregado a un número que no esté en la lista de prueba; cualquier `sent` sin webhook de estado que lo confirme; cualquier respuesta con una afirmación que no tenga `executedTools` detrás |
| **Rollback** | Desconectar la cuenta desde `/admin/channels` (revoca el token por-cuenta) y apagar el agente. Las conversaciones quedan; nada que se haya enviado se puede recuperar, y por eso el aborto es por mensaje y no por día |
| **Qué mirar** | `channel_accounts.health`, la cola `outbound-messages`, `outbound_payloads` (que no queden filas con `payload` no nulo y `sent_at`), y el Centro de calidad del agente |
| **Evidencia esperada** | Una corrida de certificación por canal con `channel_type` real en vez de `web_widget`, y la matriz de `/admin/channels/certification` con capacidades **observadas** y no sólo declaradas |

---

## Gate 2 — proveedor de LLM, modelo, techo y autorización de ejecución

Bloquea: C3, D2, F1, H1, H3. Es el que mantiene el catálogo en **0 de 76
perfiles certificados**.

| | |
|---|---|
| **Variables** | Una de `OPENAI_API_KEY`, `XAI_API_KEY`, `DEEPSEEK_API_KEY`, `ANTHROPIC_API_KEY` — la que corresponda al modelo elegido |
| **Alcance** | 76 perfiles × 4 idiomas × 5 canales × 1 modelo = 78.120 casos y **139.940 llamadas**. El ejecutor ya existe, se ensaya con gasto cero y reserva el presupuesto ANTES de llamar |
| **Duración** | Hasta **233 horas** de reloj de modelo. Es paralelizable por lease; el ejecutor recupera los leases vencidos |
| **Costo máximo** | Depende del modelo, y la diferencia no es marginal: `gpt-4o-mini` **US$258,80**; `grok-4-1-fast-non-reasoning` **US$301,00**; `deepseek-chat` **US$464,20**; `gpt-4.1-mini` **US$677,40**; `gpt-4o` **US$4.198,20**; `claude-sonnet-4-6` **US$5.466,20**. Gemini queda excluido por no soportar tools |
| **Datos usados** | Escenarios sintéticos del catálogo. Ninguna conversación de cliente |
| **Aborto** | El techo se comprueba antes de cada tarea y `spent >= budget` frena la corrida; hay `pause`, `resume` y `cancel`, y un `deadline` que la corta por reloj. Una corrida cancelada no se reabre |
| **Rollback** | No hay nada que revertir: la certificación escribe evidencia, no configuración. Lo gastado, gastado — por eso el techo va delante y no detrás |
| **Qué mirar** | `agent_certification_runs.spent_usd_cents` contra `budget_usd_cents`, `agent_certification_cases` por estado, y el informe por perfil (no un promedio: 76 perfiles promediados en un veredicto es la falla que el informe existe para evitar) |
| **Evidencia esperada** | `certification-manifest.json` con perfiles certificados > 0 y, para D2, el `semanticEntailment` que hoy dice `not_evaluated` |

**La decisión que hace falta**: qué modelo, y con qué techo. Sin las dos cosas el
ejecutor se niega a arrancar, que es el comportamiento correcto.

---

## Gate 3 — personas para sesiones moderadas

Bloquea: D1, D3, G2.

| | |
|---|---|
| **Variables** | Ninguna. Hacen falta personas, no credenciales |
| **Alcance** | Onboarding, recorridos guiados, accesibilidad y revisión de muestra del aprendizaje. Entre 5 y 8 participantes que no conozcan el producto, más un revisor con lector de pantalla |
| **Duración** | Sesiones de 45 minutos; una semana para todas |
| **Costo máximo** | El del incentivo que decida el dueño |
| **Datos usados** | Un tenant de prueba sembrado. Ningún dato de cliente |
| **Aborto** | Un participante que no pueda completar el alta sin ayuda: eso es un hallazgo, no un fallo de la sesión, y la sesión sigue |
| **Rollback** | Purgar el tenant de prueba |
| **Qué mirar** | Los eventos de navegación (`navigation.access_denied` y el contador de costo), y dónde se detiene cada persona |
| **Evidencia esperada** | La revisión de muestra de veracidad que D1 pide, que hoy el informe declara y no mide |

---

## Gate 4 — cuentas de alternativas y revisores ciegos

Bloquea: F4 y el cierre del benchmark.

| | |
|---|---|
| **Variables** | Las credenciales de cada alternativa que se quiera comparar, más los correos de los revisores |
| **Alcance** | El arnés ya compara por corpus de contenido y revisa a ciegas por etiqueta; lo que falta son las cuentas y las personas |
| **Duración** | Una semana por alternativa |
| **Costo máximo** | La suscripción de cada alternativa durante la comparación, más el techo del gate 2 para el sujeto propio |
| **Datos usados** | El mismo corpus para todos los sujetos; el arnés rechaza un corpus derivado |
| **Aborto** | Un revisor que pueda deducir qué sujeto es cuál rompe la ceguera y la comparación se descarta |
| **Rollback** | Cancelar las suscripciones. La comparación queda como evidencia con su fecha |
| **Qué mirar** | `benchmark_runs`, `benchmark_attempts` y `benchmark_reviews` |
| **Evidencia esperada** | Un informe con sujetos etiquetados a ciegas y su declaración de método |

---

## Gate 5 — autorización de merge, despliegue, migración y activación

Bloquea: E3 (con el 1), H2, y el propio PR.

| | |
|---|---|
| **Variables** | Ninguna nueva. `SERVER_HOST`, `SERVER_SSH_KEY` y compañía ya existen y apuntan a **producción** |
| **Alcance** | Hacer merge del PR, dejar que `deploy.yml` corra, aplicar migraciones y encender el outbox durable (`E3`), que hoy está apagado por defecto |
| **Duración** | El deploy es de minutos; la activación gradual, del dueño |
| **Costo máximo** | Ninguno directo. El riesgo es de disponibilidad, no de dinero |
| **Datos usados** | Producción |
| **Aborto** | Cualquier familia de cobro cuyo contador de huérfanos sea distinto de cero antes del deploy: esas filas dejan de ser cobrables en el momento en que el código nuevo corre, y hay que verlas primero. `GET /tenant-payments/:tenantId/agreed-terms/orphans` es la consulta |
| **Rollback** | El deploy reinicia contenedores con la imagen anterior; las migraciones son **aditivas** y no hace falta revertirlas. Encender el outbox se apaga con el mismo interruptor |
| **Qué mirar** | El heartbeat `backup:last_success`, las colas de BullMQ, `tenant_payment_intents` con `status='requires_review'`, y el Ops Center |
| **Evidencia esperada** | Un despliegue con cero mensajes perdidos y cero filas de cobro en revisión que no lo estuvieran antes |

---

## Y antes que todos ellos: staging

No existe. Ni en los secrets del repositorio ni en el entorno local hay un host,
una base ni una credencial de staging; `SERVER_HOST` y `SERVER_SSH_KEY` son la
VPS de producción. La fase 11 no está bloqueada por una credencial que alguien
tenga que pegar: está bloqueada por un entorno que hay que crear.

Lo mínimo para que la fase 11 signifique algo:

- una VPS o un proyecto aparte, con su propio PostgreSQL, PgBouncer, Valkey y
  Cloudflare Tunnel;
- `SERVER_HOST`, `SERVER_USER`, `SERVER_SSH_KEY`, `DATABASE_URL`,
  `DIRECT_DATABASE_URL`, `REDIS_HOST`, `ENCRYPTION_KEY`, `JWT_SECRET`,
  `JWT_REFRESH_SECRET`, `INTERNAL_JWT_SECRET`, `INTERNAL_API_KEY` — **propios**,
  nunca los de producción;
- un workflow de deploy que apunte ahí, o un `workflow_dispatch` con el entorno
  como entrada;
- y la decisión de qué datos lleva: sembrado desde cero es lo seguro; una copia
  de producción exigiría purgar antes de que nadie la mire.

Mientras no exista, el PR se revisa por su contenido y por la evidencia local,
que es lo que hay y está dicho como tal.
