# Auditoría del cobro tenant-owned (Wompi) — informe para el dueño

> **ESTADO DE EJECUCIÓN (2026-08-17) — COMPLETO.** Decisiones del dueño: `create_payment_link` baja a **A1**, y se ejecutan **las tres tandas**. **Los 17 arreglos están implementados y verificados.**
>
> **Cerrado y verificado:**
> - **P0-1** A2 → A1 en `tool-policy-registry.ts` (+ specs reescritos al comportamiento nuevo).
> - **P0-2** `findTransactionByPaymentLink` en `TenantWompiClient`, `recoverWompiIntentFromProvider` con resultado discriminado (`settled` / `no_transaction` / `unavailable`), y `TenantPaymentReconciliationService` (cron `*/10`, bajo `CronLockService`).
> - **P0-3** `tenant_payment_provider_configs` clasificada en el purge, **+ la valla de 7 días ahora se libera** si el purge falla antes de mutar nada; el spec del guard entra al pipeline.
> - **P1-3** enlace vencido: se reutiliza si sigue activo, y se mueve a `expired` cuando el proveedor **prueba** que nadie pagó — liberando la referencia.
> - **P1-5** 503 reintentable (no 401 mudo) cuando el sobre existe y no descifra.
> - **P1-1** `property_bookings.payment_status` + target `property` + `payableReference` en las dos tools: **la estadía ya es cobrable**.
> - **P1-6 / ERROR C** `list_properties` deja de contestar "no hay disponibilidad" ante un error transversal.
> - **ERROR A** `to_regclass('procedures')::text`.
> - **ERROR B** etapa canonicalizada en `syncExactOpportunityDealTx` (2 llamadores).
> - **P2** coma en el clasificador de confirmación (+ formas naturales en pt/en/fr), token del webhook enmascarado en Sentry, `JWT_SECRET`/`JWT_REFRESH_SECRET` agregados a `.env.example`.
>
> - **P1-2** heartbeat real de webhook (`recordWebhookHeartbeat`, escrito sólo cuando una entrega **autentica**) + aviso ámbar persistente "marcaste la URL como configurada y todavía no recibimos ningún evento" + fecha del último evento.
> - **P1-4** `GET :tenantId/intents/unresolved` y `POST :tenantId/intents/:intentId/resolve` (tenant_admin), más el listener de `tenant_payment.validation_failed` — que hasta ahora **no tenía un solo suscriptor en todo el repo**. Diseño clave: el operador **no elige el resultado**; se re-consulta al proveedor y se aplica la verdad. Si el proveedor no responde, se rechaza en vez de adivinar.
> - **P2** píldora ámbar `PRUEBAS` + aviso de sandbox; `errorCode` mapeado a mensaje legible en los 4 idiomas (antes todo era "Error 400"); auditoría en `audit_logs` de los 6 endpoints que mutan el riel de dinero, con **actor real** vía `auditActor` y sin registrar jamás un secreto.
>
> **Verificación final:** `tsc` limpio en api/dashboard/landing · bootstrap de DI verde · **103 specs de tenant-payments + 204 de pipeline/CRM/alquiler/contratos** · matriz vertical **1560/1560** · eslint limpio · paridad i18n confirmada (68 claves × 4 idiomas).
>
> **Lo único que NO es código y sigue siendo tuyo: la Tanda 0** (pegar la URL de eventos en el panel de Wompi, confirmar que pegaste el *secreto de eventos* y no el *de integridad*, y que esa única URL no esté ocupada por otra integración). Con el heartbeat, si algo de eso está mal la pantalla ahora te lo dice en vez de fallar en silencio.

---

## 1. VEREDICTO

**Nota: 6 / 10.** Desagregada, porque son dos cosas distintas:

- **Calidad del código: 8,5/10.** Es de lo mejor construido del repo. La criptografía de credenciales, la idempotencia, la transaccionalidad y el "fail-closed" están hechos con criterio real: el monto nunca lo pone la IA, el webhook nunca confía en el cuerpo del evento, y ante la duda el sistema jamás dice "pagado".
- **Cobro real funcionando de punta a punta: 3/10.** Hoy, con la cuenta Wompi que acabás de configurar, **no se puede emitir un enlace de cobro por chat** (una compuerta de verificación de identidad lo bloquea para todo tenant que no tenga el módulo de seguros), y en tu vertical (alquiler vacacional) **ni siquiera existe el objeto cobrable** para una reserva de propiedad. Encima, si un evento de Wompi no llega, no hay ningún camino —automático ni manual— para acreditar ese pago.

En una frase: **el motor está bien construido pero no tiene el arranque conectado, y no tiene rueda de auxilio.**

---

## 2. QUÉ FUNCIONA (dalo por bueno)

Verificado en código, no asumido:

- **Cifrado de credenciales**: AES-256-GCM, IV nuevo por escritura, clave de 64 hex obligatoria, y —lo importante— el sobre está atado a `tenant + proveedor + ambiente + campo`. Copiar una credencial de un tenant a otro **no descifra**. Ninguna credencial sale por la API (siempre enmascarada) ni por los logs.
- **La IA no puede inventar plata**: `create_payment_link` recibe un solo argumento (la referencia del pedido). El monto, la moneda y el concepto se leen del servidor, se re-verifican dos veces más antes de tocar Wompi, y el enlace creado se vuelve a leer del proveedor comparando campo por campo (monto en centavos, moneda, uso único, vencimiento) **antes** de compartir la URL con el cliente.
- **No se puede cobrar al contacto equivocado**: la pertenencia se prueba con un SELECT contra la base filtrando por el contacto de la conversación, no por lo que diga el modelo.
- **El webhook no confía en el evento**: solo toma el ID de transacción y re-consulta la transacción canónica a Wompi. Verifica la firma respetando el orden dinámico de campos, compara en tiempo constante, y exige que el ambiente coincida.
- **Idempotencia real**: apoyada en índices únicos de la base dentro de la misma transacción que la liquidación. Un reintento de Wompi no cobra ni acredita dos veces. Un enlace vencido no genera un segundo cobro.
- **Coherencia de ambiente**: las tres llaves (pública, privada, events) tienen que compartir prefijo de ambiente o el guardado se rechaza. No podés dejar llaves de producción etiquetadas como sandbox.
- **Unicidad de comercio**: dos tenants no pueden reclamar la misma cuenta Wompi (índice único + lock transaccional).
- **Cableado de deploy completo**: las tres variables de entorno nuevas están en GitHub Secrets, en `deploy.yml` y en el `.env`; API y worker comparten el mismo archivo, así que no hay asimetría de clave. El feature flag del plan llega a los planes ya creados vía migración (el seed solo no habría alcanzado). Migraciones estrictamente aditivas. i18n completa en los 4 idiomas.
- **Los webhooks siguen funcionando aunque el tenant esté en mora**: correctamente exentos del bloqueo por suscripción.

---

## 3. LO QUE ROMPE PLATA (P0)

Hay **tres**.

### P0-1 — El cobro por IA es inalcanzable: nunca se genera un enlace

**Qué pasa en la vida real:** el cliente escribe "quiero pagar". La IA llama a la herramienta. Antes de crear nada, una compuerta central exige "verificación de identidad reforzada" (nivel A2). Para completarla hace falta que la IA tenga las herramientas `request_identity_code` / `verify_identity_code` — y esas **solo se publican si el tenant tiene el módulo de seguros activado**. Para cualquier otro tenant hay dos desenlaces, los dos sin enlace: si el contacto no tiene email, se corta con "identidad no verificable" y escala a humano; si tiene email, se le manda un código de 6 dígitos que el cliente escribe en el chat y **la IA no tiene forma de recibirlo** → bucle infinito.

Esto explica literalmente el log: la IA anuncia el pago y no llega nada.

- `apps/api/src/modules/conversations/tool-policy-registry.ts:171-182` (`assurance: 'A2'`)
- `packages/shared/src/vertical-capability-manifest.ts:205-209` (`requiresStepUpIdentity: true`)
- `apps/api/src/modules/conversations/tool-execution-control.service.ts:801-805` (la compuerta corre antes de todo)
- `apps/api/src/modules/conversations/conversations.service.ts:1973-1974` (las tools de identidad solo salen con seguros)

**Arreglo (elegí uno):**
1. **Recomendado**: bajar `create_payment_link` a `A1` en `tool-policy-registry.ts:174`. Un enlace hospedado no mueve plata por sí solo, y ya quedan como barrera el guard central + la confirmación firmada + Wompi autenticando al pagador.
2. Si querés mantener A2: mover `REQUEST_IDENTITY_CODE_TOOL` y `VERIFY_IDENTITY_CODE_TOOL` de `tools/insurance-tools.ts` a un módulo compartido y publicarlas junto a las tools de pago en `payment-tool-registration.ts`. Ojo: eso deja el cobro dependiendo de que el contacto tenga email, cosa que la mayoría de los contactos de WhatsApp no tiene.

---

### P0-2 — Si el primer evento de Wompi no llega, el pago se cobra y nunca se acredita

**Qué pasa en la vida real:** pegás mal el events secret, o no pegás la URL de eventos en el panel de Wompi, o Wompi agota sus reintentos durante un deploy. El cliente paga 250.000 COP. La plata entra a tu cuenta Wompi. En la plataforma el pedido queda impago **para siempre**.

Por qué no se recupera: el "polling de respaldo" que debería rescatarlo exige un `providerTransactionId`, y ese campo **solo lo escribe el propio webhook**. Es circular: el rescate necesita el dato que solo puede traer el evento que se perdió. Y el cliente Wompi del tenant no tiene búsqueda de transacciones por referencia ni por enlace (solo por ID de transacción), el enlace se crea sin `redirect_url` (el pagador nunca vuelve a nuestro backend), no hay ningún cron en el módulo, y no hay endpoint ni pantalla para conciliar a mano.

- `apps/api/src/modules/tenant-payments/tenant-payments.service.ts:1178-1180` (el `if` que exige el ID)
- `apps/api/src/modules/tenant-payments/tenant-payment-store.service.ts:539, 560, 606` (únicos escritores del ID)
- `apps/api/src/modules/tenant-payments/tenant-wompi.client.ts` — verificado: solo `verifyMerchant`, `createAndVerifyPaymentLink`, `getAndValidatePaymentLink`, `getTransaction`
- Verificado: cero `@Cron` en todo el módulo

**Arreglo:** el primitivo que falta **ya existe en el repo** para el riel de plataforma — `apps/api/src/modules/billing/adapters/wompi.adapter.ts:519` usa `GET /transactions?reference=...` justo para recuperar transacciones huérfanas. Portarlo a `TenantWompiClient` y llamarlo desde `reconcileExpiredWompiIntent` antes de marcar "requiere revisión", más un cron que barra intents `pending` sin `providerTransactionId` pasados N minutos.

---

### P0-3 — Ningún tenant se puede borrar (y tu private key de Wompi queda para siempre)

**Qué pasa en la vida real:** la tabla nueva `tenant_payment_provider_configs` no fue clasificada en el guard de purga. Ese guard enumera **toda** tabla de `public` con columna `tenant_id` y rechaza cualquiera que no conozca. Desde que corrió la migración, el borrado duro de **cualquier** tenant falla con 409, y el cron de limpieza de las 4 AM se come el error en silencio todas las noches.

**Agravante que encontró el refutador:** el purge publica una valla `tenant:purging:{tenantId}` con TTL de **7 días** cinco líneas *antes* de que el guard falle, y no la libera en el camino de error. Si disparás un purge sobre un tenant **vivo**, ese tenant queda 7 días con el login rechazado y sin poder emitir facturas DIAN, sobre un borrado que nunca ocurrió.

- `apps/api/src/modules/prisma/prisma.service.ts:6-24` (verificado en vivo: la tabla no está en la lista)
- `apps/api/prisma/migrations/20260816140000_.../migration.sql:7-8`
- El guard de deriva del propio repo (`prisma.service.spec.ts`) **está en rojo en main** y no corre en el pipeline de deploy.

**Arreglo:** agregar `'tenant_payment_provider_configs'` a `TENANT_PUBLIC_PURGE_ORDER` (antes del borrado final de `tenants`), y agregar `apps/api/src/modules/prisma/prisma.service.spec.ts` a la lista de specs de `.github/workflows/deploy.yml` para que el guard vuelva a proteger. Esta es exactamente la misma regresión que ya pasó en agosto con `billing_charge_attempts`.

---

## 4. LO QUE VA A DOLER (P1)

**P1-1 — El alquiler vacacional no tiene objeto cobrable.** `create_property_booking` devuelve la reserva sin referencia pagable, y no existe el target `property` en el mapa de objetos cobrables (solo `order`, `tour`, `food`, `enrollment`). Peor: `property_bookings` ni siquiera tiene columna `payment_status`, que el resolver necesita leer. Tu tenant de turismo puede cobrar **tours** pero no una **estadía**.
`tenant-payment-reference.ts:12-51`, `ai-tool-executor.service.ts:1173, 2297-2312`, `prisma/tenant-schema.sql:2042-2064`.
→ Migración aditiva (`ADD COLUMN payment_status`), agregar el target, y emitir `payableReference` desde `createPropertyBooking` y `listMyPropertyBookings`.

**P1-2 — El "webhook configurado" es una autodeclaración.** El sello que enciende el "Listo" verde lo escribe el propio click de Activar (`tenant-payments.service.ts:626`), no una entrega real. El panel puede decir "Activo y listo" con una URL que nadie probó nunca. Agrava P0-2. Nota práctica: **Wompi admite una sola URL de eventos por ambiente**, así que si tu cuenta ya la tiene ocupada por otra integración, apretar "Aceptar" no arregla nada.
→ Guardar un heartbeat del último evento recibido y mostrar aviso ámbar persistente: "marcaste la URL como configurada pero todavía no recibimos ningún evento".

**P1-3 — Un enlace que vence a las 24h deja ese pedido incobrable para siempre.** El cliente pide el link el lunes, no paga; el miércoles pide de nuevo → 503 permanente. El índice único impide crear otro intent para esa referencia, el estado `expired` existe en la base pero nadie lo escribe nunca, y no hay endpoint que lo destrabe. Es el evento **más rutinario** del comercio por chat.
`tenant-payments.service.ts:907-931`, `tenant-payment-store.service.ts:94-96, 270-272`.
→ Si el enlace sigue activo, devolver la URL existente en vez de tirar; si está probadamente inactivo y sin transacción, mover el intent a `expired` (ya permitido por el CHECK y excluido del índice).

**P1-4 — `requires_review` y `ambiguous` son estados sin salida.** Si el pedido cambió de precio entre el enlace y el pago, el sistema hace lo correcto (no acredita, marca para revisión) pero después **nadie puede resolverlo**: no hay endpoint, ni pantalla, ni cron, y los tres eventos que emite el webhook (`tenant_payment.succeeded/refunded/validation_failed`) **no tienen un solo suscriptor** en todo el repo. Único camino: SQL a mano en producción.
→ Endpoint tenant_admin que liste intents no resueltos con sus intentos y permita una transición auditada, más un listener de `validation_failed` que levante incidente en el Ops Center.

**P1-5 — Fallo de descifrado = 401 mudo.** Si un sobre cifrado deja de abrirse (rotación de clave mal hecha, restore de backup viejo), el webhook responde exactamente el mismo 401 que le daría a un atacante, sin log, sin Sentry, sin contador. El panel dice "no conectado" y vos no tenés forma de distinguir "clave rota" de "llamador falso".
`tenant-wompi-webhook.service.ts:30-31`, `tenant-payments.service.ts:1857-1867`.
→ Devolver 503 (reintentable) cuando existe el sobre pero no se puede abrir, y emitir un incidente.

**P1-6 — `list_properties` se traga errores y le miente al viajero.** Un `catch { /* skip unavailable */ }` **vacío** dentro del bucle: si el rango de fechas es inválido (o el cliente pide una sola noche con check-in = check-out), la excepción se repite para todas las propiedades, la lista queda vacía y el agente contesta "no hay disponibilidad" con todo libre. El catch exterior hace lo mismo con un fallo de base.
`ai-tool-executor.service.ts:2073-2090`.
→ Validar el rango una vez antes del bucle y devolver `{error:'invalid_dates'}` al modelo (que sí se autocorrige); nunca vaciar el catálogo por un error transversal.

---

## 5. DEUDA MENOR (P2)

Resumidos, ninguno urgente:

- **Sandbox se ve idéntico a producción.** Un proveedor activo en sandbox muestra las mismas píldoras verdes; ningún indicador de ambiente, y el backend no bloquea activar con llaves de prueba. Un cobro de sandbox marca el pedido real como pagado. Requiere que vos pegues llaves de prueba a propósito, pero no hay red.
- **Todo rechazo del backend se muestra como "Error 400".** La página descarta el `errorCode` que ya viene en la respuesta. No podés distinguir llaves mezcladas, plan sin la feature o edición concurrente. El patrón correcto ya existe en `ProvidersTab.tsx:197`.
- **El clasificador de confirmación rechaza "Sí, confirmo"** (normaliza la puntuación final pero no la coma interna). El cliente confirma y el sistema vuelve a preguntar. Falla cerrado, pero frena la venta. `tool-execution-control.service.ts:149-156`.
- **El token del webhook viaja a Sentry** dentro de `request.url` en el 20% de las transacciones muestreadas, justo el valor que el código guarda cifrado y excluye de los logs. No es explotable solo (falta el events secret), pero anula una capa de defensa. `instrument.ts` necesita un `beforeSendTransaction` que enmascare el último segmento.
- **Adoptar `TENANT_PAYMENT_CREDENTIAL_KEY` más adelante rompe todo en silencio** si no cambiás también el `KEY_ID` (los sobres actuales dicen `primary`). Es reversible vaciando el secret y redeployando, pero no está advertido. Y el procedimiento de rotación (`rewrapProviderCredentials`) **no tiene ningún llamador**: hoy no se puede ejecutar.
- **Disconnect nunca borra el secreto** (decisión deliberada, para poder validar reembolsos tardíos), pero el procedimiento que decide cuándo sí es seguro borrarlo tampoco tiene llamadores.
- **Un super_admin puede reemplazar credenciales de cobro de cualquier tenant sin impersonación y sin registro durable** de qué cambió. No es escalada de privilegio (ya puede impersonar), es pérdida de atribución sobre un riel de dinero. El módulo hermano de canales sí audita.
- **El toggle de "Cobros a clientes" se pinta apagado aunque esté guardado como activo** cuando el plan no incluye la feature, y eso bloquea todo guardado del agente sin explicar por qué.

---

## 6. LOS ERRORES QUE YA ESTÁN SALIENDO EN PRODUCCIÓN

**ERROR A — `to_regclass` sin `::text`. Nada que ver con el cobro.**
`procedure-engine.service.ts:71` hace `SELECT to_regclass('procedures') AS reg`. Prisma no sabe deserializar el tipo `regclass` → excepción. El `catch` la atrapa y devuelve lista vacía **sin cachear** (por diseño), así que la consulta rota se repite en cada mensaje entrante de cada tenant: un `prisma:error` y una transacción desperdiciada por turno. Efecto funcional: **el motor de Procedimientos está muerto en toda la plataforma** — un tenant puede crear y activar un procedimiento, el cliente escribe la keyword y no pasa nada, sin error visible. Arreglo de una línea: `to_regclass('procedures')::text`. El propio repo ya usa ese patrón en `prisma.service.ts:355`.

**ERROR B — sincronización oportunidad→deal que lanza en vez de canonicalizar. Nada que ver con el cobro.**
`pipeline.service.ts:1123` compara la etapa **cruda** de la oportunidad contra la etapa **canónica** resuelta y tira `ConflictException`. Tu tenant de turismo tiene el catálogo consulta/cotización/reserva/confirmado/…, y la oportunidad quedó con un slug genérico (`listo_para_cierre`) que resuelve por cercanía a `confirmado` → explota. El motor de auto-progreso sí sabe repararlo; este camino no. Lo atrapa un catch, así que no rompe el turno. Arreglo: canonicalizar antes de comparar, como ya hace `writeLeadStage`.

**ERROR C — `propertyId` inválido. Nada que ver con el cobro, y la parte visible es recuperable.**
El error del `checkPropertyAvailability` **sí vuelve al LLM**, que puede reintentar con el UUID correcto. Lo grave es el gemelo silencioso descrito en P1-6: el mismo validador dentro de `list_properties` está envuelto en un `catch` vacío que convierte cualquier fallo en "no hay disponibilidad".

**ERROR D — DM de Instagram descartado con 200 OK. Refutado: no lo toques.**
Es comportamiento deliberado y documentado en el propio archivo (`channels.controller.ts:475-482`): los descartes esperados se confirman para que el proveedor deje de reintentar; los fallos de infraestructura sí devuelven 500. Devolver 500 ante una cuenta no mapeada no salvaría el mensaje (reintentar da el mismo miss) y con fallas sostenidas Meta degrada la suscripción **de la app entera**, que es compartida por todos los tenants. El único hueco real es de observabilidad: solo queda un `warn`, sin contador para el Ops Center.

**Sobre el cobro y el handoff del log:** el handoff que ves es la consecuencia esperada de P0-1 + P1-1. La IA prometió instrucciones de pago y no pudo generar nada, así que escaló a un humano. Eso es el sistema fallando cerrado, no fallando mal — pero es el motivo por el que tu cuenta Wompi real todavía no cobró un peso por chat.

---

## 7. PARA DEJAR EL PROCESO LIMPIO

### Tanda 0 — Configuración manual tuya, hacela YA (antes de cualquier deploy)

1. **Andá al panel de Wompi y confirmá que la URL de eventos está pegada** y que corresponde al ambiente **producción**:
   `https://api.parallly-chat.cloud/api/v1/tenant-payments/webhook/wompi/{tenantId}/{callbackToken}` — copiala con el botón de copiar de la pantalla de Pagos, no la escribas a mano.
2. **Confirmá que pegaste el "secreto de eventos" y no el "secreto de integridad"** — Wompi tiene dos parecidos, el código no puede verificar cuál pusiste, y si te equivocaste el 100% de los eventos vuelve 401 en silencio (P1-5 + P0-2).
3. **Verificá que tu cuenta Wompi no tenga ya esa única URL de eventos ocupada** por otra integración (web, ERP). Si la tiene, hay que resolver eso antes de seguir.
4. **No dispares un purge de tenant** hasta que salga la Tanda 1 (te deja el tenant vallado 7 días).

### Tanda 1 — Deploy 1: desbloquear el cobro y el borrado (código)

| # | Arreglo | Archivo |
|---|---|---|
| 1 | Clasificar `tenant_payment_provider_configs` en el purge | `prisma.service.ts:6-19` |
| 2 | Agregar `prisma.service.spec.ts` a los specs del pipeline | `.github/workflows/deploy.yml` |
| 3 | Bajar `create_payment_link` a `A1` (o publicar las tools de identidad) | `tool-policy-registry.ts:174` |
| 4 | `to_regclass('procedures')::text` | `procedure-engine.service.ts:71` |
| 5 | Normalizar coma interna en el clasificador de confirmación | `tool-execution-control.service.ts:149` |
| 6 | Enmascarar el token del webhook en Sentry | `instrument.ts` |

Después de esta tanda **ya deberías poder generar un enlace de cobro por chat para un pedido/tour**.

### Tanda 2 — Deploy 2: rueda de auxilio del dinero (código)

| # | Arreglo |
|---|---|
| 7 | Portar la búsqueda de transacciones por referencia desde `billing/adapters/wompi.adapter.ts:519` al `TenantWompiClient` |
| 8 | Cron que barra intents `pending` sin `providerTransactionId` y los concilie |
| 9 | Heartbeat de "último evento Wompi recibido" + aviso ámbar en la UI cuando nunca llegó ninguno |
| 10 | 503 en vez de 401 mudo cuando el sobre existe pero no descifra, + contador que el Ops Center ya sabe leer (`billing:webhook:fail:wompi_tenant:*`) |
| 11 | Enlace vencido: devolver el existente si sigue activo; si está muerto, mover a `expired` |
| 12 | Endpoint tenant_admin de intents en `requires_review`/`ambiguous` con acción de resolver + listener de `tenant_payment.validation_failed` |

### Tanda 3 — Deploy 3: alquiler vacacional y saneamiento (código)

| # | Arreglo |
|---|---|
| 13 | Migración aditiva: `ALTER TABLE property_bookings ADD COLUMN IF NOT EXISTS payment_status` |
| 14 | Target `property` en el mapa + `payableReference` en `createPropertyBooking` / `listMyPropertyBookings` |
| 15 | Arreglar el `catch` vacío de `list_properties` (validar fechas una vez, no vaciar el catálogo) |
| 16 | Canonicalizar la etapa en `syncOpportunityToDeal` (ERROR B) |
| 17 | Píldora de ambiente (ámbar "PRUEBAS") + mapa `errorCode` → i18n en los 4 idiomas |
| 18 | Auditoría en `audit_logs` para cambios de credenciales de cobro |

### Configuración manual tuya en el futuro (no ahora)

- Si algún día querés separar la llave de cifrado de pagos (`TENANT_PAYMENT_CREDENTIAL_KEY`): **no uses el keyId `primary`**. Usá uno fechado (`payments-2026-08`) y registrá `ENCRYPTION_KEY` bajo `primary` en `TENANT_PAYMENT_CREDENTIAL_PREVIOUS_KEYS`. Y ojo: el rewrap hoy no tiene forma de ejecutarse, así que hay que shipear eso primero.

---

## 8. CÓMO VERIFICAR QUE QUEDÓ (prueba en producción)

**Aclaración honesta:** no tuve acceso a la base de producción ni a tráfico real de Wompi. Todo lo anterior está anclado en código leído. El contrato de `POST/GET /v1/payment_links` de Wompi es el único trozo que **nadie verificó nunca contra la API real** — el spec del cliente mockea la forma que el propio código asume. Esta prueba lo cierra empíricamente.

Hacela **después de la Tanda 1**, con un pedido real de monto chico (no un tour de $800.000; usá el mínimo que Wompi te acepte).

**Paso 1 — antes de tocar nada, dejá la evidencia lista.**
En el panel de Wompi, abrí el log de eventos/entregas. Ahí vas a ver si nuestros webhooks reciben 200 o 401. Es tu único diagnóstico hasta que salga la Tanda 2.

**Paso 2 — generá el enlace por el canal real.**
Desde WhatsApp, como cliente, sobre un pedido/tour real tuyo: pedí pagar. La IA tiene que devolverte una URL `https://checkout.wompi.co/l/...`. **Si no la devuelve, P0-1 no quedó arreglado — pará acá.**

**Paso 3 — confirmá explícitamente.**
Cuando pida confirmación, respondé `Sí, confirmo` (con la coma). Si el sistema vuelve a preguntar, el arreglo #5 no entró.

**Paso 4 — pagá de verdad.**
Tarjeta o Nequi reales. Confirmá en el panel de Wompi que la transacción figura **APPROVED** y que el monto en centavos coincide exactamente con el del pedido (esto valida la conversión ×100 de punta a punta).

**Paso 5 — el momento de la verdad: mirá el log de entregas de Wompi.**
Tiene que decir **200**. Si dice 401, el events secret está mal o la URL apunta al ambiente equivocado → volvé a la Tanda 0.

**Paso 6 — verificá la acreditación de los dos lados.**
- En el dashboard: el pedido/reserva tiene que figurar **pagado**.
- Directo en la base (con `psql` contra el schema del tenant), que es donde vive la verdad:
  ```sql
  SET search_path TO "<schema_del_tenant>";
  SELECT status, provider, provider_transaction_id, amount_cents, last_error
    FROM tenant_payment_intents ORDER BY created_at DESC LIMIT 1;
  ```
  Lo que querés ver: `status = 'paid'` **y** `provider_transaction_id` **no nulo**. Si `provider_transaction_id` está en NULL, el webhook nunca llegó y estás exactamente en P0-2, aunque el pedido se vea bien.

**Paso 7 — preguntale a la IA.**
Volvé al chat y escribí "¿ya entró mi pago?". Tiene que decir que sí. Si dice "el proveedor todavía no confirmó", el webhook no liquidó.

**Paso 8 — la prueba negativa (importante, y solo después de que la positiva pase).**
Pedí un enlace para otro pedido y **no lo pagues**. A las 24h, volvé a pedirlo por chat. Si el sistema te devuelve el enlace o emite uno nuevo, P1-3 quedó cerrado. Si tira error, ese pedido quedó incobrable y todavía te falta la Tanda 2.
---

## Anexo — los 35 hallazgos confirmados, con archivo:línea

_Auditoría del 2026-08-17 sobre el commit `007096cb`. 8 lentes en paralelo, 38 hallazgos brutos, cada uno sometido a un refutador adversarial independiente: 35 confirmados, 3 refutados. 47 agentes._
### 01. [P0] La tabla nueva de credenciales no está clasificada en el guard de purge: ningún tenant se puede borrar y la private key de Wompi queda para siempre

- **Dónde:** `apps/api/src/modules/prisma/prisma.service.ts:21`
- **Escenario de fallo:** El super_admin ejecuta el purge de cualquier tenant (DELETE de offboarding) o corre el cron `archiveCleaner` de las 4 AM (offboarding-cron.service.ts:432). `purgeTenant` llama `preflightTenantPublicPurge()` (offboarding.service.ts:1377) ANTES de cualquier efecto; ese preflight lista todas las tablas de `public` que tienen columna `tenant_id` y rechaza las que no estén clasificadas. `tenant_payment_provider_configs` tiene `tenant_id` (migración línea 8) y NO está en el set → 409 `tenant_purge_unclassified_public_data: ['tenant_payment_provider_configs']`. Hoy, en producción, el borrado de tenants está roto para TODOS los tenants, y el cron se lo traga en un `logger.error` por tenant (offboarding-cron.service.ts:435). Consecuencia sobre credenciales: un tenant que pide su borrado (GDPR) conserva su `prv_prod_...` y su events secret cifrados en la base indefinidamente, porque el único camino que los eliminaba (CASCADE al borrar la fila de `tenants`) nunca se ejecuta.
- **Evidencia:** const TENANT_PUBLIC_PURGE_ORDER = [
    'push_subscriptions', ... 'crm_connections', 'api_keys', 'audit_logs', 'users',
] as const;

const TENANT_PUBLIC_PURGE_CLASSIFIED = new Set<string>([
    ...TENANT_PUBLIC_PURGE_ORDER.filter((table) => table !== 'feature_request_subscribers'),
    'fiscal_invoices',
]);
// prisma.service.ts:343-350
const unclassified = rows.map(r => r.table_name).filter(t => !TENANT_PUBLIC_PURGE_CLASSIFIED.has(t));
if (unclassified.length > 0) throw new ConflictException({ error: 'tenant_purge_unclassified_public_data', tables: unclassified });
- **Arreglo:** Agregar `'tenant_payment_provider_configs'` a `TENANT_PUBLIC_PURGE_ORDER` (antes del borrado final de `tenants`, así el conteo aparece en el reporte de purge). Alternativa mínima: sumarla sólo a `TENANT_PUBLIC_PURGE_CLASSIFIED` apoyándose en el `ON DELETE CASCADE` del FK (migración líneas 16-18), pero la clasificación explícita en el ORDER es la que deja evidencia del borrado.
- **Veredicto del refutador:** CONFIRMADO, y el impacto está subestimado, no exagerado.

1) La cita es exacta y en contexto. `apps/api/src/modules/prisma/prisma.service.ts:6-19` define `TENANT_PUBLIC_PURGE_ORDER` sin `tenant_payment_provider_configs`, y `:21-24` construye `TENANT_PUBLIC_PURGE_CLASSIFIED` a partir de esa lista sumando solo `fiscal_invoices`. El preflight (`:335-352`) escanea `information_schema.columns WHERE table_schema='public' AND column_name='tenant_id'` y lanza `ConflictException tenant_purge_unclassified_public_data` para todo lo no clasificado.

2) La tabla vive en `public` y tiene `tenant_id`: `apps/api/prisma/migrations/20260816140000_isolate_tenant_payment_provider_config/migration.sql:7-8` (`CREATE TABLE "tenant_payment_provider_configs" ( "tenant_id" UUID NOT NULL, ...)`, sin calificar → public), y `apps/api/prisma/schema.prisma:85-98` la declara con `@@schema("public")` + `@@map("tenant_payment_provider_configs")`.

3) EJECUTÉ el guard propio del repo y está EN ROJO en HEAD: `npx jest src/modules/prisma/prisma.service.spec.ts -t "classifies every public table"` → FAIL, `Rejected to value: [ConflictException]` (spec línea 338/341). Reimplementé el escaneo del test por separado para aislar al culpable: `UNCLASSIFIED: [ 'tenant_payment_provider_configs' ]` — una sola tabla, exactamente la reclamada. El comentario del propio test (spec:272-286) documenta que este mismo patrón rompió el borrado de tenants en ago 2026 con billing_charge_attempts/billing_credit_ledger/billing_payment_sources, y advierte que la capa de migraciones no es red de seguridad porque el gate de PR nunca aplica migraciones.

4) Los llamadores son alcanzables: `offboarding.service.ts:1377` invoca el preflight dentro de `purgeTenant` (y de nuevo en `:1467`); `offboarding-cron.service.ts:432` llama `purgeTenant` desde el archiveCleaner de las 4 AM y se come el fallo en `logger.error` (`:435`).

5) No hay guarda aguas arriba que impida el escenario. No existe allowlist alternativa ni early-return; el `observed.has()` solo vive DENTRO de `purgeTenantPublicDataAtomic`, después del mismo rechazo (`:397-403`). El `ON DELETE CASCADE` de la FK (migration.sql:16-18) es irrelevante: el guard es por nombre y dispara antes de tocar la fila de `tenants`.

AGRAVANTE que el reportante no vio: `offboarding.service.ts:1372` publica la valla de hot-path `tenant:purging:{tenantId}` con TTL de 7 días CINCO LÍNEAS ANTES de que el preflight lance, y no hay liberación en el camino de fallo (los únicos `finally` liberan la valla de colas, `:1542-1554`, y el lock de Redis, `:1657-1661`). Cada intento bloqueado deja al tenant vallado una semana: `auth.service.ts:1716` y `tenants.service.ts:229` fallan cerrado contra esa clave, y `fiscal-invoice.service.ts:62` devuelve `null` en silencio → no se emite factura DIAN.

Severidad P0 sostenida: el borrado de tenants está roto para TODOS los tenants, la erasure GDPR no tiene camino funcional, la private key `prv_prod_*` y el events secret cifrados sobreviven indefinidamente, y el código pasó un gate que hoy mismo está rojo en el repo. Matiz honesto: no hay plata mal cobrada ni credencial filtrada en claro (siguen cifradas en reposo); es defecto de disponibilidad + cumplimiento + auto-sabotaje por la valla residual.

### 02. [P0] El polling de respaldo no puede arrancar solo: si el primer evento de Wompi no llega, el pago se cobra y jamás se acredita

- **Dónde:** `apps/api/src/modules/tenant-payments/tenant-payments.service.ts:1178`
- **Escenario de fallo:** El dueño (o cualquier tenant) pega el events_secret equivocado, o no pega la URL de eventos en el panel de Wompi — nada lo verifica: `webhookAcknowledgedAt` lo escribe el propio click de activar (tenant-payments.service.ts:626), no una entrega real. El cliente final paga 250.000 COP por Nequi. Wompi reintenta el evento, todos vuelven 401 (firma inválida) o nunca salen, y Wompi desiste. A partir de ahí NO hay camino de recuperación: `getPaymentStatus` solo consulta a Wompi si `intent.providerTransactionId` ya está seteado, y ese campo lo escriben únicamente los tres UPDATE dentro de `settleWompiTransaction` (tenant-payment-store.service.ts:539, 560, 606), a los que solo se llega desde el webhook (tenant-wompi-webhook.service.ts:73) o desde este mismo poll. `reconcileExpiredWompiIntent` (tenant-payments.service.ts:1424-1445) lee el LINK, no sus transacciones, y cuando lo ve inactivo escribe `requires_review` — nunca liquida. El módulo no registra ningún @Cron ni cola. Resultado: plata en la cuenta Wompi del tenant, pedido en `pending`→`requires_review` para siempre, el agente le dice al cliente que no consta el pago.
- **Evidencia:** if (intent?.provider === 'wompi'
    && intent.providerTransactionId
    && ['pending', 'failed'].includes(intent.status)) {  // ← solo si YA hubo un webhook
- **Arreglo:** Barrido periódico (o al consultar estado) que resuelva la transacción a partir del link cuando `providerTransactionId` es null, en vez de exigirlo como precondición; y un endpoint de operador 'conciliar con transaction_id' para cerrar el caso a mano. Además, `activateProvider` no debería marcar `webhookAcknowledgedAt` por auto-declaración: exigir un evento de prueba efectivamente recibido y verificado antes de dar el riel por listo.
- **Veredicto del refutador:** NO REFUTADO. Verifiqué cada eslabón de la cadena y todos se confirman en el código; no encontré guarda, llamador alternativo ni test que impida el escenario.

1) La línea citada dice literalmente lo que se afirma. `apps/api/src/modules/tenant-payments/tenant-payments.service.ts:1178-1180`:
```
if (intent?.provider === 'wompi'
    && intent.providerTransactionId
    && ['pending', 'failed'].includes(intent.status)) {
```
El poll a `getTransaction` (1188) está adentro de ese if. Sin `providerTransactionId` no se consulta nada al proveedor.

2) El bootstrap deadlock es real. Grep de `providerTransactionId|provider_transaction_id` sobre todo `apps/api/src`: los únicos writes están en `tenant-payment-store.service.ts:539, 560, 606` (rama Wompi de `settleWompiTransaction`) y 752/773/820 (rama MP), más los INSERT de 713/859 que viven dentro de esos mismos métodos. Grep de `settleWompiTransaction` (excluyendo specs) devuelve exactamente DOS llamadores: `tenant-wompi-webhook.service.ts:73` y `tenant-payments.service.ts:1206` (el propio poll). Circular confirmado: el poll necesita un id que solo el webhook puede sembrar.

3) No existe camino alternativo para obtener el id. `tenant-wompi.client.ts` solo expone `verifyMerchant`, `createAndVerifyPaymentLink`, `getAndValidatePaymentLink` (GET /payment_links/{id}, líneas 158-214) y `getTransaction` (GET /transactions/{id}, 216-261). NO hay lookup por link ni por referencia. Contraste revelador: el adapter de plataforma SÍ tiene ese primitivo — `billing/adapters/wompi.adapter.ts:519` usa `GET /transactions?reference=...` justo para recuperar transacciones huérfanas. La capacidad existe en el repo y no se llevó al riel del tenant. Además el link se crea SIN `redirect_url` (`tenant-wompi.client.ts:99-108`) y el controller (`tenant-payments.controller.ts`) no expone ninguna ruta de retorno/redirect: el cliente que paga nunca vuelve a nuestro backend.

4) `webhookAcknowledgedAt` es auto-declarado. `tenant-payments.service.ts:626` lo escribe dentro de `activateProvider`, o sea el click de "activar", no una entrega real. Y ese mismo campo es el que hace `ready: true` (línea 264) y `activeProvider` no-nulo (278-280). El sistema muestra "listo" con una URL de eventos que nadie probó nunca.

5) `reconcileExpiredWompiIntent` (1410-1450) confirma lo dicho: llama `getAndValidatePaymentLink` (1424) — el LINK, no sus transacciones — y si `!link.active` escribe `markCreationState(..., 'requires_review', 'wompi_inactive_link_requires_provider_evidence')` (1438-1444). Nunca liquida. El comentario 1434-1437 admite explícitamente que un APPROVED perdido queda sin resolver.

6) No hay barrido. `grep -rn "Cron|Queue|Interval" modules/tenant-payments/` → cero resultados. Y no hay superficie de recuperación manual: en el dashboard solo existen los 6 endpoints de config (`apps/dashboard/src/lib/api.ts:1413-1428`), ninguna pantalla de intents ni acción de conciliación; en el API no hay endpoint para liquidar un intent a mano.

7) Ningún test cubre esto. `tenant-payments.service.spec.ts` solo toca `getPaymentStatus` una vez (línea 524) y con un intent que ya viene `requires_review` desde el store; ningún caso ejerce "nunca llegó un webhook".

Un disparador que el refutador acepta como NO auto-sabotaje: `tenant-wompi-webhook.service.ts:81` lanza `ServiceUnavailableException` ante fallo de persistencia (correcto para que Wompi reintente), pero si la ventana de caída/deploy excede el presupuesto de reintentos de Wompi, el intent queda huérfano igual, con la configuración perfectamente correcta.

CORRECCIONES AL HALLAZGO (matices, no refutación):
- "el agente le dice al cliente que no consta el pago" es inexacto una vez vencido el link: `payment-operation.service.ts:758-776` mapea `requires_review` a `shouldHandoff: true` con el mensaje explícito "No afirmes que fue aprobado ni pidas otro pago". Es decir, el sistema NUNCA miente diciendo "pagado" ni pide un segundo cobro, y escala a un humano. Antes del vencimiento sí queda en `pending` sin handoff.
- El humano escalado no tiene herramienta para arreglarlo: puede ver el pago en el panel de Wompi y marcar el pedido a mano en el dominio, pero el ledger de intents queda trabado sin endpoint que lo cierre.

SEVERIDAD: mantengo P0. Plata real del cliente final entra a la cuenta Wompi del tenant y el pedido nunca se acredita, sin ningún camino automatizado de recuperación, sin cron, sin cola, sin alerta y sin endpoint manual. El factor decisivo es el silencio: nadie se entera. Y el disparador más probable — no pegar la URL de eventos en el panel de Wompi, o pegar un events_secret con un carácter mal (el regex de `tenant-wompi.client.ts:271-273` solo valida prefijo `prod_events_` + 12 chars, no el valor) — es exactamente el riesgo del día 1 de la cuenta real que el dueño acaba de configurar, mientras la UI le dice "activo y listo".

ARREGLO MÍNIMO SUGERIDO: portar el primitivo que ya existe en `billing/adapters/wompi.adapter.ts:519` al `TenantWompiClient` (búsqueda de transacciones por referencia/link) y llamarlo desde `reconcileExpiredWompiIntent` antes de escribir `requires_review`, más un cron de barrido de intents `pending` sin `providerTransactionId` pasados N minutos.

### 03. [P0] El cobro por IA es inalcanzable: exige verificación de identidad (A2) pero la herramienta para completarla sólo se publica con el toolset de seguros

- **Dónde:** `apps/api/src/modules/conversations/tool-execution-control.service.ts:802`
- **Escenario de fallo:** Tenant de alquiler vacacional (o cualquiera que no sea seguros) con tools.payments.enabled + canCreateLinks + Wompi activo. El cliente por WhatsApp pide pagar. El LLM llama create_payment_link. En preflight, la política de create_payment_link es assurance 'A2' (tool-policy-registry.ts:171-176) y ASSURANCE_LEVEL_MATRIX.A2.requiresStepUpIdentity === true (packages/shared/src/vertical-capability-manifest.ts:205-209), así que se ejecuta requireStepUpIdentity ANTES de cualquier confirmación. Dos desenlaces, ambos sin link: (a) el contacto no tiene email — el único canal fuera de banda vivo, porque el SMS está apagado en toda la plataforma (chat-identity.service.ts:146-155) — y startVerification devuelve 'no_channel' → resultado identity_unverifiable + shouldHandoff; (b) el contacto sí tiene email, se le manda un código de 6 dígitos, el cliente lo escribe en el chat… y el LLM NO tiene ninguna herramienta para entregarlo: request_identity_code / verify_identity_code sólo se agregan a la lista de tools cuando cfgTools.insurance.enabled === true (conversations.service.ts:1973-1974; declaradas en tools/insurance-tools.ts:104-110). paymentToolsForRuntime nunca las agrega (payment-tool-registration.ts:11-21). Como chat:verified:{conversationId} sólo lo escribe chatIdentity.verifyCode (chat-identity.service.ts:173), alcanzable únicamente por esa tool, isVerified nunca pasa a true y cada turno vuelve a caer en identity_verification_required: bucle infinito. Resultado: la IA anuncia "Para realizar el pago de tu reserva…" y el enlace NUNCA se genera, para ningún tenant que no tenga seguros habilitado. Es exactamente el síntoma de producción.
- **Evidencia:** tool-execution-control.service.ts:802-805 →
        if (assurance.requiresStepUpIdentity) {
            const identityGate = await this.requireStepUpIdentity(request);
            if (identityGate) return { allowed: false, result: identityGate };
        }

conversations.service.ts:1973-1974 →
        if (cfgTools?.insurance?.enabled === true) {
            tools = [...tools, ...INSURANCE_TOOLS];

tool-policy-registry.ts:171-182 → entry('create_payment_link', contactWrite({ ... assurance: 'A2', assuranceEnforcement: 'central_guard', ... }))
- **Arreglo:** Publicar el par de identidad junto con los tools de pago: en paymentToolsForRuntime, cuando se agrega CREATE_PAYMENT_LINK_TOOL, agregar también REQUEST_IDENTITY_CODE_TOOL y VERIFY_IDENTITY_CODE_TOOL (moverlas de tools/insurance-tools.ts a un módulo compartido para no arrastrar el resto del vertical). Y decidir explícitamente el nivel: si el checkout hospedado no debe exigir OTP fuera de banda (el link no mueve plata por sí solo y Wompi ya autentica al pagador), bajar create_payment_link a A1 en tool-policy-registry.ts:174 y dejar el central_guard + confirmación firmada como la barrera; si se mantiene A2, el flujo no puede depender de un canal (email) que la mayoría de los contactos de WhatsApp no tiene.
- **Veredicto del refutador:** Hallazgo CONFIRMADO tras intentar derribarlo por cuatro vías; ninguna prosperó.

1) La cita es literal y en contexto. apps/api/src/modules/conversations/tool-execution-control.service.ts:801-805 ejecuta `if (assurance.requiresStepUpIdentity) { const identityGate = await this.requireStepUpIdentity(request); if (identityGate) return { allowed: false, result: identityGate }; }` ANTES del early-return de lectura (`if (policy.effect === 'read')` está recién en :807) y antes de todo el bloque de ledger/confirmación. Una escritura como create_payment_link no puede saltearlo.

2) La política es la afirmada: tool-policy-registry.ts:171-182 declara create_payment_link con `assurance: 'A2', assuranceEnforcement: 'central_guard', confirmation: 'runtime_enforced'`, y packages/shared/src/vertical-capability-manifest.ts:206-212 define A2 con `requiresStepUpIdentity: true`. get_payment_status en cambio es A1 (tool-policy-registry.ts:185-189), así que solo la creación queda muerta.

3) La publicación de las tools de identidad está atada a seguros. conversations.service.ts:1973-1975 (`if (cfgTools?.insurance?.enabled === true) { tools = [...tools, ...INSURANCE_TOOLS]; }`) es el único sitio de runtime que las agrega; request_identity_code/verify_identity_code se definen únicamente en tools/insurance-tools.ts:104 y :109 (grep repo-wide: solo insurance-tools.ts, el switch del executor, el registry y specs). payment-tool-registration.ts:11-21 solo agrega PAYMENT_STATUS_TOOLS/PAYMENT_CREATE_TOOLS.

4) Busqué un bypass aguas arriba y no existe. ai-tool-executor.service.ts:161 llama a preflight para toda tool estática; para create_payment_link incluso corre preparePaymentLink antes (:141-160), o sea que llega a la compuerta con contacto y conversación válidos.

5) Busqué otra forma de marcar `chat:verified:{conversationId}`: chat-identity.service.ts:173 lo escribe solo dentro de verifyCode, y verifyCode tiene UN solo llamador en todo el repo — ai-tool-executor.service.ts:3322, alcanzable solo por el case 'verify_identity_code' (:482), que requiere que la tool esté publicada. No hay interceptor de mensajes que capture un código de 6 dígitos. Loop infinito confirmado.

6) Busqué si el impacto se exagera porque haya otra superficie que genere enlaces: NO la hay. paymentOperations.createPaymentLink (payment-operation.service.ts:306) tiene un único llamador, ai-tool-executor.service.ts:293. tenant-payments.controller.ts expone solo `GET :tenantId/config` (:25) y los dos webhooks (:114, :129) — ningún endpoint manual de creación de enlace. El camino IA es el único camino, así que el checkout tenant-owned entero queda en cero enlaces.

7) No hay test que lo cubra; los tests incluso enmascaran el problema. tool-execution-control.service.spec.ts:19 y :240 fijan `isVerified` en true por defecto, y el único caso negativo (:700-717) solo verifica el fail-closed 'identity_unverifiable'. ai-tool-executor.central-controls.spec.ts:177-193 asegura que la compuerta bloquea. Ninguno ejercita cómo un tenant sin seguros llega a verificar.

Matiz que refina (no refuta): la rama SMS de chat-identity.service.ts:150-163 está muerta por el kill switch de plataforma, así que un contacto sin email cae en 'no_channel' (identity_unverifiable + shouldHandoff) y uno CON email recibe el código y queda en el bucle permanente. Ambas ramas terminan sin enlace.

Severidad P0 sostenida: no requiere que el tenant_admin se sabotee — es el estado por defecto de todo tenant que no tenga el toolset de seguros encendido, y mata la única ruta que produce un enlace de cobro al cliente final, que es exactamente el síntoma reportado en producción tras configurar la cuenta Wompi real.

### 04. [P0] La tabla global nueva `tenant_payment_provider_configs` no está clasificada y bloquea el purge de TODOS los tenants

- **Dónde:** `apps/api/src/modules/prisma/prisma.service.ts:21`
- **Escenario de fallo:** El commit agrega un modelo público con columna `tenant_id` (schema.prisma:85-97, `@map("tenant_id")` + `@@map("tenant_payment_provider_configs")` + `@@schema("public")`), pero no lo agrega a `TENANT_PUBLIC_PURGE_ORDER`/`TENANT_PUBLIC_PURGE_CLASSIFIED`. `preflightTenantPublicPurge()` (línea 335-351) y `purgeTenantPublicDataAtomic()` (línea 389-403) enumeran TODA tabla de `public` que tenga columna `tenant_id` y lanzan `ConflictException{error:'tenant_purge_unclassified_public_data'}` ante cualquier tabla no clasificada. Desde que corre la migración `20260816140000`, CUALQUIER offboarding con borrado duro falla — no solo el del tenant que usa cobros: el de todos. Lo reproduje: `cd apps/api && npx jest src/modules/prisma/prisma.service.spec.ts -t "classifies every public table"` FALLA en HEAD (`Rejected to value: [ConflictException]`). Agravante: ese guard de deriva (prisma.service.spec.ts:338-342, escrito justo por el incidente de ago 2026 con billing_charge_attempts) NO está en la lista de specs que corre `.github/workflows/deploy.yml` (líneas 122-255 enumeran archivos uno por uno; prisma.service.spec.ts no figura), así que el gate de deploy nunca lo vio.
- **Evidencia:** const TENANT_PUBLIC_PURGE_ORDER = [
    'push_subscriptions', 'feature_request_subscribers', ...
    'sms_package_orders', 'sms_credit_ledger', 'sms_credit_balances',
    'crm_connections', 'api_keys', 'audit_logs', 'users',
] as const;

const TENANT_PUBLIC_PURGE_CLASSIFIED = new Set<string>([
    ...TENANT_PUBLIC_PURGE_ORDER.filter((table) => table !== 'feature_request_subscribers'),
    'fiscal_invoices',
]);
- **Arreglo:** Agregar `'tenant_payment_provider_configs'` a `TENANT_PUBLIC_PURGE_ORDER` (cualquier posición antes del `tx.tenant.delete()` final; el FK ya es ON DELETE CASCADE, pero el gate exige la clasificación explícita). Y agregar `apps/api/src/modules/prisma/prisma.service.spec.ts` a la lista de specs de deploy.yml para que el guard vuelva a proteger.
- **Veredicto del refutador:** CONFIRMADO, no refutado. (1) `apps/api/src/modules/prisma/prisma.service.ts:6-24` define `TENANT_PUBLIC_PURGE_ORDER`/`TENANT_PUBLIC_PURGE_CLASSIFIED` y `grep -rn tenant_payment_provider_configs` no devuelve NINGÚN hit en ese archivo: la cita es literal, no fuera de contexto. (2) La tabla es realmente pública y con columna `tenant_id`: `apps/api/prisma/migrations/20260816140000_isolate_tenant_payment_provider_config/migration.sql:7-15` (`CREATE TABLE "tenant_payment_provider_configs" ("tenant_id" UUID NOT NULL ... PRIMARY KEY ("tenant_id"))`, sin calificar → public) y `apps/api/prisma/schema.prisma:85-97` (`@map("tenant_id")` + `@@schema("public")`). (3) Busqué una guarda aguas arriba que hiciera imposible el escenario y NO existe: `preflightTenantPublicPurge()` (prisma.service.ts:335-350) enumera `information_schema.columns WHERE table_schema='public' AND column_name='tenant_id'` sin excluir tablas con FK ON DELETE CASCADE ni tenant_id como PK, y lanza ConflictException ante cualquier nombre fuera del Set; `purgeTenantPublicDataAtomic()` (:389-403) repite el mismo chequeo dentro de la transacción. El `ON DELETE CASCADE` del FK no salva nada porque el gate corre mucho antes del DELETE de `tenants`. (4) Reproduje el fallo: `npx jest src/modules/prisma/prisma.service.spec.ts -t "classifies every public table"` falla en HEAD (`Rejected to value: [ConflictException]`), y reimplementé por mi cuenta el descubrimiento de 3 fuentes del spec: 29 tablas públicas con tenant_id detectadas, `UNCLASSIFIED: ['tenant_payment_provider_configs']` — exactamente una, la de este commit. Nada preexistente contamina el resultado. (5) El escenario es alcanzable por dos caminos reales: `apps/api/src/modules/offboarding/offboarding.controller.ts:63-69` (DELETE :tenantId/purge, super_admin, SIN precondición de isActive) y `apps/api/src/modules/offboarding/offboarding-cron.service.ts:432` (cron 4AM que purga tenants inactivos >90 días); el cron traga el error en un `logger.error` (:433-435), así que las bajas por retención fallan en SILENCIO todas las noches para TODOS los tenants. (6) Agravante que el hallazgo original NO vio y que encontré intentando refutarlo: `apps/api/src/modules/offboarding/offboarding.service.ts:1372` publica el fence `tenantPurgingFenceKey(tenantId)` con TTL de 7 días ANTES de llamar al preflight en :1377, y el `finally` (:1580-1584) sólo libera el lock de Redis, nunca el fence. Entonces un super_admin que dispare el purge sobre un tenant VIVO recibe la ConflictException con el tenant ya cercado: login rechazado (auth.service.ts:1716), lifecycle bloqueado (tenants.service.ts:229) y emisión de factura fiscal devolviendo null en silencio (fiscal-invoice.service.ts:62) durante 7 días sobre un tenant que nunca se borró. (7) La parte del gate de deploy también es cierta: `grep -n "prisma.service.spec" .github/workflows/deploy.yml` no devuelve nada; la lista enumerada (líneas 126-185+) no lo incluye, así que el drift guard escrito por el incidente de ago 2026 (prisma.service.spec.ts:274-280, fix `65ec692a` "no se podía borrar ningún tenant desde el motor de cobros") nunca corrió en CI — es la misma regresión por segunda vez. No baja de P0: rompe a nivel plataforma una operación de ciclo de vida irreversible (y obligación de borrado de datos) y, por el fence no revertido, deja 7 días de caída colateral sobre un tenant vivo.

### 05. [P1] Fallo de descifrado = 401 mudo en el webhook de Wompi: un pago aprobado real nunca se concilia y no queda rastro

- **Dónde:** `apps/api/src/modules/tenant-payments/tenant-wompi-webhook.service.ts:31`
- **Escenario de fallo:** Si el sobre cifrado deja de abrirse (rotación de `ENCRYPTION_KEY`/`TENANT_PAYMENT_CREDENTIAL_KEY` sin la clave vieja en `PREVIOUS_KEYS`, restore de un backup anterior a la rotación, o `keyId` desconocido), `tryDecryptCredential` devuelve `undefined` sin loguear nada y `getWompiCredentials` devuelve `null`. El webhook responde 401 `invalid_wompi_callback_token`, idéntico a lo que respondería ante un atacante. Wompi reintenta unas pocas veces y desiste. El cliente final pagó, la plata está en la cuenta del tenant, pero la orden queda `pending`, el agente le dice al cliente que no figura pago, y en el panel sólo se ve "no conectado" (getConfig depende del mismo descifrado, líneas 216-233). No hay log, ni incidente en el Ops Center, ni diferencia observable entre "clave rota" y "llamador falso".
- **Evidencia:** // tenant-wompi-webhook.service.ts:30-31
const credentials = await this.tenantPayments.getWompiCredentials(tenantId, callbackToken);
if (!credentials) throw new UnauthorizedException('invalid_wompi_callback_token');

// tenant-payments.service.ts:1857-1867
private tryDecryptCredential(encrypted: string | undefined, context: ...): string | undefined {
    if (!encrypted) return undefined;
    try { return this.readCredential(encrypted, context).plaintext; }
    catch { return undefined; }
}
- **Arreglo:** Distinguir "no hay credencial" de "hay sobre pero no se puede abrir": que `getWompiCredentials` devuelva ese motivo (sin plaintext, sólo el `code` de `TenantPaymentCredentialCryptoError`), que el webhook responda 503 (reintentable por Wompi) en vez de 401 cuando existe `privateKeyEnc` pero falla el descifrado, y emitir un warn/incidente contable para el monitor de plataforma.
- **Veredicto del refutador:** CONFIRMADO. Las citas son literales y en contexto: `tenant-wompi-webhook.service.ts:30-31` es la primera guarda del webhook (`getWompiCredentials` → si null, 401 `invalid_wompi_callback_token`), y `tenant-payments.service.ts:1857-1867` es un `catch { return undefined }` sin logger. En `getWompiCredentials` (`tenant-payments.service.ts:775-801`) cualquier fallo de descifrado cae en `if (!privateKey || !eventsSecret || !expectedCallback) continue;` y termina en `return null` (801): por construcción una clave rota y un token falso son el MISMO resultado.

Busqué guardas aguas arriba que hicieran imposible el escenario y encontré lo contrario — las tres redes de seguridad son ciegas a la misma causa raíz:

1) El poll compensatorio NO existe para este caso. `getPaymentStatus` (`tenant-payments.service.ts:1178-1186`) sólo consulta a Wompi si `intent.providerTransactionId` está seteado, y `provider_transaction_id` se escribe ÚNICAMENTE dentro de `settleWompiTransaction` (`tenant-payment-store.service.ts:539,560,606`), es decir sólo desde un webhook (o un poll que ya conoce el id). Un intent cuya única notificación fue el webhook rechazado con 401 queda con esa columna NULL para siempre → el poll nunca corre, ni siquiera después de arreglar la clave. Encima el poll llama al mismo `getWompiCredentials` (1181) y si da null se saltea en silencio. No hay auto-reparación.

2) El Ops Center no lo ve. `platform-monitor.service.ts:694` lee `billing:webhook:fail:{provider}:{kind}:{day}` y el único escritor de esa clave es `modules/billing/webhook.controller.ts:170` (suscripciones de plataforma). `tenant-payments.controller.ts` (endpoint `POST webhook/wompi/:tenantId/:callbackToken`) no incrementa ningún contador ni loguea el 401. Sentry con `@sentry/nestjs` no captura HttpException 4xx.

3) El test lo consagra como comportamiento deseado: `tenant-wompi-webhook.service.spec.ts` mockea `getWompiCredentials` → null y afirma 401 bajo el título "rejects an invalid callback token". Ningún test distingue clave rota de llamador falso.

Además el disparador es MÁS alcanzable de lo que afirma el hallazgo. `getKeyring` (`tenant-payment-credential-crypto.service.ts:76-96`) usa `keyId` default `'primary'` y cae a `ENCRYPTION_KEY` si no hay `TENANT_PAYMENT_CREDENTIAL_KEY`; `deploy.yml:816-818` escribe `TENANT_PAYMENT_CREDENTIAL_KEY_ID=${...:-primary}` sólo cuando la clave dedicada existe. Entonces las credenciales selladas hoy con el fallback llevan keyId `primary`; el día que el dueño setee la clave dedicada (documentada como opcional en `docs/server-installation.md:467-469`), `keys.get('primary')` SÍ resuelve — a la clave nueva — así que ni siquiera entra por la rama `unknown_key_id`: falla la autenticación GCM y se traga el error. Y una rotación "bien hecha" ingenua (`PREVIOUS_KEYS={"primary":"<vieja>"}` dejando KEY_ID en default) dispara el throw de conflicto de líneas 89-91 en CADA lectura → el mismo 401 mudo. Es un cambio de un solo secreto por el dueño, con radio de explosión global a todos los tenants con Wompi, no un auto-sabotaje del tenant.

Matiz donde el hallazgo exagera (y por eso lo dejo en P1, no lo subo): sí hay dos rastros que no acreditó. La creación de nuevos links falla de forma semi-ruidosa — `tenant-payments.service.ts:971-978` marca el intent como fallido con razón `wompi_credentials_unavailable_before_submission` y lanza `wompi_not_configured` — y el panel pasa a desconectado (`getConfig`, líneas 213-231). O sea que la caída se termina notando, pero por una señal engañosa ("no configurado") y sólo si alguien mira. La ventana de plata perdida queda acotada a los links ya emitidos y todavía pagables en Wompi; para esos, la pérdida no la recupera ningún camino automático (ver punto 1). El pago existe en la cuenta del tenant, la orden queda `pending` y el agente le dice al cliente que no figura pago.

### 06. [P1] El webhook es el ÚNICO camino de liquidación: el poll de rescate es inalcanzable sin un webhook previo y no hay cron de reconciliación

- **Dónde:** `apps/api/src/modules/tenant-payments/tenant-payments.service.ts:1179`
- **Escenario de fallo:** El dueño pega mal la URL de Eventos en el panel de Wompi (o los 3 reintentos de Wompi caen durante un deploy / un pico de 503). El cliente paga, Wompi captura la plata y aprueba la transacción. En la plataforma el intent queda 'pending' con provider_transaction_id NULL para siempre: `getPaymentStatus` no puede pollear porque exige `intent.providerTransactionId`, y ese campo SOLO lo escribe `settleWompiTransaction`/`settleMercadoPagoPayment` (o sea, solo el webhook). El pedido nunca pasa a 'paid', no hay cron en el módulo (0 `@Cron` en tenant-payments/), y las firmas rechazadas no incrementan ningún contador que mire el Ops Center (`platform-monitor.service.ts:694` solo lee `billing:webhook:fail:*`, que es el billing de plataforma). Resultado: cobro real invisible, sin alerta.
- **Evidencia:** if (intent?.provider === 'wompi'
    && intent.providerTransactionId
    && ['pending', 'failed'].includes(intent.status)) {  // ← el poll exige un id que solo el webhook escribe

// tenant-payment-store.service.ts: los únicos writers de provider_transaction_id son
// las líneas 539, 560, 606 (settleWompiTransaction) y 752, 773, 820 (settleMercadoPago)
- **Arreglo:** Reconciliar desde el LINK, no desde la transacción: un cron que barra `tenant_payment_intents` con status='pending' y expires_at vencido llamando a Wompi por payment_link_id (o `getAndValidatePaymentLink` + listado de transacciones del link) y alimente `settleWompiTransaction` con source:'poll'. Además, contar los 401/503 del webhook de tenant en una clave Redis que `platform-monitor` ya sabe vigilar.
- **Veredicto del refutador:** NO REFUTADO. Leí el código y el mecanismo se sostiene línea por línea; solo matizo dos exageraciones del escenario.

1) La cita es literal y en contexto. `apps/api/src/modules/tenant-payments/tenant-payments.service.ts:1177-1180`: `let intent = await store.findLatestOwned(...)` seguido de `if (intent?.provider === 'wompi' && intent.providerTransactionId && ['pending','failed'].includes(intent.status))`. El poll de rescate (`getTransaction` + `settleWompiTransaction` con `source:'poll'`, líneas 1191-1207) está dentro de ese `if`, así que sin `providerTransactionId` no se ejecuta nada.

2) El bootstrap es circular, verificado. `grep provider_transaction_id` sobre `tenant-payment-store.service.ts` da como ÚNICOS writers las líneas 539, 560, 606 (dentro de `settleWompiTransaction`) y 752, 773, 820 (`settleMercadoPagoPayment`). `settleWompiTransaction` tiene exactamente dos llamadores: `tenant-wompi-webhook.service.ts:73` (webhook) y el propio poll de `tenant-payments.service.ts:1204`. O sea: el poll necesita un id que solo escribe el webhook o el propio poll. Sin webhook, el campo es NULL para siempre.

3) No hay camino alternativo en el cliente. `tenant-wompi.client.ts` expone solo `verifyMerchant` (:56), `createAndVerifyPaymentLink` (:83), `getAndValidatePaymentLink` (:158) y `getTransaction` (:216) — este último por transaction_id. NO existe consulta por `reference`/`payment_link_id`, que es lo único que permitiría descubrir la transacción sin webhook. Tampoco se manda `redirect_url` en el body del link (`tenant-wompi.client.ts:99-108`: name, description, single_use, collect_shipping, currency, amount_in_cents, sku, expires_at), así que no hay retorno del cliente que traiga el id.

4) No hay cron ni alerta. `grep "@Cron|Interval("` sobre todo `modules/tenant-payments/` → 0 resultados. `grep tenant_payment_intents` fuera del módulo → solo el DDL de `apps/api/prisma/tenant-schema.sql`; ningún worker/script lo lee. `platform-monitor.service.ts:694` efectivamente solo suma `billing:webhook:fail:{provider}:{kind}:{día}`, y esos contadores los escribe únicamente `billing/webhook.controller.ts:89,99,130` (`recordWebhookFailure`) — el webhook de tenant (`TenantWompiWebhookService`) lanza `UnauthorizedException` en firma/ambiente inválidos (:44, :40) sin incrementar ningún contador. `grep "requires_review|tenant_payment"` sobre `apps/dashboard/src` → 0 archivos: tampoco hay pantalla donde el dueño vea intents colgados. Y `tenant-payments.service.spec.ts` no cubre el poll (`grep poll|providerTransactionId` → 0).

5) El disparador no requiere sabotaje del tenant. Además de pegar mal la URL, el secreto que se pega es `eventsSecret` a mano (`tenant-payments.controller.ts:47`, UI `payments/page.tsx:373`) y Wompi expone dos secretos parecidos (eventos vs integridad); no hay forma de verificarlo contra la API, así que un secreto cambiado = 401 en el 100% de los eventos, callado y permanente. Y el propio webhook devuelve 503 a propósito ante fallos transitorios (`tenant-wompi-webhook.service.ts:66`, :80) esperando reintentos del proveedor: si esos reintentos se agotan durante un deploy, el evento se pierde sin ninguna red de recuperación.

MATICES QUE ACOTAN EL DAÑO (por eso no sube a P0):
- No hay doble cobro. El link es `single_use:true` y `createOrGetIntent` reusa el intent pendiente; al vencer, `reconcileExpiredWompiIntent` (:1410-1445) marca `requires_review` con `wompi_inactive_link_requires_provider_evidence` y `createPaymentLink` tira `payment_link_expiry_reconciliation_required` (:921) en vez de emitir un segundo link. El diseño es fail-closed.
- "Queda pending para siempre" es levemente exagerado: si el link vence Y alguien (cliente vía la tool `get_payment_status`, `ai-tool-executor.service.ts:302`) consulta, el intent sí pasa a `requires_review`. Pero eso depende de que un humano pregunte, y ningún cron/pantalla/alerta lee ese estado, así que la conclusión operativa del hallazgo no cambia.
- La plata no se pierde: queda en la cuenta Wompi del propio tenant. El daño real es divergencia de verdad (pedido/cita queda `payment_status='pending'`, la IA le dice al cliente que no le consta el pago) y cero detección para el dueño.

Severidad P1 confirmada: pago real capturado, plataforma ciega, sin cron, sin UI, sin alerta y sin endpoint del proveedor que permita recuperarlo automáticamente.

### 07. [P1] Un intent que llega a su vencimiento de 24h deja el pedido imposible de cobrar para siempre, sin escape operativo

- **Dónde:** `apps/api/src/modules/tenant-payments/tenant-payments.service.ts:921`
- **Escenario de fallo:** El cliente pide el link el lunes por chat y no paga. El miércoles dice 'mandámelo de nuevo'. `createOrGetIntent` devuelve el MISMO intent vencido (el índice único parcial `uidx_tenant_payment_intents_unresolved_reference` impide crear otro para esa canonical_reference), y `createPaymentLink` lanza 503 de forma INCONDICIONAL en la línea 921 — incluso cuando `reconcileExpiredWompiIntent` acaba de comprobar que el link sigue activo. Si el link ya estaba inactivo, el intent pasa a 'requires_review' y la siguiente llamada muere en la línea 926-931 con `payment_link_reconciliation_required`. No hay salida: `createOrGetIntent` solo reabre intents en 'failed' SIN provider ids (store:270-272) y este tiene provider_link_id; el estado 'expired' existe en el CHECK (store:90) pero NADIE lo escribe nunca; y no hay ningún endpoint en el controller ni método en el servicio que resuelva un intent. Ese pedido no se puede cobrar más por el canal, y el dueño no recibe ninguna señal de por qué.
- **Evidencia:** if (intent.provider === 'wompi') {
    await this.reconcileExpiredWompiIntent(input.tenantId, intent);
} else { await store.markCreationState(..., 'requires_review', ...); }
throw new ServiceUnavailableException({ error: 'payment_link_expiry_reconciliation_required' });
// ← se lanza aunque reconcileExpiredWompiIntent haya devuelto el intent intacto porque link.active === true
- **Arreglo:** Dos arreglos mínimos: (1) si `reconcileExpiredWompiIntent` confirma que el link sigue activo, devolver el checkout_url existente en vez de lanzar 503; (2) si el link está probadamente inactivo y no hay ninguna transacción asociada, transicionar el intent al estado terminal 'expired' (ya permitido por el CHECK y excluido del índice parcial) para que se pueda emitir uno nuevo. Sin eso hace falta al menos una acción de operador que libere la referencia.
- **Veredicto del refutador:** Verifiqué la cadena completa y el dead-end es real.

1) TTL 24h y expiresAt persistido: tenant-payments.service.ts:40 (`const TENANT_PAYMENT_LINK_TTL_MS = 24*60*60*1000`) y :887 (`const expiresAt = new Date(Date.now() + TENANT_PAYMENT_LINK_TTL_MS)`), pasado a createOrGetIntent.

2) El índice bloquea un intent nuevo: tenant-payment-store.service.ts:94-96 `uidx_tenant_payment_intents_unresolved_reference ON (canonical_reference) WHERE status IN ('pending','requires_review','ambiguous')`. El INSERT de createOrGetIntent (store:222-236) es `ON CONFLICT DO NOTHING`, así que cae al SELECT por canonical_reference (store:243-250) aunque el camino IA mande una idempotencyKey distinta cada vez (payment-operation.service.ts:363 `idempotencyKey: intent.id`, id de ledger nuevo por operación). El guard de mismatch (store:255-261) pasa: mismo contacto, monto y moneda.

3) No hay reapertura: store:266-292 sólo reabre `status === 'failed' && !providerLinkId && !providerTransactionId`. El intent vencido tiene provider_link_id, así que nunca reabre.

4) El throw de la línea 921 ES incondicional: service.ts:903-922 — el if/else elige entre reconcileExpiredWompiIntent y markCreationState, y el `throw new ServiceUnavailableException({error:'payment_link_expiry_reconciliation_required'})` está FUERA del else, en el mismo bloque. La cita del hallazgo es fiel al código.

5) reconcileExpiredWompiIntent no cambia nada en dos de tres salidas: service.ts:1433 `if (link.active) return intent;` y service.ts:1446-1449 (cualquier error de red/lookup → warn + `return intent`). En esos casos el estado sigue 'pending' con expires_at pasado y CADA llamada posterior repite exactamente el mismo camino → 503 para siempre. Si el link está inactivo, service.ts:1438-1445 escribe 'requires_review' y a partir de ahí muere en service.ts:926-931 (`!created` → 503 `payment_link_reconciliation_required`).

6) 'requires_review' es terminal de hecho: los UPDATE de liquidación excluyen ese estado explícitamente (store:614 y store:828: `$2='paid' AND status NOT IN ('paid','refunded','requires_review','ambiguous')`), y el único reparador, reconcilePaymentLinkCreation, exige `lastError === 'tenant_payment_link_attach_failed'` (service.ts:1128-1129) — nunca 'wompi_inactive_link_requires_provider_evidence'.

7) No hay escape operativo: el estado 'expired' está en el CHECK (store:90) y NADIE lo escribe (grep de `tenant_payment_intents` fuera del store: sólo specs). tenant-payments.controller.ts (leído completo) sólo expone config/active-provider/disconnect/webhooks: no hay endpoint de resolución. No hay cron que barra intents. Ningún spec cubre el reintento (el código `payment_link_expiry_reconciliation_required` aparece únicamente en el throw; los tests de vencimiento, tenant-payments.service.spec.ts:416 y :466, ejercitan reconcilePaymentLinkCreation, no createPaymentLink).

Escenario concreto confirmado: cliente pide link lunes por chat, no paga; miércoles pide de nuevo → createOrGetIntent devuelve el mismo intent pending vencido → 503 → el pedido `order:<uuid>` queda incobrable por el canal automatizado de forma permanente.

CORRECCIONES al hallazgo (achican el impacto, no lo anulan):
- "El dueño no recibe ninguna señal" es FALSO. El 503 no es 4xx → classifyProviderFailure lo marca `unknown` (tenant-mercadopago-operation.provider.ts:150-168) → payment-operation.service.ts:402-406 llama markReconciliationRequired, que escribe `status='reconciliation_required'` en payment_operation_ledger con la razón y devuelve `shouldHandoff: true` (payment-operation.service.ts:955-977), y conversations.service.ts:2296 lo convierte en handoff real al inbox humano. Lo que falta es el diagnóstico (el mensaje es genérico) y la herramienta para desbloquear, no la señal.
- El cliente NO queda sin poder pagar: canonical_reference es `kind:entityId` (tenant-payment-reference.ts:53-70), así que un pedido NUEVO cobra normal; lo que queda muerto es esa fila de orden concreta (y su payment_status queda 'pending' para siempre, ensuciando los registros del tenant).
- Un webhook DECLINED sí abre salida (store:615 permite pending→failed), y 'failed' sale del índice parcial permitiendo un intent nuevo. El dead-end verdadero es sólo el caso "nunca se tocó el link y venció", que es justamente el más común en venta por chat.

Severidad: mantengo P1. No hay plata mal cobrada ni credencial expuesta y existe escalada a humano y workaround (orden nueva / cobro fuera de la plataforma), pero es un camino de conversión roto de forma permanente e irrecuperable, disparado por el evento más frecuente del comercio conversacional (no pagar dentro de 24h y volver a pedir el link), y acumula filas trabadas sin ningún barrido.

### 08. [P1] Un enlace que vence sin pagarse deja la reserva/pedido imposible de cobrar para siempre, y no hay forma de destrabarlo desde el producto

- **Dónde:** `apps/api/src/modules/tenant-payments/tenant-payments.service.ts:907`
- **Escenario de fallo:** El cliente pide el link, no paga y vuelve al día siguiente. El intent se creó con expiresAt = ahora + 24h (TENANT_PAYMENT_LINK_TTL_MS, línea 40/887). En el nuevo intento, createOrGetIntent choca contra el índice único parcial uidx_tenant_payment_intents_unresolved_reference (tenant-payment-store.service.ts:88-90) y devuelve el intent viejo; como está pending y vencido, se entra a reconcileExpiredWompiIntent: si Wompi ya marcó el link inactivo se hace markCreationState(...,'requires_review',...) y siempre se lanza payment_link_expiry_reconciliation_required (línea 921). El estado 'requires_review' sigue dentro del conjunto del índice único, así que todo intento futuro cae en `if (!created || intent.status !== 'pending') throw payment_link_reconciliation_required` (líneas 926-931). No existe en toda la base de código ningún endpoint ni pantalla que devuelva un intent de requires_review/ambiguous a un estado cobrable (el propio comentario de findLatestOwned promete "an explicit operator resolution" que nunca se implementó). Resultado: cada checkout abandonado convierte ese pedido/reserva en incobrable de por vida — ni la IA ni el panel pueden emitir otro link; sólo un UPDATE a mano en producción.
- **Evidencia:** tenant-payments.service.ts:907-931 →
        if (intent.status === 'pending' && intent.expiresAt && intent.expiresAt.getTime() <= Date.now()) { ... throw new ServiceUnavailableException({ error: 'payment_link_expiry_reconciliation_required' }); }
        ...
        if (!created || intent.status !== 'pending') { throw new ServiceUnavailableException({ error: 'payment_link_reconciliation_required', status: intent.status }); }

tenant-payment-store.service.ts:88-90 →
    `CREATE UNIQUE INDEX IF NOT EXISTS uidx_tenant_payment_intents_unresolved_reference ON tenant_payment_intents (canonical_reference) WHERE status IN ('pending', 'requires_review', 'ambiguous')`
- **Arreglo:** Agregar la resolución de operador que el diseño ya asume: endpoint tenant_admin (guards AuthGuard('jwt')+RolesGuard+TenantGuard) que, tras releer el link con getAndValidatePaymentLink (allowInactive) y comprobar que no hay transacción aprobada asociada, mueva el intent a un terminal 'expired' — fuera del conjunto del índice parcial — liberando la referencia para un link nuevo; exponerlo en la pantalla de pagos con la lista de intents en requires_review/ambiguous.
- **Veredicto del refutador:** CONFIRMADO. Intenté derribarlo por cinco vías (guarda aguas arriba, cron/sweep, endpoint de operador, webhook que libere la referencia, test que lo cubra) y ninguna existe. Además el defecto es MÁS AMPLIO de lo que dice el hallazgo.

1) La cita es fiel y el mecanismo se sostiene.
- `tenant-payments.service.ts:887` fija `expiresAt = now + TENANT_PAYMENT_LINK_TTL_MS` (línea 40 = 24h).
- `tenant-payment-store.service.ts:94-96` crea el índice único parcial sobre `canonical_reference WHERE status IN ('pending','requires_review','ambiguous')`, y `createOrGetIntent` inserta con `ON CONFLICT DO NOTHING` (línea 229) y luego reusa la fila vieja (líneas 245-254). O sea: una clave de idempotencia NUEVA no crea intent nuevo mientras la referencia siga "sin resolver". Verifiqué que el llamador de IA manda clave nueva cada vez: `payment-operation.service.ts:363` pasa `idempotencyKey: intent.id` (id de ledger fresco por intento). El choque contra el índice es real, no teórico.
- Día 2: `tenant-payments.service.ts:907-909` matchea (pending + vencido) y **siempre** tira `payment_link_expiry_reconciliation_required` (línea 921, fuera del if/else). Si Wompi reporta el link inactivo, `reconcileExpiredWompiIntent` (1438-1445) escribe `requires_review`, que sigue dentro del conjunto del índice, y todo intento posterior muere en `if (!created || intent.status !== 'pending')` (926-931). Exacto como se afirma.

2) El defecto es peor que el reclamado: no hace falta llegar a requires_review. Si `reconcileExpiredWompiIntent` devuelve el intent sin tocar (líneas 1414/1422/1433/1448: sin credenciales de esa generación, Wompi caído, o el link todavía "active"), el intent queda `pending` y vencido para siempre, y la línea 921 vuelve a tirar en cada intento futuro. Nada en toda la base escribe jamás el estado `expired` que el CHECK permite (`tenant-payment-store.service.ts:90`): grepeé `expired` en el store y en los dos webhooks y solo aparece en el CHECK y en dos tipos `Exclude<...,'expired'>` (851, 888).

3) No hay salida por producto. Verificado:
- Sin cron/@Interval en todo `modules/tenant-payments/` (grep vacío).
- `tenant-payments.controller.ts` completo (142 líneas) solo expone config/active-provider/disconnect + los 2 webhooks. Ningún endpoint de resolución.
- Dashboard: `apps/dashboard/src/lib/api.ts:1413-1428` son las únicas llamadas a `/tenant-payments/*` — todas de credenciales. No hay pantalla de intents ni de emisión manual de links.
- Ningún script/migración toca `tenant_payment_intents` salvo el DDL (`prisma/tenant-schema.sql:231`). El comentario de `findLatestOwned` (`tenant-payment-store.service.ts:406-409`) promete "an explicit operator resolution" que efectivamente no existe.
- El webhook tampoco libera: un DECLINED deja el intent en `pending` a propósito (`tenant-payment-store.service.ts:575-588`), así que ni un intento fallido del cliente destraba nada; pasadas las 24h ese caso también queda muerto. Solo `paid`/`refunded` salen del conjunto.
- Los .spec.ts confirman el fail-closed por diseño (`tenant-payments.service.spec.ts:416`, `:466`) pero NINGÚN test cubre "emitir un link nuevo para la misma referencia después del vencimiento".

4) Lo único que matiza el impacto (y por eso no lo subo a P0): no se pierde ni se cobra plata de más, no se filtra credencial, no hay cruce entre tenants; el estado es fail-closed, no fail-open. Y la referencia canónica es el id de la fila de dominio (`tenant-payment-reference.ts:21-51`: orders / tour_bookings / food_orders / enrollments), así que el negocio puede crear un pedido/reserva NUEVO y cobrar ese — feo y con registros duplicados, pero no es literalmente "incobrable de por vida" el cliente, sí lo es ese pedido/reserva. También es cierto que un `failed` previo al efecto del proveedor sí se reabre (`tenant-payment-store.service.ts:270-295`), o sea que el fail-closed está bien acotado en ese caso; el hueco es específico del vencimiento con link ya creado.

Mantengo P1: el disparador es el evento más rutinario del comercio (checkout abandonado ~24h), el tenant del dueño ya está en producción con Wompi real, cada caso termina en handoff y la única remediación es un UPDATE a mano en la base de producción.

### 09. [P1] El 'webhook configurado' de Wompi es una autodeclaración, y sin webhook un pago aprobado nunca se detecta

- **Dónde:** `apps/api/src/modules/tenant-payments/tenant-payments.service.ts:1178`
- **Escenario de fallo:** El tenant guarda credenciales y toca Activar. activateProvider estampa webhookAcknowledgedAt con la sola pulsación, sin ninguna prueba de que la URL de eventos esté cargada en el panel de Wompi (línea 626); ese sello es justamente lo que hace ready === true (líneas 259-264) y por lo tanto lo que publica create_payment_link a la IA. Si la URL no quedó configurada (o Wompi deja de entregar), el cliente paga $150.000 COP, Wompi aprueba, y nadie se entera: provider_transaction_id sólo lo escribe settleWompiTransaction, y el polling de respaldo de getPaymentStatus está condicionado a que providerTransactionId YA exista (línea 1178-1180), cosa que únicamente ocurre por webhook. Resultado: get_payment_status devuelve paid:false para siempre, la IA le responde al cliente que pagó "El proveedor todavía no confirmó este pago", la reserva jamás pasa a payment_status='paid' y a las 24h el intent además queda trabado (ver hallazgo anterior).
- **Evidencia:** tenant-payments.service.ts:626 → if (provider === 'wompi' && stored.providers.wompi) { stored.providers.wompi.webhookAcknowledgedAt = new Date().toISOString(); }

tenant-payments.service.ts:1178-1180 →
        if (intent?.provider === 'wompi'
            && intent.providerTransactionId
            && ['pending', 'failed'].includes(intent.status)) {
- **Arreglo:** Cerrar el lazo de evidencia: (a) guardar en el intent/config un heartbeat del último evento Wompi recibido y alertar (Ops Center) si un link lleva >N minutos pending sin ningún evento del comercio; (b) agregar un reconciliador que, para intents pending con providerLinkId y sin providerTransactionId, consulte a Wompi las transacciones del link con la private key del tenant y liquide igual que el webhook — hoy no hay ningún camino de descubrimiento alternativo.
- **Veredicto del refutador:** CONFIRMADO. Verifiqué cada eslabón en el código y ninguno cae:

1) La cita es textual y en contexto. `apps/api/src/modules/tenant-payments/tenant-payments.service.ts:625-627` — dentro de `activateProvider`, `if (provider === 'wompi' && stored.providers.wompi) { stored.providers.wompi.webhookAcknowledgedAt = new Date().toISOString(); }`. La única guarda aguas arriba es `isStoredProviderActivationReady` (líneas 1732-1747), que exige publicKey + privateKeyEnc + eventsSecretEnc + webhookTokenEnc + environment + verifiedAt. Nada de eso prueba entrega de eventos: `verifiedAt` viene de `TenantWompiClient.verifyMerchant` (GET /merchants), y el `eventsSecret` no es verificable contra Wompi por diseño. O sea: el sello es 100% autodeclarado.

2) El sello es efectivamente lo que abre la llave del dinero: `ready` en `getConfig` (líneas 259-264) exige `!!wompi.webhookAcknowledgedAt`, e `isStoredProviderReady` (1712-1729) lo repite; `getRuntimeCapability` (677-691) devuelve ese mismo `ready` que publica la tool a la IA.

3) El fallback de polling no está sólo "condicionado": es estructuralmente inalcanzable. Grepeé TODOS los escritores de `provider_transaction_id` en `apps/api`: `tenant-payment-store.service.ts:539/560/606` (rama Wompi de `settleWompiTransaction`) y 752/773/820 (rama MP). `settleWompiTransaction` sólo tiene dos llamadores: `tenant-wompi-webhook.service.ts:73` y el propio poll de `tenant-payments.service.ts:1206`. Como el poll (1178-1180) exige `intent.providerTransactionId` ya presente, el único origen posible del id es el webhook. Sin webhook, el poll nunca puede arrancar — es un fallback que sólo funciona cuando ya no hace falta.

4) No hay red de contención: leí el controller completo (`tenant-payments.controller.ts`, 143 líneas) — no existe endpoint de reconciliación por referencia, ni "marcar pagado", ni redirect/callback del checkout que capture el `id` de transacción (Wompi lo devuelve en el redirect_url y el sistema ni siquiera lo configura: `createAndVerifyPaymentLink`, tenant-wompi.client.ts:99-108, no manda `redirect_url`). Tampoco hay `@Cron` en todo el módulo (grep sin resultados). `TenantWompiClient` no tiene búsqueda por referencia: sus únicos métodos remotos son verifyMerchant, createAndVerifyPaymentLink, getAndValidatePaymentLink y getTransaction(transactionId).

5) El escenario no requiere que el tenant se sabotee. La propia UI admite el caso: `apps/dashboard/messages/es.json:32` — "Wompi permite una URL de eventos por ambiente. Si tu cuenta ya usa otra integración, reemplazarla puede interrumpir sus notificaciones." Un comercio Wompi real que ya tenga su web/ERP ocupando el único slot de eventos deja al tenant con un either/or: confirma de buena fe el diálogo (`wompiActivationConfirm`) y aun así los eventos jamás llegan. Igual pasa si alguien cambia esa URL meses después: nada revalida ni alerta.

MATICES QUE ACOTAN EL IMPACTO (por los que NO subo a P0):
- No hay plata mal cobrada ni perdida para nadie: el pago entra a la cuenta Wompi del tenant, y el tenant lo ve en su panel. Lo que se rompe es la conciliación en nuestro lado.
- No hay doble cobro: `createOrGetIntent` (tenant-payment-store.service.ts:245-296) reutiliza el intent `pending` de la misma `canonical_reference`, y el link Wompi es `single_use: true` (tenant-wompi.client.ts:102). La IA reenvía el MISMO link, no genera un segundo cobro.
- El diseño autodeclarado es deliberado y está comentado (tenant-payments.service.ts:314-318) + hay `window.confirm` explícito en la UI (payments/page.tsx:152).

Aun así el defecto sostiene P1: la falla es silenciosa, permanente y afecta el 100% de los cobros de ese tenant (no una transacción), llega al cliente final que YA pagó ("El proveedor todavía no confirmó este pago como aprobado", payment-operation.service.ts:776), deja la orden/cita en payment_status='pending' para siempre, y el producto no ofrece ninguna vía de recuperación ni ninguna señal de "nunca recibí un evento de este tenant". El arreglo natural es hacer el poll alcanzable sin webhook (buscar por referencia/link o guardar el id vía redirect) o alertar cuando un intent Wompi lleva N minutos pending sin ningún attempt entrante.

### 10. [P1] Un pago que cae en `requires_review`/`ambiguous` deja el pedido incobrable para siempre y no existe ninguna superficie para resolverlo

- **Dónde:** `apps/api/src/modules/tenant-payments/tenant-payment-store.service.ts:94`
- **Escenario de fallo:** Escenario concreto (education, el más probable): el motor de referencias toma el monto del CATÁLOGO, no de una copia congelada — `enrollment` usa `amountExpression: 'course.price'` (tenant-payment-reference.ts:43-50). El tenant emite un link de pago por una matrícula de $800.000 y, antes de que llegue el webhook, edita el precio del curso a $850.000. Llega el `transaction.updated` APROBADO de Wompi: `settleWompiTransaction` compara `currentAmount !== intent.amountCents` → `validationError='payable_snapshot_changed'` (línea 496) → el intent pasa a `requires_review` y `enrollments.payment_status` QUEDA EN 'pending'. A partir de ahí: (a) el índice único parcial `uidx_tenant_payment_intents_unresolved_reference` incluye `requires_review`, así que todo INSERT nuevo para esa referencia hace CONFLICT; (b) `createOrGetIntent` solo reabre filas en estado `failed` (línea 270-272), no `requires_review`; (c) `createPaymentLink` tira `payment_link_reconciliation_required` para siempre (tenant-payments.service.ts:926-931); (d) `reconcilePaymentLinkCreation` solo repara `requires_review` cuando `lastError === 'tenant_payment_link_attach_failed'` (tenant-payments.service.ts:1128-1132); (e) `getPaymentStatus` solo repolls si el estado está en ['pending','failed'] (línea 1180). Resultado: la plata está cobrada en Wompi, la matrícula figura impaga y NO se puede volver a emitir un link. Y nadie se entera: `tenant_payment_attempts` no tiene ningún lector en todo el repo, el controller no expone ninguna ruta de revisión, no hay @Cron en el módulo, y los eventos `tenant_payment.validation_failed`/`succeeded`/`refunded` que emite tenant-wompi-webhook.service.ts:89-124 tienen CERO listeners (`grep -rn "OnEvent('tenant_payment"` → vacío). Solo queda SQL manual contra producción.
- **Evidencia:** `CREATE UNIQUE INDEX IF NOT EXISTS uidx_tenant_payment_intents_unresolved_reference
    ON tenant_payment_intents (canonical_reference)
    WHERE status IN ('pending', 'requires_review', 'ambiguous')`,

// tenant-payments.service.ts:926-931
if (!created || intent.status !== 'pending') {
    throw new ServiceUnavailableException({
        error: 'payment_link_reconciliation_required',
        status: intent.status,
    });
}
- **Arreglo:** Agregar una superficie de resolución: endpoint `GET/POST tenant-payments/:tenantId/intents` (tenant_admin + super_admin) que liste intents no resueltos junto con sus `tenant_payment_attempts`, y permita una transición explícita y auditada fuera del conjunto no resuelto (confirmar contra el proveedor, o marcar `expired`/`failed` liberando la referencia). Mientras tanto, como mínimo enganchar un listener a `tenant_payment.validation_failed` que levante incidente en el Ops Center.
- **Veredicto del refutador:** Verifiqué cada cita y todas son exactas (solo `payable_snapshot_changed` está en la línea 497, no 496). El mecanismo es real y cerrado por diseño: (1) `tenant-payment-store.service.ts:94-96` — el índice único parcial `uidx_tenant_payment_intents_unresolved_reference` incluye `requires_review` y `ambiguous`, por lo que la referencia canónica queda tomada; (2) `tenant-payment-store.service.ts:270-272` — `createOrGetIntent` solo reabre filas `failed` sin ids de proveedor, y el comentario del propio código declara "Ambiguous/review states and any row carrying a provider id remain permanently fail-closed"; (3) `tenant-payments.service.ts:926-931` — `createPaymentLink` lanza `payment_link_reconciliation_required` para siempre; (4) `tenant-payments.service.ts:1128-1132` — `reconcilePaymentLinkCreation` solo repara `requires_review` cuando `lastError === 'tenant_payment_link_attach_failed'`; (5) `tenant-payments.service.ts:1180` — el repoll solo corre en `['pending','failed']`.

El disparador es realista y no requiere sabotaje: `settleWompiTransaction` (`tenant-payment-store.service.ts:466-497`) valida contra el CATÁLOGO VIVO (`parsed.target.amountExpression`), no contra `resource_snapshot`; para `enrollment` eso es `course.price` (`tenant-payment-reference.ts:43-50`) y `education.service.ts:109` expone `price` como campo editable normal. Además `multiple_link_matches` / `unknown_payment_link` (líneas 440-455) producen `ambiguous` sin acción del tenant.

Ausencia de superficie de resolución CONFIRMADA empíricamente: el controller expone solo 8 rutas (config, config/:provider, active-provider, delete config, 2 webhooks) — ninguna de revisión; `grep @Cron` en el módulo → vacío; `grep OnEvent` sobre `tenant_payment.*` → vacío (los 9 `emit` de tenant-payments-webhook.service.ts y tenant-wompi-webhook.service.ts:89-124 no tienen oyentes); ningún archivo fuera del módulo lee `tenant_payment_intents`/`tenant_payment_attempts`; `apps/dashboard/src/lib/api.ts:1413-1428` solo tiene config/activate/disconnect.

Dos correcciones que AGRAVAN el hallazgo original: (a) el peor caso no es el APROBADO sino el DECLINADO con deriva — `validationError` se computa antes del mapeo de estado, así que un DECLINED con precio editado cae igual en `requires_review` (línea 511-513) y saltea la rama que deliberadamente mantiene el intent `pending` para que el cliente reintente el mismo link (líneas 566-577): ahí el pedido queda literalmente incobrable, sin plata cobrada y sin link posible nunca más; (b) para `orders` no hay reparación manual alguna — `orders.service.ts:433` solo escribe `status`, nunca `payment_status`, mientras que education al menos permite `paymentStatus` vía `education.service.ts:294`.

Una parte de la afirmación SÍ está exagerada: "nadie se entera" no es literal. `payment-operation.service.ts:758-765` devuelve `requiresReview` + `shouldHandoff: true` y `conversations.service.ts:2296` actúa sobre ese flag escalando a un agente humano. Pero eso depende de que el cliente pregunte, y el agente tampoco tiene acción para resolver el intent.

Fortaleza a reconocer: el diseño es fail-closed intencional (nunca marca pagado lo no verificado, `multiple_approved_transactions` en 505-510 evita doble fulfillment) y los specs cubren esas transiciones (`tenant-payment-store.service.spec.ts:173-210`). Ningún spec cubre la salida del estado trabado porque no existe.

Mantengo P1 y no subo a P0: requiere deriva para dispararse, no genera cobro erróneo ni fuga de credencial, y existe un camino parcial de escalamiento al agente.

### 11. [P1] El webhook se da por configurado con un click del usuario; no hay señal de "aún no recibimos ningún evento"

- **Dónde:** `apps/dashboard/src/app/admin/settings/integrations/payments/page.tsx:152`
- **Escenario de fallo:** El dueño pulsa "Usar con el agente", sale un window.confirm que le pregunta si ya pegó la URL en Wompi, y con un "Aceptar" el backend escribe `webhookAcknowledgedAt = new Date()` (tenant-payments.service.ts:626), lo que sube `ready` a true (259-264). Si en realidad no pegó la URL en el panel de Wompi (o la pegó en el comercio/ambiente equivocado), Parallly declara el proveedor "Listo" igual. Un cliente paga: el dinero entra a la cuenta Wompi del tenant, pero no llega ningún evento. El fallback de polling de `getPaymentStatus` sólo corre si `intent.providerTransactionId` ya existe (tenant-payments.service.ts:1178-1180) y ese campo únicamente lo escribe `settleWompiTransaction`, es decir el propio webhook (tenant-payment-store.service.ts:915). Al vencer el enlace, `reconcileExpiredWompiIntent` marca `requires_review` (1438-1445), nunca `paid`. El pedido queda colgado para siempre y el panel sigue en verde.
- **Evidencia:** if (provider === "wompi" && !window.confirm(t("wompiActivationConfirm"))) return;
- **Arreglo:** Guardar en la config del proveedor la marca del último evento Wompi recibido (el webhook ya calcula un eventKey por transacción) y exponerla en getConfig. En la UI: mientras `webhookAcknowledged === true` pero no haya ningún evento recibido, mostrar un aviso ámbar persistente ("Marcaste la URL como configurada pero todavía no recibimos ningún evento de Wompi") en vez de sólo píldoras verdes.
- **Veredicto del refutador:** CONFIRMADO. La línea citada es exacta y no está fuera de contexto: page.tsx:152 es literalmente `if (provider === "wompi" && !window.confirm(t("wompiActivationConfirm"))) return;`, y el string es pura auto-declaración ("¿Ya está configurada?", messages/es.json:18).

Cadena causal verificada: activateProvider escribe `webhookAcknowledgedAt = new Date().toISOString()` sin ninguna evidencia del proveedor (tenant-payments.service.ts:626); `ready` exige `&& !!wompi.webhookAcknowledgedAt` (tenant-payments.service.ts:259-264), así que el click ES lo que enciende el verde "Listo"/"Activo" (page.tsx:249-250, 265). `webhookAcknowledged` (:273) sale del mismo timestamp, por lo que nunca puede distinguir "el usuario hizo click" de "están llegando eventos" — no existe señal de liveness en ningún lado.

Intenté derribarlo por cuatro caminos de recuperación y los cuatro están cerrados en el código:
1) El polling está gateado por `intent.providerTransactionId` (tenant-payments.service.ts:1176-1178).
2) `settleWompiTransaction` tiene exactamente dos llamadores (tenant-wompi-webhook.service.ts:73 y el propio poll en :1206), así que sólo el webhook puede ORIGINAR ese id.
3) `createAndVerifyPaymentLink` NO manda `redirect_url` (tenant-wompi.client.ts:100-107) → no hay recuperación por redirect del navegador; el cliente tampoco tiene búsqueda por reference (sólo verifyMerchant, createAndVerifyPaymentLink, getAndValidatePaymentLink, getTransaction).
4) `getAndValidatePaymentLink` sólo devuelve metadata del link (sin transacción), por eso `reconcileExpiredWompiIntent` (:1438-1445) sólo puede marcar `requires_review`, con comentario que se niega explícitamente a fabricar estado terminal. No hay cron reconciliador en el módulo.

El Ops Center tampoco lo cubre: platform-monitor.service.ts:683-697 suma `billing:webhook:fail:*` escritos por el controller de billing de PLATAFORMA, y sólo cuenta webhooks que LLEGARON y fueron rechazados. Un webhook que nunca llega no escribe contador y se ve sano; el módulo health no menciona tenant_payment en ningún lado.

Dos correcciones al impacto reportado (por eso lo sostengo en P1 y no lo subo): (a) el pedido no queda totalmente desatendido — payment-operation.service.ts:758-775 pone `shouldHandoff: true` en requires_review e instruye no afirmar éxito NI pedir otro pago, así que no hay doble cobro y termina escalando a humano; el daño más filoso es la ventana pre-vencimiento, donde al cliente que YA pagó se le dice "El proveedor todavía no confirmó este pago" mientras la plata está en la cuenta Wompi del tenant. (b) En contra de bajarlo: no requiere autosabotaje. `wompiSingleWebhookWarning` (es.json:32) documenta que Wompi permite UNA URL de eventos por ambiente, así que un tenant que ya usa Wompi con otra integración estructuralmente NO puede pegar la URL sin romper la otra, y apretar "Aceptar" igual es el desenlace predecible; el ambiente equivocado (llaves sandbox + URL de producción) es el segundo camino honesto, advertido en el propio texto del confirm.

P1 correcto: no mueve plata mal ni filtra credenciales ni cruza tenants (eso lo mantiene bajo P0), pero un panel en verde que miente sobre una integración de cobro en producción, sin ninguna forma de detectarlo, es exactamente lo que el dueño necesita saber tras configurar su cuenta Wompi real.

### 12. [P1] Los pagos del alquiler vacacional NO tienen referencia pagable: la cuenta Wompi recién configurada no puede cobrar una reserva de propiedad

- **Dónde:** `apps/api/src/modules/tenant-payments/tenant-payment-reference.ts:13`
- **Escenario de fallo:** `PAYMENT_REFERENCE_TARGETS` sólo conoce cuatro objetos cobrables: `order`, `tour`, `food`, `enrollment`. `property_bookings` no está — aunque el propio sistema ya la trata como tabla de evidencia nativa de primera clase (prisma.service.ts:29). Consistente con eso, `createPropertyBooking` (ai-tool-executor.service.ts:2297-2312) devuelve la reserva SIN `payableReference`, mientras que tour (2432), food (2893) y enrollment (3131) sí lo emiten. Escenario concreto del tenant turismo/alquiler vacacional: el huésped confirma la estadía, `create_property_booking` crea la fila con `total_price` y `currency`, el huésped pide pagar → el modelo no tiene ninguna referencia que pasarle a `create_payment_link`. Si la inventa (`property:<uuid>`), `parsePaymentReference` devuelve null porque el kind no está en el mapa → `resolveCanonicalPayable` null → `payment_ownership_unverified` con `shouldHandoff:true` (payment-operation.service.ts:258-268). Si no llama a la tool, se limita a prometer instrucciones de pago en prosa. Las dos ramas terminan igual: cero enlaces creados y la conversación derivada a un humano — exactamente el par de síntomas del log (promesa de instrucciones + HUMAN HANDOFF). El dueño configuró Wompi real y para esta vertical no puede cobrar un solo peso por chat.
- **Evidencia:** export interface PaymentReferenceTarget { table: 'orders' | 'tour_bookings' | 'food_orders' | 'enrollments'; ... } export const PAYMENT_REFERENCE_TARGETS: Record<string, PaymentReferenceTarget> = { order: {...}, tour: {...}, food: {...}, enrollment: {...} };  // + ai-tool-executor.service.ts:2297 return { success: true, booking: { id: booking.id, ..., totalPrice: Number(booking.total_price || 0), currency: booking.currency, status: booking.status } }  // sin payableReference
- **Arreglo:** Agregar el target `property` en PAYMENT_REFERENCE_TARGETS ({ table: 'property_bookings', amountExpression: 'target.total_price', currencyExpression: 'target.currency', rejectedStatuses: ['cancelled','refunded'], description }) y emitir `payableReference: this.payableReference('property', booking.id, booking.payment_status, booking.status)` desde `createPropertyBooking` y `listMyPropertyBookings`, igual que ya hace la rama de tours. Sumar 'property' a la unión de tipos de `payableReference(kind)` en ai-tool-executor.service.ts:1173.
- **Veredicto del refutador:** CONFIRMADO en lo factual, DEGRADADO en severidad.

Verificaciones:
1) tenant-payment-reference.ts:13 dice literalmente `table: 'orders' | 'tour_bookings' | 'food_orders' | 'enrollments'` y PAYMENT_REFERENCE_TARGETS (:21-51) tiene solo esas 4 llaves; parsePaymentReference (:65-66) retorna null para cualquier otro kind. Cita exacta, no fuera de contexto.
2) ai-tool-executor.service.ts:1172-1173 tipa el helper como kind: 'order'|'tour'|'food'|'enrollment' — 'property' ni siquiera es expresable. createPropertyBooking (:2297-2312) retorna la reserva sin payableReference; tour (:2432), food (:2893), enrollment (:3131) sí la emiten; list_my_property_bookings (:3957 y ss.) tampoco.
3) No hay ruta alternativa: properties.service.ts:449-461 inserta SOLO en property_bookings (+ opportunity), nunca crea una fila en orders; y tenant-payments.controller.ts (archivo completo, 142 líneas) no expone ningún endpoint de enlace manual por monto libre — solo config/activar/desconectar/webhooks. El único camino de cobro al cliente final es la tool con referencia canónica.
4) La causa raíz es más profunda que el mapa: tenant-payments.service.ts:1265-1275 hace SELECT ... target.payment_status FROM ${parsed.target.table}. En tenant-schema.sql payment_status existe SOLO en orders (:456), tour_bookings (:2166), food_orders (:2428) y enrollments (:2654); property_bookings (:2042-2064) NO la tiene. Agregar 'property' al mapa reventaría la query — requiere migración + writeback de liquidación (tenant-payment-store.service.ts:461,658).
5) Confirmé además que las payment tools se registran por config del agente, no por vertical (payment-tool-registration.ts:15-19), así que a un tenant de alquiler vacacional con pagos activos SÍ se le anuncia create_payment_link sin que ninguna tool de su vertical pueda entregarle una referencia (vacation-rental-tools.ts:8-101, ninguna menciona payableReference).

No encontré guarda aguas arriba que impida el escenario, ni test que lo cubra, y el estado requerido (property_booking 'confirmed' con total_price y currency) lo produce el flujo normal.

POR QUÉ BAJO DE P0 A P1:
- El sistema falla CERRADO, no falla cobrando: payment-operation.service.ts:258-268 devuelve payment_ownership_unverified con shouldHandoff:true; resolveCanonicalPayable (:652-681) exige owned===true y estado pending/failed. No hay plata mal cobrada, ni cobro duplicado, ni credencial filtrada, ni fuga cross-tenant. El huésped cae en handoff humano, que es la degradación diseñada.
- El conjunto cubierto no es arbitrario ni un olvido puntual: coincide EXACTAMENTE con las tablas que modelan estado de pago. appointments, service_requests, photo_sessions y resource_rentals tampoco tienen payment_status ni entrada en el mapa. Es el alcance v1 del cobro (4 objetos pagables), no un bug de alquiler vacacional.
- Un tenant turismo que vende tours sí cobra por chat (tour:). Lo no cobrable es la estadía de propiedad. El impacto es capacidad comercial faltante en una vertical enviada, no dinero perdido ni movido mal.

Por eso: defecto real (refuted=false), severidad P1, no P0.

### 13. [P1] ERROR C — el error del propertyId sí vuelve al LLM (bien), pero el MISMO validador dentro de list_properties se traga y contesta "no hay disponibilidad"

- **Dónde:** `apps/api/src/modules/conversations/ai-tool-executor.service.ts:2076`
- **Escenario de fallo:** La parte recuperable está bien: `checkPropertyAvailability` devuelve `{ error: e.message }` (línea 2116) y ese objeto se serializa como mensaje `role:'tool'` de vuelta al modelo (conversations.service.ts:2323-2329), así que el LLM puede llamar `list_properties` y reintentar con el UUID correcto — el cliente final no ve una respuesta rota, sólo se gasta una de las 5 iteraciones (MAX_TOOL_ITERATIONS, conversations.service.ts:2161). El problema es el gemelo silencioso: dentro de `listProperties`, cuando el modelo pasa fechas, se llama `checkAvailability` por propiedad dentro de un `try { } catch { /* skip unavailable */ }`. Ese mismo validador que produjo el ERROR C lanza también por fecha mal formada (`validateStayRange` → `assertDateOnly`, properties.service.ts:36-46, exige YYYY-MM-DD exacto). El ERROR C prueba que el modelo pasa argumentos inválidos en producción; si pasa `checkIn: "12 de enero"` o `"2026-1-5"`, la excepción se repite para TODAS las propiedades, `properties` queda en `[]`, y el agente le dice al viajero que no hay nada disponible para esas fechas cuando en realidad está todo libre. Reserva perdida, y en el log sólo queda —en el mejor caso— un warn genérico. El catch exterior (2087-2090) agrava lo mismo: un fallo real de base devuelve `{ properties: [] }`, indistinguible de "el anfitrión no tiene propiedades".
- **Evidencia:** for (const prop of properties) { try { const avail = await this.propertiesService.checkAvailability(schema, prop.id, checkIn, checkOut); if (avail.available) { available.push({...}); } } catch { /* skip unavailable */ } } properties = available;  // y más abajo: } catch (e: any) { this.logger.warn(`[Tool] list_properties failed: ${e.message}`); return { properties: [] }; }
- **Arreglo:** Separar "no disponible" de "la llamada falló": validar el rango de fechas UNA vez antes del bucle y, si es inválido, devolver `{ error: 'invalid_dates', message: 'Usa fechas en formato YYYY-MM-DD' }` al LLM (que sí se autocorrige, como demuestra el ERROR C) en lugar de una lista vacía; dentro del bucle, distinguir la excepción de validación/infra de la respuesta legítima `available:false` y no vaciar el catálogo por un error transversal. Lo mismo en el catch exterior: devolver `{ error }` en vez de `{ properties: [] }`.
- **Veredicto del refutador:** CONFIRMADO leyendo el código. (1) ai-tool-executor.service.ts:2073-2084 tiene el bucle con `catch { /* skip unavailable */ }` textual, y el catch está VACÍO (ni un logger.warn). (2) properties.service.ts:193-197 (modulo vacation-rental, no la ruta que citó el reportante) muestra que `checkAvailability` arranca con `assertUuid` + `validateStayRange`; `validateStayRange` (55-66) llama `assertDateOnly` (36-46) que exige /^\d{4}-\d{2}-\d{2}$/ y lanza BadRequestException, y además lanza si `nights <= 0` (62-64). (3) El comentario "skip unavailable" es demostrablemente falso: una propiedad ocupada NO lanza, devuelve `{available:false}` (218-219). Lo único que ese catch puede tragar es error de validación o fallo de infraestructura — nunca el caso que dice manejar. Busqué guardas aguas arriba y NO existen: ai-tool-executor.service.ts:335 pasa `args.checkIn/args.checkOut` crudos del LLM sin normalizar; tool-policy-registry.ts:208 marca `list_properties` como publicRead y tool-execution-control.service.ts:807 (`if (policy.effect === 'read') return { allowed: true, policy }`) permite sin validar forma de argumentos; vacation-rental-tools.ts:12-19 sólo describe "YYYY-MM-DD" en prosa, sin `required` ni format. El único paliativo es prompt-assembler.service.ts:480-505, que inyecta `upcomingDays` en formato en-CA (YYYY-MM-DD) pero SÓLO 8 días: una consulta a diciembre queda fuera y el modelo compone la fecha solo. No hay ningún test: grep de list_properties/listProperties en *.spec.ts de conversations/ da 0 resultados (properties.service.spec.ts cubre el servicio, no este swallow). ACOTO al reportante en dos puntos: (a) no hay "warn genérico" en el catch interno, no hay log de ninguna clase — es peor de lo que describió; (b) apoyó el escenario en fechas mal formadas heredadas del ERROR C ("12 de enero"), que es el disparador menos probable dado el hint de formato. Los disparadores fuertes no requieren que el modelo escriba mal una fecha: checkIn === checkOut (huésped pidiendo una sola noche o "solo el sábado") dispara `nights <= 0` en TODAS las propiedades → `properties: []` → el agente dice "no hay disponibilidad" con todo libre; y el catch exterior (2087-2090) convierte cualquier fallo de base o una tabla `properties` no bootstrapeada en `{ properties: [] }`, indistinguible de "el anfitrión no tiene propiedades" — eso es determinista, no probabilístico. Mantengo P1: no es plata mal cobrada ni credencial filtrada, pero es una respuesta falsa al cliente final con reserva perdida y cero observabilidad en el camino más probable.

### 14. [P2] La rotación de clave no tiene ejecutor: `rewrapProviderCredentials` no se llama desde ningún lado y los lectores ignoran `needsRewrap`

- **Dónde:** `apps/api/src/modules/tenant-payments/tenant-payments.service.ts:566`
- **Escenario de fallo:** El keyring soporta rotación (`TENANT_PAYMENT_CREDENTIAL_KEY_ID` + `PREVIOUS_KEYS`, documentado en docs/server-installation.md:127-128), pero nada re-cifra nunca: `rewrapProviderCredentials` sólo aparece en su definición y en el .spec (sin controller, sin cron, sin script), y `readCredential`/`tryDecryptCredential`/`decryptExistingCredential` descartan el `needsRewrap: true` que el servicio de cripto exige atender "inmediatamente". Escenario: el dueño rota la clave (por ejemplo tras una fuga del .env), pone la vieja en `PREVIOUS_KEYS` y todo sigue funcionando; meses después retira la clave vieja —que es el punto de rotar— y en ese instante TODOS los sobres, que siguen escritos con el `keyId` viejo, dejan de abrirse: `tenant_payment_crypto_unknown_key_id` → cobros caídos y webhooks en 401 mudo (hallazgo anterior). Efecto adicional: los sobres legacy `iv:tag:ct` de MercadoPago previos a 546f1c09 (sin AAD, o sea SIN atadura al tenant) nunca migran a v2, así que la protección anti-copia entre tenants no llega a ellos.
- **Evidencia:** // crypto service:163-166 — el contrato que nadie cumple
// "Callers must immediately persist encrypt(result.plaintext, context) when needsRewrap is true."

// tenant-payments.service.ts:1857-1867 y 1846-1855: ambos toman .plaintext y tiran el resto
return this.readCredential(encrypted, context).plaintext;

// grep de rewrapProviderCredentials en todo el repo: sólo la definición (línea 566) y 4 usos en el .spec
- **Arreglo:** Exponer el rewrap como operación real: endpoint super_admin (o script `infra/scripts` iterando tenants) que corra `rewrapProviderCredentials` para ambos proveedores tras cambiar `TENANT_PAYMENT_CREDENTIAL_KEY_ID`, y/o persistir el sobre nuevo cuando `read(...).needsRewrap` sea true en el camino de lectura. Además documentar en el runbook que la clave vieja no se retira hasta que el rewrap reporte 0 sobres con el keyId anterior.
- **Veredicto del refutador:** REAL pero sobredimensionado: baja de P1 a P2.

LO QUE SE CONFIRMA (leído en código):
1. `rewrapProviderCredentials` (tenant-payments.service.ts:566) no tiene ningún llamador. Grep repo-wide: solo la definición, el build en dist/ y 4 usos en el .spec. El controller expone 8 rutas (`@Get :tenantId/config`, `@Put :tenantId/config`, `@Put :tenantId/config/:provider`, `@Put :tenantId/active-provider`, `@Delete` x2, `@Post webhook/:tenantId`, `@Post webhook/wompi/:tenantId/:callbackToken`) y ninguna es rewrap. No hay script en apps/api/scripts/ ni infra/scripts/ ni cron.
2. Los lectores SÍ tiran `needsRewrap`: `decryptExistingCredential:1851` y `tryDecryptCredential:1863` hacen `return this.readCredential(...).plaintext`. El contrato en tenant-payment-credential-crypto.service.ts:159-163 dice literalmente que el llamador debe persistir de inmediato, y :151 setea `needsRewrap: parsed.keyId !== currentKeyId`.
3. Los sobres legacy MP sin AAD sí pueden existir: el módulo es ANTERIOR a 546f1c09 — primer commit `6f76dc9c feat(D3): el tenant ya puede cobrarle a SU cliente — token propio, cifrado`.

LO QUE EL HALLAZGO ERRA U OMITE (por esto baja la severidad):
A. No es un ejecutor olvidado: las líneas 558-565 lo declaran por escrito — "Explicit one-tenant migration primitive. It is intentionally not wired to a controller or cron." Es decisión de diseño, no descuido.
B. FALSO que los sobres nunca migren. El camino de guardado normal ya reenvuelve: `setConfig` re-cifra CADA campo con `encryptCredential` (que siempre usa el keyId vigente) en todo guardado — MP en 436-447, Wompi en 508-519 — y la rama MASK (465-480, 494-499) descifra el sobre viejo (acepta PREVIOUS_KEYS o legacy) y lo reescribe v2/actual. Cualquier tenant que toque Configuración → Pagos → Guardar se auto-migra, incluidos los legacy de MP. La afirmación "nunca migran a v2" es incorrecta.
C. El escenario está DORMIDO por defecto: `TENANT_PAYMENT_CREDENTIAL_KEY` es opcional y está comentada (docs/server-installation.md:127). Sin setear, getKeyring usa `KEY_ID || 'primary'` + ENCRYPTION_KEY, así que `parsed.keyId === currentKeyId` siempre y `needsRewrap` nunca es true.
D. El disparo exige violar una advertencia escrita: docs/server-installation.md:469 dice "retirar sólo después del rewrap". Es auto-sabotaje del dueño contra instrucción documentada.
E. El impacto es FAIL-CLOSED, no plata mal cobrada: `tryDecryptCredential` devuelve undefined → `continue` en la línea 790 → `getWompiCredentials` retorna null (801). Se corta el cobro; nunca se cobra un monto equivocado ni con credencial ajena.

RESIDUO GENUINO (por lo que NO lo refuto): el doc ordena "rewrap antes de retirar la clave vieja" pero no existe ningún camino ejecutable para cumplirlo — ni endpoint, ni script, ni cron. Un dueño diligente que siga el procedimiento llega a un callejón sin salida, y si retira la clave igual, todos los sobres con keyId viejo caen en `tenant_payment_crypto_unknown_key_id` → cobros del tenant a sus clientes caídos y webhooks sin verificar. Además el degradé de defensa en profundidad de los legacy MP (sin AAD, sin atadura al tenant) persiste hasta el próximo guardado.

P2 y no P1: requiere optar por el keyring opcional + rotar + desobedecer la advertencia; es latente, autoinfligido, se cura solo con un guardado, y falla cerrado sin mover plata mal.

### 15. [P2] `disconnect` nunca borra el secreto y el procedimiento que decide cuándo es seguro borrarlo está construido pero sin llamadores

- **Dónde:** `apps/api/src/modules/tenant-payments/tenant-payments.service.ts:663`
- **Escenario de fallo:** El dueño conecta la cuenta REAL de Wompi de producción, se equivoca de cuenta (o corta la relación) y aprieta "Desconectar". La UI dice desconectado y se bloquea la creación de links, pero `privateKeyEnc`, `eventsSecretEnc` y `webhookTokenEnc` siguen en `tenant_payment_provider_configs` para siempre — y además se acumula una copia por cada rotación en `history[]` (hasta 16 generaciones, MAX_PROVIDER_CREDENTIAL_HISTORY). No existe ningún endpoint, cron ni script que los borre, y con el P0 de arriba ni siquiera el purge del tenant los elimina. La retención perpetua está justificada mientras haya evidencia de pago viva, pero el módulo YA tiene el procedimiento que decide eso (`hasCredentialBoundHistoryForProvider`) y no lo invoca nadie. Si algún día se filtra `ENCRYPTION_KEY` (vive en el .env del VPS y en GitHub Secrets), se recuperan private keys de producción de comercios que dejaron de usar el producto hace meses.
- **Evidencia:** // tenant-payments.service.ts:656-664 (disconnectProvider)
const config = stored.providers[provider];
if (config) {
    // Do not erase verification authority: an already-paid intent may receive a late VOIDED/refund/chargeback event.
    config.disabledAt = new Date().toISOString();
}

// tenant-payment-store.service.ts:188-208 — decisión construida, cero llamadores en producción
async hasCredentialBoundHistoryForProvider(tenantId: string, provider: TenantPaymentProvider): Promise<boolean>
- **Arreglo:** Cablear la decisión que ya existe: en `disconnectProvider` (y/o en un barrido diario) llamar `hasCredentialBoundHistoryForProvider(tenantId, provider)` y, cuando devuelve false, poner en `undefined` los campos `*Enc` de la generación actual Y de `history[]`, conservando la lápida (`disabledAt`) y la identidad no secreta (publicKey, merchantName, accountId) para la trazabilidad.
- **Veredicto del refutador:** Ambas afirmaciones centrales resisten la lectura del código.

1) La cita es fiel. `tenant-payments.service.ts:656-664` (`disconnectProvider`) solo escribe `config.disabledAt`; ningún campo `*Enc` se limpia. El `disconnect()` legacy en `:636-649` hace lo mismo para ambos proveedores. No hay endpoint, cron ni script que borre esos secretos después.

2) `hasCredentialBoundHistoryForProvider` es código muerto real. Grep en todo el repo devuelve únicamente la definición (`tenant-payment-store.service.ts:188`) y líneas de mock/aserción en `tenant-payments.service.spec.ts` y `tenant-payment-store.service.spec.ts`. Grep de `this.store.` dentro del servicio muestra solo tres usos productivos: `isAvailable` (`:684`), `findByIdempotencyKey` (`:1084`), `findByProviderLink` (`:1153`). Su hermano `hasUnresolvedForProvider` (`tenant-payment-store.service.ts:162`) también está sin llamadores.

3) La retención es deliberada y está fijada por test: `tenant-payments.service.spec.ts:577-624` verifica que `eventsSecretEnc` queda idéntico tras desconectar (`:607`) y que `hasCredentialBoundHistoryForProvider` NO se invoca (`:608`). No es un descuido de `disconnect`: es el tombstone intencional. El propio hallazgo lo concede.

No pude construir ninguna guarda aguas arriba que impida el escenario, ni un estado que el sistema no produzca: el tenant_admin aprieta Desconectar y los tres envelopes quedan en `tenant_payment_provider_configs` sin ruta de borrado.

DOS CORRECCIONES al encuadre del hallazgo:

- El tope de historial no es un techo silencioso sino un freno duro. `nextWompiHistory` (`tenant-payments.service.ts:1701-1706`) lanza `ConflictException {error:'payment_provider_credential_history_limit'}` al llegar a `MAX_PROVIDER_CREDENTIAL_HISTORY` (`:39`). Un tenant que rota 16 veces ya no puede rotar más. El hallazgo acierta el techo pero describe mal el comportamiento.

- "Ni siquiera el purge del tenant los elimina" está mal atribuido. `tenant_payment_provider_configs` tiene columna `tenant_id` y NO está en `TENANT_PUBLIC_PURGE_CLASSIFIED` (`prisma.service.ts:6-24`), así que `preflightTenantPublicPurge` (`:335-351`) lanza `tenant_purge_unclassified_public_data` y bloquea el purge COMPLETO de todos los tenants — eso es el P0 separado, no que esta tabla se saltee en silencio. Además la FK es `ON DELETE CASCADE` (`migrations/20260816140000_isolate_tenant_payment_provider_config/migration.sql:16-18`), o sea que apenas se clasifique la tabla el borrado del tenant se lleva la fila sola.

SEVERIDAD: se sostiene en P2, no sube. No hay plata mal cobrada, ni pago perdido, ni tenant viendo datos de otro. El daño exige un compromiso independiente de `ENCRYPTION_KEY`, y si esa clave se filtra también se filtran las credenciales ACTIVAS de todos los tenants vivos — bastante peor que la llave rancia de un comercio que se fue. Borrar los tombstones reduce el radio de explosión al margen: es minimización de datos + código muerto, no un defecto explotable. Confirmo el hallazgo como higiene de retención con una decisión construida y no cableada, en P2.

### 16. [P2] Un super_admin reemplaza o borra las credenciales de cobro de cualquier tenant sin impersonación y sin una sola línea de auditoría

- **Dónde:** `apps/api/src/modules/tenant-payments/tenant-payments.controller.ts:36`
- **Escenario de fallo:** `RolesGuard` deja pasar a super_admin ante cualquier `@Roles` (roles.guard.ts:26-28) y `TenantGuard` acepta cualquier `:tenantId` de la ruta para super_admin (tenant.guard.ts:25-37). Con eso, un token de super_admin (propio o robado) hace `PUT /tenant-payments/{tenantId-ajeno}/config/wompi` con SUS llaves `pub_prod_/prv_prod_` y luego `PUT /active-provider`: desde ese momento cada link que genera la IA para los clientes de ese tenant cobra hacia el comercio del atacante. `setConfig`/`disconnect` no escriben nada en `audit_logs` (revisé el camino completo, líneas 296-675), así que no queda actor, ni motivo, ni ticket; el tenant sólo vería un `merchantName` distinto dentro de la página de integraciones. Contradice el modelo de docs/superadmin-governance.md, donde actuar sobre un tenant exige impersonación con motivo y auditoría atribuida al super_admin real.
- **Evidencia:** // tenant-payments.controller.ts:35-38 (idéntico en :57, :71, :84, :94)
@Put(':tenantId/config')
@UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)
@Roles('tenant_admin')

// roles.guard.ts:26-28
if (user.role === 'super_admin') { return true; }
// tenant.guard.ts:25-37 — super_admin toma el tenantId de la ruta sin más
- **Arreglo:** En las mutaciones de credenciales (`setConfig`, `activateProvider`, `disconnect*`) exigir que un super_admin venga impersonando (`request.user.impersonatedBy` presente) o rechazar directo, y escribir `audit_logs` (`tenant_payments.credentials_replaced` / `.disconnected`) con el actor real vía `common/utils/audit-actor.util.ts`, más aviso por email al tenant_admin cuando cambia el comercio receptor.
- **Veredicto del refutador:** NO SE PUEDE REFUTAR: leí el camino completo y el escenario es ejecutable. Correcciones de matiz al final.

**1. Las citas son literales y en contexto.**
- `tenant-payments.controller.ts:35-38` dice exactamente `@Put(':tenantId/config')` + `@UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)` + `@Roles('tenant_admin')`. Idéntico en :57 (`config/:provider`), :71 (`active-provider`), :84 y :94 (deletes). El comentario de :21-24 ("sólo el dueño... tenant_admin") describe una intención que el guard no cumple.
- `roles.guard.ts:26-28`: `if (user.role === 'super_admin') { return true; }` — bypass incondicional de cualquier `@Roles`.
- `tenant.guard.ts:25-37`: para super_admin toma `request.params.tenantId` tal cual, sólo valida formato UUID (`isValidUuid`, línea 29) y setea `request.tenantId`. No exige impersonación, ni membresía, ni motivo.

**2. Busqué aguas arriba una guarda que lo impida. No existe.**
- `app.module.ts:117`: el único `APP_INTERCEPTOR` global es `SubscriptionEnforcementInterceptor`. No hay `APP_GUARD` global ni interceptor de auditoría.
- No hay `ImpersonationGuard` en `apps/api/src/common/` (grep de `impersonat` sólo devuelve `audit-actor.util.ts`, que es un helper *opcional* que el controller debe llamar — y no llama).
- El único control adicional del servicio es `assertCustomerPaymentsEntitled` (`tenant-payments.service.ts:1996-2022`): mira `tenant.isActive`, el estado de suscripción y el feature `customerPayments` del plan **del tenant víctima**. Nunca mira quién es el actor. Peor: `disconnect` (:636) y `disconnectProvider` (:651) ni siquiera lo llaman, así que el borrado de credenciales funciona incluso sin entitlement.
- Los métodos del servicio reciben sólo `tenantId` — no hay forma de auditar al actor porque el actor nunca llega.

**3. Ausencia de auditoría confirmada por grep.** `grep -i "audit"` sobre todo `modules/tenant-payments/` devuelve **una sola coincidencia, en un `.spec.ts`** (`tenant-wompi-webhook.service.spec.ts:118`), no en código de producción. Ni `setConfig`, ni `setConfigUnderProviderLock`, ni `activateProvider` (:609-633), ni `disconnect` (:636-649), ni `disconnectProvider` (:651-675) escriben en `audit_logs`.

**4. Esto es una desviación del patrón propio de la casa, no sólo de un doc.** La operación análoga —revocar una credencial de canal del tenant— sí audita: `channel-management.controller.ts:1554-1568` escribe `auditLog.create({ action: 'channel_disconnected', details: { triggeredBy: userId ... } })`. Existe además `common/utils/audit-actor.util.ts` justamente para atribuir el super_admin real bajo impersonación. El módulo de cobro, que maneja llaves de dinero, saltea ambos.

**5. El dinero efectivamente se redirige.** `createPaymentLink` resuelve las credenciales en el momento de generar (`tenant-payments.service.ts:983` `publicKey: credentials.publicKey`), así que todo link nuevo sale hacia el comercio de quien haya escrito la config. Y `activateProvider:625-627` estampa `webhookAcknowledgedAt` por sí mismo, así que el atacante no necesita ningún paso externo en el panel del tenant para dejar el riel activo.

**DOS CORRECCIONES AL HALLAZGO (por eso no lo subo de P2):**

(a) *"sin una sola línea de auditoría" está exagerado.* `tenant.guard.ts:33` emite `this.logger.log('[AUDIT] super_admin ${user.email} accessing tenant ${tenantIdParam}')` en cada request de super_admin con tenantId de ruta. Eso llega a Loki vía promtail y deja actor + tenant + timestamp. Lo que NO deja es **qué** cambió, no es durable en `audit_logs`, y muere con la retención de logs. La falla real es "sin trazabilidad durable ni del cambio", no "sin ningún rastro".

(b) *El radio de daño está acotado hacia atrás.* Los intents fijan la llave con la que fueron generados (`expectedPublicKey: credentials.publicKey`, :1112 y :1427) y `setConfigUnderProviderLock:538` sube `revision` sólo ante cambio material, así que los links ya emitidos bajo el comercio legítimo no se re-atribuyen en silencio: sólo los links **nuevos** cobran hacia el atacante.

**Por qué P2 y no P1:** el escenario exige un token de `super_admin`, el principal de máxima confianza de la plataforma, que ya puede impersonar y hacer lo mismo desde la UI del tenant. No hay escalada de privilegio: hay pérdida de atribución sobre un riel de dinero. Además el bypass es sistémico de toda la API (cualquier controller tenant-scoped se comporta igual), aunque acá pesa más porque la credencial es dinero y porque el módulo hermano (canales) sí audita. P2 es la calificación correcta.

### 17. [P2] Un mismatch canónico del link deja ese pedido imposible de cobrar para siempre, sin forma de destrabarlo

- **Dónde:** `apps/api/src/modules/tenant-payments/tenant-payments.service.ts:1128`
- **Escenario de fallo:** El POST a `/payment_links` sale bien pero el GET canónico posterior falla una vez (500 transitorio de Wompi, o un campo del response que no coincide con lo asumido: `merchant_public_key`, `single_use`, `collect_shipping`, `active`). `getAndValidatePaymentLink` tira `wompi_link_canonical_mismatch` con ambiguous=true (tenant-wompi.client.ts:190-203), y `createPaymentLink` marca el intent `requires_review` con ese `lastError` (tenant-payments.service.ts:1017-1026). Desde ahí: (a) el índice único parcial `uidx_tenant_payment_intents_unresolved_reference` (tenant-payment-store.service.ts:94-96) impide crear otro intent para el mismo `canonical_reference`, así que todo intento futuro cae en `payment_link_reconciliation_required` (tenant-payments.service.ts:926-931); y (b) `reconcilePaymentLinkCreation` solo repara `requires_review` cuando el `lastError` es exactamente `tenant_payment_link_attach_failed`, cualquier otro devuelve `pending` sin tocar nada. No hay endpoint ni cron que lo limpie, y el dashboard no expone la tabla de intents (apps/dashboard/src/lib/api.ts:1413-1428 solo tiene config). El pedido X del cliente queda sin poder cobrarse por la plataforma, para siempre. Nota adicional: el contrato de `/v1/payment_links` es el único trozo de Wompi que nadie verificó contra la API real — `apps/api/scripts/verify-wompi-sandbox.js` cubre tokens/fuentes/cobros del riel plataforma, nunca payment_links; el spec del cliente mockea el shape que el propio código espera. Si algún campo difiere, esto no es un pedido trabado sino el 100% de las ventas.
- **Evidencia:** const repairableAttachFailure = wompiIntent.status === 'requires_review'
    && wompiIntent.lastError === 'tenant_payment_link_attach_failed';
if (wompiIntent.status !== 'pending' && !repairableAttachFailure) {
    return { status: 'pending' };
}
- **Arreglo:** Permitir que la conciliación repare cualquier `requires_review` cuyo link vuelva a validar canónicamente (el fail-closed real debe depender de que exista evidencia de transacción del proveedor, no del texto de `lastError`). En paralelo, correr una verificación empírica de `POST/GET /v1/payment_links` contra sandbox, al estilo de verify-wompi-sandbox.js, antes de confiar en las cuatro igualdades del validador.
- **Veredicto del refutador:** NO PUDE DERRIBARLO: el camino existe línea por línea, pero el impacto está exagerado y la nota "100% de las ventas" es especulación no anclada.

LO QUE CONFIRMÉ LEYENDO EL CÓDIGO

1) El error de verificación canónica sí llega como `requires_review` con un lastError NO reparable.
- `apps/api/src/modules/tenant-payments/tenant-wompi.client.ts:141-155`: tras un POST /payment_links exitoso (`providerLinkId` ya conocido), si el GET canónico falla o no matchea, se re-lanza `new WompiProviderError(error.code, true, providerLinkId)` — o sea conserva el código original (`wompi_link_canonical_mismatch` en :202, `wompi_link_canonical_read_failed` en :174/:177) y adjunta el link id.
- `apps/api/src/modules/tenant-payments/tenant-payments.service.ts:1016-1026`: `recoverableLinkId = providerError.providerLinkId` → `state = 'requires_review'` y `markCreationState(..., providerError.code, recoverableLinkId)`. El lastError guardado es el código canónico, nunca `tenant_payment_link_attach_failed`.
- `tenant-payment-store.service.ts:327-345`: `markCreationState` corre `WHERE status='pending'` y el intent recién creado está pending, así que la transición ocurre y además fija `provider_link_id`.

2) La reparación queda fuera de alcance por el guard citado, y la cita es textual y en contexto.
- `tenant-payments.service.ts:1128-1132`: `repairableAttachFailure` exige exactamente `lastError === 'tenant_payment_link_attach_failed'`; con cualquier otro lastError y status distinto de `pending` devuelve `{status:'pending'}` sin tocar nada — incluso cuando el GET posterior (línea 1109) validó TODO correctamente y probó que el link está sano. Ese es el punto real: el guard es más estricto de lo necesario, porque un GET que pasa `getAndValidatePaymentLink` ya demuestra por sí mismo que es seguro adjuntar (si el mismatch fuera genuino, el GET volvería a fallar y el catch de :1141 devolvería pending igual).

3) El bloqueo posterior de la referencia es real.
- Índice parcial `uidx_tenant_payment_intents_unresolved_reference` sobre `canonical_reference` WHERE status IN ('pending','requires_review','ambiguous') (`tenant-payment-store.service.ts:94-96`).
- `createOrGetIntent` inserta con `ON CONFLICT DO NOTHING` (:229), luego el SELECT de rescate (:245-254) trae la fila `requires_review`, y el re-open sólo aplica a `failed` sin ids de proveedor (:270-295) → devuelve `created:false`.
- `tenant-payments.service.ts:926-931`: `if (!created || intent.status !== 'pending') throw ServiceUnavailable('payment_link_reconciliation_required')`. Ojo: el idempotencyKey es el uuid del intent de operación (`payment-operation.service.ts:363`), o sea distinto en cada reintento, y aun así el bloqueo es por `canonical_reference`, no por la key. El reintento no destraba.

4) No hay salida operativa. Verificado:
- Sin cron/sweep: `grep @Cron` en `apps/api/src/modules/tenant-payments/*.ts` → 0 resultados; no hay ningún job que barra `requires_review`.
- Sin endpoint de resolución: `tenant-payments.controller.ts` sólo tiene config, active-provider, disconnect y los 2 webhooks (líneas 25-141).
- Sin UI: `apps/dashboard/src/lib/api.ts:1413-1428` sólo expone config/activar/desconectar; no hay listado de intents ni acción de destrabe.
- El único `reconcile` llamador (`tenant-mercadopago-operation.provider.ts:120-127`) se invoca en el mismo turno (`payment-operation.service.ts:376-382`), no reintenta después.

DONDE EL HALLAZGO EXAGERA (por eso bajo a P2)

a) "El pedido X queda sin poder cobrarse para siempre" es más fuerte que la realidad. El link SÍ existe y está activo en Wompi (el POST devolvió 200). El dueño puede tomar la URL desde su panel de Wompi y enviarla a mano: cuando el cliente pague, el webhook entra por `settleWompiTransaction` (`tenant-payment-store.service.ts:434-458`), encuentra el intent por `provider_link_id`, pasa las validaciones y **actualiza el pedido a `payment_status='paid'`** en `:592-602` — esa UPDATE no está gateada por el estado del intent. Lo que queda trabado es la emisión de un NUEVO enlace por la plataforma y el estado del ledger (`:614` excluye `requires_review` de la transición a paid). O sea: es una degradación operativa, no plata perdida ni pedido incobrable.

b) No es silencioso. `payment-operation.service.ts:758-776` marca `requiresReview` → `shouldHandoff: true` y el prompt del tool (`tools/payment-tools.ts:26`) obliga a escalar a humano sin pedir otro pago. El dueño se entera.

c) El fail-closed es deliberado y correcto en su núcleo: nunca compartir una URL no verificada, y nunca emitir un segundo enlace vivo mientras uno posiblemente vivo existe (comentarios en `:1118-1121`, `:1434-1444` y test `tenant-payments.service.spec.ts:416-464`). El defecto es sólo la ausencia del camino de salida cuando la evidencia canónica posterior es limpia — típicamente un 500/timeout transitorio en el GET (`tenant-wompi.client.ts:173-178`), que es la causa más probable, no un mismatch real.

d) La "nota adicional" (si un campo difiere se cae el 100% de las ventas) NO la confirmo: es hipótesis. Sí es cierto y verificable que ningún script toca el endpoint — `grep payment_links apps/api/scripts/*.js` → 0 — y que `tenant-wompi.client.spec.ts` mockea el shape que el propio código asume, así que el contrato de `/v1/payment_links` (`single_use`, `collect_shipping`, `merchant_public_key`, `active`, eco de `expires_at` con tolerancia de 60s en `:187-201`) está sin probar contra la API real. Eso es un riesgo de verificación a cerrar con una prueba real en sandbox, no un defecto probado.

CIERRE SUGERIDO (mínimo y seguro): en `tenant-payments.service.ts:1128`, permitir la reparación cuando el GET canónico validó y el intent está en `requires_review` con `provider_link_id` igual al consultado, sin importar el lastError — la validación del GET es la prueba, el lastError no aporta seguridad extra. Y agregar un barrido/endpoint de super_admin para intents `requires_review`/`ambiguous`, que hoy no existe en ninguna capa.

### 18. [P2] Los eventos de liquidación no tienen un solo listener y no hay pantalla de requires_review: la plata con problema es invisible

- **Dónde:** `apps/api/src/modules/tenant-payments/tenant-wompi-webhook.service.ts:89`
- **Escenario de fallo:** El cliente paga los 250.000 COP, pero entre la creación del link y el pago el pedido cambió de monto (o el `payment_status` ya estaba en 'paid' por otra vía). `settleWompiTransaction` hace lo correcto — no marca pagado, deja el intent en `requires_review` con `payable_snapshot_changed` / `amount_or_currency_mismatch` — y el webhook emite `tenant_payment.validation_failed`. Pero un grep por `@OnEvent` en todo apps/api/src no devuelve NINGÚN suscriptor de `tenant_payment.succeeded`, `tenant_payment.refunded` ni `tenant_payment.validation_failed`: los tres se emiten al vacío. Y el dashboard no tiene endpoint que liste `tenant_payment_intents` (apps/dashboard/src/lib/api.ts:1413-1428 = solo config/activar/desconectar). Consecuencia: el dinero entró a Wompi, el pedido quedó sin acreditar, nadie del tenant se entera nunca — la única forma de descubrirlo es que el cliente final vuelva a escribir y el agente use `get_payment_status`. En el camino feliz pasa lo mismo en menor escala: `tenant_payment.succeeded` no dispara ninguna confirmación al cliente ni aviso al tenant.
- **Evidencia:** this.events.emit('tenant_payment.validation_failed', {
    tenantId, provider: 'wompi', providerPaymentId: transaction.id,
    providerLinkId: transaction.paymentLinkId,
    canonicalReference: result.intent?.canonicalReference,
    reason: result.validationError,
});  // ningún @OnEvent escucha este evento en todo el repo
- **Arreglo:** Agregar un listener que, ante `validation_failed`, escale al inbox del agente y notifique al tenant_admin (mail/Telegram como ya hace handoff), y ante `succeeded` confirme al cliente. Sumar un endpoint tenant_admin que liste intents en `requires_review`/`ambiguous` con su `last_error` y una acción de resolver.
- **Veredicto del refutador:** CONFIRMADO EN LOS HECHOS, PERO CON EL IMPACTO ACOTADO — baja de P1 a P2.

Lo que verifiqué y NO pude derribar:

1. Los tres eventos se emiten al vacío. tenant-wompi-webhook.service.ts:89 (validation_failed), :101 (succeeded), :113 (refunded), y sus gemelos MP en tenant-payments-webhook.service.ts:187,196,207,233,289,331. Un grep de `@OnEvent(['"]tenant_payment` sobre todo apps/api/src da CERO resultados; el listado de @OnEvent relacionados a pagos solo devuelve los de billing/ y fiscal/ (BillingEventType.*), que son la suscripción SaaS, no este ledger. Tampoco hay escape por comodín: no existe `onAny` ni `@OnEvent('**')` en el repo, y app.module.ts:143 usa `EventEmitterModule.forRoot()` SIN `wildcard: true`, así que ni un listener comodín podría estar escuchando.

2. No hay superficie de lectura para el tenant. tenant-payments.controller.ts (leído completo, 142 líneas) expone únicamente GET/PUT config, PUT config/:provider, PUT active-provider, DELETE config[/:provider] y los dos webhooks públicos. Ningún endpoint lista tenant_payment_intents ni filtra por status. El dashboard es el espejo exacto: apps/dashboard/src/lib/api.ts:1413-1428 son 6 llamadas de config y nada más. Ops Center tampoco lo mira: grep de `tenant_payment|payment_intents` en apps/api/src/modules/health = 0 matches. No hay @Cron ni @Interval en todo modules/tenant-payments/ — el único `source: 'poll'` (tenant-payments.service.ts:1210) corre dentro del camino del agente, no en un barrido de fondo.

3. El estado requires_review sí se produce con plata real adentro. tenant-payment-store.service.ts:485-511 marca payable_snapshot_changed, payable_already_settled_elsewhere, amount_or_currency_mismatch, multiple_approved_transactions; :535-545 deja el intent en requires_review y — clave — el UPDATE de la fila de dominio (:592-602, `SET payment_status = ...`) queda del otro lado del return, así que el pedido NUNCA se acredita. Wompi cobró, el pedido sigue pending, nadie del tenant recibe señal push.

POR QUÉ BAJO LA SEVERIDAD (dónde el hallazgo se pasa de rosca):

a) El camino feliz NO depende del evento. La parte que dice "en el camino feliz pasa lo mismo en menor escala" es lo más débil: la acreditación del pedido ocurre DENTRO de la transacción de liquidación (tenant-payment-store.service.ts:592-602 Wompi, :807-816 MP), no en un @OnEvent. Que tenant_payment.succeeded no tenga suscriptor no cuesta un peso: cuesta un mensaje de cortesía nunca especificado. Feature faltante, no defecto.

b) Existe un camino reactivo real y funciona punta a punta. payment-operation.service.ts:758-765 devuelve requiresReview + shouldHandoff:true, y ese flag SÍ se lee: conversations.service.ts:2296 lo convierte en postToolHandoff y escala la conversación a un humano. No es "que el agente se dé cuenta solo" — la escalada es automática apenas la tool corre. El hueco real es que necesita que el cliente vuelva a escribir.

c) La plata no es invisible: está en la cuenta Wompi PROPIA del tenant (credenciales suyas, getWompiCredentials) y el panel de Wompi muestra la transacción APPROVED. Falta la conciliación dentro de Parallly, no la existencia del dinero. Nada se pierde ni se cobra de más: el ledger guarda el attempt con validation_error (insertAttempt, :856-885) y el diseño se niega explícitamente a marcar pagado ante cualquier duda — eso es lo bien hecho del módulo, y el propio hallazgo lo reconoce.

d) Requiere una anomalía para dispararse (monto del pedido cambiado entre link y pago, doble APPROVED, dueño cambiado, ya liquidado por otra vía). No es el flujo diario.

Neto: el gap de observabilidad es real, verificable y afecta plata cobrada sin acreditar, así que no lo refuto. Pero es "conciliación demorada y descubrimiento reactivo", no "pago perdido": P2.

### 19. [P2] Un cobro de sandbox marca el pedido real como pagado

- **Dónde:** `apps/api/src/modules/tenant-payments/tenant-payments.service.ts:1740`
- **Escenario de fallo:** El selector del panel arranca en 'sandbox' (apps/dashboard/src/app/admin/settings/integrations/payments/page.tsx:68). El tenant pega pub_test_/prv_test_/test_events_ y activa: `isStoredProviderActivationReady` valida que exista un `environment`, nunca que sea 'production'. A partir de ahí el agente reparte links de checkout de sandbox a clientes reales. Cualquiera que pague con una tarjeta de prueba de Wompi genera un evento con environment 'test', que el webhook acepta porque solo lo compara contra el ambiente configurado por el propio tenant (tenant-wompi-webhook.service.ts:37-40), y `settleWompiTransaction` escribe `payment_status='paid'` en la tabla de dominio real (tenant-payment-store.service.ts:592-602). El pedido se da por cobrado y se despacha con cero pesos recibidos. La tabla `tenant_payment_intents` ni siquiera tiene columna de ambiente (DDL en tenant-payment-store.service.ts:67-91): el único rastro de que fue sandbox queda enterrado en `event_snapshot` del attempt (línea 875).
- **Evidencia:** const config = stored.providers.wompi;
return !!config?.publicKey
    && !!config.privateKeyEnc
    && !!config.eventsSecretEnc
    && !!config.webhookTokenEnc
    && !!config.environment      // ← existe, pero nunca se exige 'production'
    && !!config.verifiedAt;
- **Arreglo:** Persistir `environment` en `tenant_payment_intents` y negarse a mover la fila de dominio a 'paid' cuando la transacción es de sandbox (dejarla en un estado de prueba visible). Y bloquear `activateProvider` con credenciales de sandbox salvo un flag explícito de plataforma, o al menos exigir confirmación con cartel de que ningún pago será real.
- **Veredicto del refutador:** CÓDIGO VERIFICADO — las citas son exactas y no hay guarda aguas arriba que lo impida.

1) `tenant-payments.service.ts:1740-1746` dice literalmente lo que afirma el hallazgo: `isStoredProviderActivationReady` para wompi exige `publicKey/privateKeyEnc/eventsSecretEnc/webhookTokenEnc/environment/verifiedAt`, nunca `environment === 'production'`. Su único llamador es `activateProvider` (`:617`), que además solo valida entitlement de plan (`assertCustomerPaymentsEntitled`, `:613/:615`). `isStoredProviderReady` (`:1712-1730`) tampoco discrimina ambiente.

2) No hay gate de ambiente en NINGÚN punto aguas abajo. Busqué en todo el módulo y en el camino IA: `createPaymentLink` (`tenant-payments.service.ts:844-1031`) solo verifica entitlement, `activeProvider`, `ready`, `configRevision` y `currency === 'COP'` (`:884`); pasa `credentials.environment` tal cual a `createAndVerifyPaymentLink` (`:985`), que arma la URL contra `https://sandbox.wompi.co/v1` (`tenant-wompi.client.ts:33-36`). `payment-operation.service.ts` (grep de `environment` → 0 coincidencias; `getRuntimeCapability` en `:184-212`) no conoce el concepto de ambiente, así que la tool del agente reparte el link de sandbox igual que uno real.

3) La liquidación escribe en la tabla de dominio real sin mirar ambiente: `tenant-payment-store.service.ts:592-602` hace `UPDATE ${parsed.target.table} SET payment_status = $2` y `:603-619` pone el intent en `paid`. Confirmado que la tabla `tenant_payment_intents` no tiene columna de ambiente — no solo en el DDL runtime (`tenant-payment-store.service.ts:67-91`) sino también en el canónico `apps/api/prisma/tenant-schema.sql:231-254`. El único rastro es el `event_snapshot` del attempt (`:873-881`).

4) El chequeo del webhook es tautológico, no protege: `tenant-wompi-webhook.service.ts:37-40` compara el evento contra `credentials.environment` (el que el propio tenant configuró), y además `CanonicalWompiTransaction.environment` no viene del proveedor sino que se copia de la credencial usada (`tenant-wompi.client.ts:259`). O sea: en modo sandbox el evento 'test' es exactamente lo esperado y pasa.

5) No existe test que lo cubra: los únicos `sandbox` en los .spec son de MercadoPago y de crypto (`tenant-payments.service.spec.ts:676,729`); ninguno bloquea activación de wompi sandbox.

LO QUE SÍ ACOTA EL ESCENARIO (por eso bajo a P2, no lo refuto):
- El "default sandbox del selector" (`page.tsx:68`) NO alcanza para caer en sandbox por accidente: `environmentForKeys` (`tenant-wompi.client.ts:42-54`) exige que los tres prefijos coincidan entre sí Y con el `environment` enviado; pegar llaves `pub_prod_/prv_prod_/prod_events_` con el selector en sandbox devuelve `null` y `setConfig` rechaza (`tenant-payments.service.ts:487-489`). Para quedar en sandbox hay que ir a Wompi, sacar llaves de prueba y pegarlas deliberadamente, y encima confirmar el modal `wompiActivationConfirm` que en es.json dice explícitamente "…en el comercio y ambiente correctos de Wompi".
- No hay camino de atacante ni contaminación cruzada: la credencial se elige por callback token opaco (`getWompiCredentials`, `:759-801`) y la liquidación resuelve el intent por `provider_link_id` (`tenant-payment-store.service.ts:435-441`), así que un evento de sandbox no puede tocar un intent creado en producción. Un tenant configurado en producción — el caso del dueño ahora mismo — no es alcanzable por esto.
- El daño queda dentro de un solo tenant y es plata propia (despacha sin cobrar); no hay fuga de credenciales ni de datos de otro tenant.

MATIZ ADICIONAL QUE ENCONTRÉ Y AGRAVA UN POCO: `getWompiCredentials` con `callbackToken` recorre también `config.history` (`tenant-payments.service.ts:772-774`). O sea, un tenant que probó en sandbox y después rotó a producción deja vivos el callback token y el events secret de sandbox; los intents creados durante la prueba pueden seguir liquidándose (y marcando `payment_status='paid'` en pedidos reales) después del pasaje a producción. Pasar a producción no cierra la puerta de los intents de sandbox pendientes.

CONCLUSIÓN: el defecto es real y no requiere atacante, pero requiere una acción deliberada del tenant_admin (conseguir y pegar llaves de prueba, activarlas y dejarlas activas frente a clientes reales), y el sistema no ofrece ninguna señal de runtime de que ese dinero es falso (`ready:true`, sin badge de sandbox mientras está activo, sin columna de ambiente en el intent, `paid` en la tabla de dominio). Es un hueco de diseño con impacto de plata acotado al propio tenant → P2, no P1.

### 20. [P2] La rama 'transacción sin payment_link_id' descarta el evento en silencio con 200 y log en debug

- **Dónde:** `apps/api/src/modules/tenant-payments/tenant-wompi-webhook.service.ts:66`
- **Escenario de fallo:** `getTransaction` consulta `/v1/transactions/{id}` autenticando con la llave PÚBLICA (tenant-wompi.client.ts:229). Si esa vista devolviera el objeto sin `payment_link_id` — por permisos de la llave, por un cambio de shape, o simplemente porque el campo llega null en algún medio de pago — el webhook entra en esta rama, responde 200 (Wompi da el evento por entregado y no reintenta) y solo deja un `logger.debug`. No se inserta fila en `tenant_payment_attempts`, no se emite ningún evento, no queda contador. El modo de falla sistémico —todos los pagos del tenant descartados en silencio— es indistinguible del caso legítimo que la rama quiere cubrir (una transacción del comercio ajena a un link), y no dispara ninguna alarma.
- **Evidencia:** if (!transaction.paymentLinkId) {
    this.logger.debug(`Ignoring Wompi transaction ${transaction.id} without payment_link_id`);
    return;
}
- **Arreglo:** Subir a `warn` con contador/Sentry y registrar una fila de attempt huérfana (`unknown_payment_link` ya existe como categoría en el store), para que 'ninguna transacción trae link' se vea como anomalía en vez de desaparecer. Evaluar además leer la transacción con la llave privada, que es la que Wompi documenta para la vista completa del comercio.
- **Veredicto del refutador:** La línea citada es literal y hace lo que se afirma. `apps/api/src/modules/tenant-payments/tenant-wompi-webhook.service.ts:66-69` retorna antes de `settleWompiTransaction` (:73), así que no se inserta fila en `tenant_payment_attempts`, no se emite evento y el controller (`tenant-payments.controller.ts:129-139`) responde 200. El spec `tenant-wompi-webhook.service.spec.ts:100-116` fija ese comportamiento a propósito.

NO pude derribarlo del todo, pero sí acoté fuerte el alcance con tres guardas que el hallazgo no consideró:

1) `tenant-payment-store.service.ts:429-431`: el store lanza `wompi_transaction_has_no_payment_link`. El early-return del webhook es una frontera deliberada, no un descuido.
2) `tenant-payments.service.ts:1434-1445` (`reconcileExpiredWompiIntent`): el comentario nombra EXACTAMENTE este riesgo ("nor that an APPROVED webhook was not lost") y, al vencer el TTL con link inactivo, marca el intent `requires_review` con `wompi_inactive_link_requires_provider_evidence` en vez de fabricar un `expired`.
3) `tenant-payments.service.ts:926-931`: con el intent fuera de `pending`, `createLink` lanza `payment_link_reconciliation_required`. La IA NO puede emitir un segundo link para la misma referencia → **doble cobro inalcanzable por este camino**.

Lo que SÍ sobrevive:
- El poll no rescata nada. `tenant-payments.service.ts:1178-1180` exige `intent.providerTransactionId`, y esa columna sólo la escribe `settleWompiTransaction` (`tenant-payment-store.service.ts:539, 560, 606`). Si el primer webhook cae en la rama de :66, `provider_transaction_id` queda NULL y el poll nunca corre. Es un huevo-y-gallina: el hallazgo tiene razón en que no hay red de contención activa.
- No hay alarma: grep de `tenant_payment` sobre `modules/health/` da CERO resultados. El monitoreo de payment-webhooks del Ops Center cubre el billing de plataforma, no el cobro tenant-owned.
- La guarda de :1434 es pasiva: sólo corre si alguien llama `getPaymentStatus` o reintenta crear link DESPUÉS del vencimiento. Un intent que nadie consulta queda `pending` para siempre, sin rastro.

Por qué bajo el impacto respecto de como está redactado: el disparador es una hipótesis del proveedor, no un estado que el sistema pueda producir. Nada en el código hace desaparecer `payment_link_id` de una transacción originada en payment link, y la lectura con llave pública (`tenant-wompi.client.ts:216-261`) es la misma vista canónica que ya se usa y valida id/status/currency/monto. Además la rama es NECESARIA: la cuenta Wompi es del tenant y recibe eventos de transacciones ajenas a Parallly; insertar un attempt por cada una ensuciaría el ledger sin límite.

Peor desenlace realista: una orden realmente pagada queda sin fulfillment en Parallly, sin fila en el ledger que explique por qué, hasta que alguien consulte y caiga en `requires_review`. La plata está en la cuenta Wompi del propio tenant. No hay cobro doble, no hay plata mal movida, no hay credencial filtrada. Eso es P2 (hueco de observabilidad con control compensatorio), no la falla sistémica silenciosa que sugiere la redacción.

### 21. [P2] Los eventos tenant_payment.* no tienen ningún listener: un doble cobro aprobado queda en requires_review y nadie se entera nunca

- **Dónde:** `apps/api/src/modules/tenant-payments/tenant-wompi-webhook.service.ts:89`
- **Escenario de fallo:** Wompi aprueba una SEGUNDA transacción sobre el mismo payment link (el propio store lo contempla: `multiple_approved_transactions`, store:505-511). El cliente queda cobrado dos veces. El intent pasa a 'requires_review', se emite `tenant_payment.validation_failed`... y el evento cae al vacío: `grep "@OnEvent('tenant_payment"` sobre todo el repo da 0 resultados, y `grep requires_review|tenant_payment_intents` sobre apps/dashboard/src también da 0. No hay email, ni incidente en el Ops Center, ni pantalla donde el dueño vea la fila. El doble cobro solo se descubre si el cliente reclama. Lo mismo aplica a `payable_already_settled_elsewhere` y a `unknown_payment_link` (store:443-457), que además guarda el intento con intent_id NULL.
- **Evidencia:** this.events.emit('tenant_payment.validation_failed', {
    tenantId, provider: 'wompi', providerPaymentId: transaction.id, ...
});
// y en tenant-payments-webhook.service.ts:331 el comentario dice
// "El evento es lo que permite que otra cosa reaccione —confirmar la reserva,
//  avisarle al dueño, disparar una automatización—" pero no hay suscriptor.
- **Arreglo:** Agregar un @OnEvent('tenant_payment.validation_failed') que levante incidente vía IncidentService + email al tenant_admin, y una vista (tenant y super_admin) que liste los intents en requires_review/ambiguous. Mientras no exista consumidor, `tenant_payment.succeeded` también es entrega at-most-once: si el proceso muere después del COMMIT, el reintento del PSP entra por `result.duplicate` (webhook:87) y jamás se re-emite.
- **Veredicto del refutador:** VERIFIQUÉ EL HECHO CENTRAL Y ES CIERTO, PERO EL ESCENARIO TITULAR ESTÁ BLOQUEADO AGUAS ARRIBA Y EL "NADIE SE ENTERA NUNCA" ES FALSO.

1) La emisión sin suscriptor es real. `apps/api/src/modules/tenant-payments/tenant-wompi-webhook.service.ts:89` emite efectivamente `tenant_payment.validation_failed` (y 101 `succeeded`, 113 `refunded`); `tenant-payments-webhook.service.ts:187,196,207,233,289,331` hace lo mismo por el riel MP. Inventarié TODOS los `@OnEvent(` de `apps/api/src`: hay 60+ handlers (billing, fiscal, push, automation, agent-console, public-api, offboarding, health/coupon-alert.listener.ts) y NINGUNO escucha `tenant_payment.*`; tampoco hay wildcard ni `onAny` (grep de `@OnEvent('*` y `onAny` = 0). Tampoco hay superficie de lectura: `tenant-payments.controller.ts` sólo expone config (25-105) + los dos webhooks (114,129) — no hay endpoint que liste `tenant_payment_intents`; `apps/dashboard/src/lib/api.ts:1413-1428` sólo llama a config/active-provider/disconnect. Y `health/platform-monitor.service.ts:673-745` vigila `billing:webhook:fail:{provider}` (suscripción de plataforma), no el ledger del tenant. No hay `@Cron` ni `Interval` en todo el módulo `tenant-payments` (grep = 0). O sea: no hay email, ni incidente, ni pantalla, ni barrido.

2) El escenario titular (doble cobro) SÍ está bloqueado aguas arriba. `tenant-wompi.client.ts:102` crea el link con `single_use: true` y `:196` RECHAZA el link si la lectura canónica devuelve `single_use !== true`. La rama `multiple_approved_transactions` (`tenant-payment-store.service.ts:505-511`) es defensa en profundidad contra un estado que Wompi no produce en operación normal, no el caso esperado. Citar el doble cobro como el escenario de fallo es citar la rama menos alcanzable del archivo.

3) `unknown_payment_link` (store:442-457) no es plata perdida: se dispara cuando llega una transacción de un link que no está en nuestro ledger — típicamente uno que el propio dueño creó desde su panel de Wompi. El dinero está en la cuenta del tenant y él lo ve en Wompi. Además el `intent_id NULL` que el hallazgo marca como problema es deliberado: la columna es nullable por diseño (`store:103` y `prisma/tenant-schema.sql:270`), no revienta el INSERT ni deja el webhook en 5xx eterno.

4) El "sólo se descubre si el cliente reclama" es media verdad, y la mitad que falta importa: existe un camino de escalada real. `payment-operation.service.ts:758-765` devuelve `requiresReview: true` + `shouldHandoff: true` para `requires_review`/`ambiguous`, y `conversations.service.ts:2296` convierte cualquier resultado de tool con `shouldHandoff === true` en un handoff efectivo (`postToolHandoff`). Encima `tools/payment-tools.ts:26` le prohíbe explícitamente a la IA afirmar que se pagó o pedir un segundo pago. Es decir: cuando el cliente dice "ya pagué", la conversación cae a un humano con el estado en revisión — no hay riesgo de que el agente cobre dos veces ni de que niegue el pago.

5) LO QUE SOBREVIVE Y SÍ ES REAL (por eso no lo refuto): hay ramas de validación alcanzables en operación normal que dejan plata aprobada con el payable sin pagar y sin ningún aviso proactivo. `store:496-503` (`payable_snapshot_changed`, `amount_or_currency_mismatch` — el pedido se editó después de emitido el link) y `store:492-495` (`payable_already_settled_elsewhere`). En esas ramas el flujo retorna en `store:535-555` ANTES del UPDATE del dominio de `store:592-602`: la transacción quedó APPROVED en Wompi, el intent pasa a `requires_review`, pero `payment_status` del pedido/turno NUNCA se marca 'paid'. El cliente pagó, el dueño ve el pedido impago, y el descubrimiento depende de que el cliente lo mencione en el chat. Eso es un hueco operativo real de conciliación.

CONCLUSIÓN: el hallazgo es real en su núcleo (cero listeners, cero superficie de conciliación) pero el escenario que eligió para justificarlo es el menos alcanzable (single_use lo bloquea) y el impacto está exagerado (existe handoff reactivo con guardas anti-doble-cobro). Bajo P1 → P2: falta notificación/pantalla de conciliación para `requires_review`, no hay pérdida de dinero ni credencial filtrada.

### 22. [P2] El campo `environment` del evento Wompi se exige obligatorio y fail-closed 401, más estricto que el contrato que la propia investigación del equipo dio por verificado

- **Dónde:** `apps/api/src/modules/tenant-payments/tenant-wompi-webhook.service.ts:38`
- **Escenario de fallo:** `String(body?.environment || '')` vale '' cuando el campo no viene, así que un evento sin `environment` (o con 'production' en vez de 'prod') se rechaza con 401 ANTES de validar el checksum. La investigación propia del equipo dice literal: «Fuente: la doc en español. La inglesa omite `environment` y el `timestamp` de primer nivel» y recomienda «Validar `environment` (`prod`/`test`) contra el ambiente configurado SI EL CAMPO LLEGA» (docs/pasarela-wompi-research-2026-08.md:493). Si la cuenta real de producción manda algo distinto de 'prod' exacto, el 100% de los eventos devuelve 401, Wompi agota sus reintentos y —por el hallazgo del poll inalcanzable— cada pago real queda cobrado por Wompi y jamás liquidado en la plataforma, en silencio. El binding de ambiente ya está garantizado sin este campo: la lectura canónica `getTransaction` usa la llave pública del tenant contra la URL base de SU ambiente (tenant-wompi.client.ts:221-232).
- **Evidencia:** const expectedEnvironment = credentials.environment === 'production' ? 'prod' : 'test';
if (String(body?.environment || '') !== expectedEnvironment) {
    throw new UnauthorizedException('wompi_event_environment_mismatch');
}
const signature = verifyWompiEventSignature({ ... });  // ← la firma se valida DESPUÉS
- **Arreglo:** Exigirlo solo si llega (`if (body?.environment !== undefined && String(body.environment) !== expectedEnvironment)`) y moverlo después de `verifyWompiEventSignature`, para no rechazar por un campo no autenticado y no dar un oráculo distinto al que solo tiene el callback token.
- **Veredicto del refutador:** CÓDIGO VERIFICADO (la cita es literal y en contexto). `apps/api/src/modules/tenant-payments/tenant-wompi-webhook.service.ts:37-40` dice exactamente lo afirmado: `const expectedEnvironment = credentials.environment === 'production' ? 'prod' : 'test';` y `if (String(body?.environment || '') !== expectedEnvironment) throw new UnauthorizedException('wompi_event_environment_mismatch')`, ANTES de `verifyWompiEventSignature` (línea 41). Es incondicional (ausencia → '' → 401), exacto y además **case-sensitive** (el gemelo de plataforma sí hace `.toLowerCase()`, `billing/adapters/wompi.adapter.ts:772`). No hay guarda aguas arriba, ni try/catch, ni early-return que evite el 401: el controlador (`tenant-payments.controller.ts:129-141`) deja propagar. El spec (`tenant-wompi-webhook.service.spec.ts:171-177`) cubre el mismatch con valor 'test', pero NO cubre la ausencia del campo. Así que el escenario no está impedido por el sistema: depende íntegramente del payload del proveedor. Por eso NO lo refuto.

AHORA, DONDE EL HALLAZGO SE CAE (tres cosas):

1) LA PREMISA DEL "CONTRATO VERIFICADO" ES FALSA. La misma línea del research que se cita (`docs/pasarela-wompi-research-2026-08.md`, §6.3) no da nada por verificado: dice textualmente "Validar contra sandbox antes de dar la firma por hecha". Era una recomendación PREVIA a implementar, y fue deliberadamente superada por una revisión adversarial posterior que encontró que el guard opt-out era el problema, no la solución: el rationale quedó escrito en `billing/adapters/wompi.adapter.ts:763-766` ("A MISSING environment is rejected too — treating it as 'not stated, therefore fine' would make the guard opt-out for the sender") y con tres tests que lo fijan (`wompi.adapter.spec.ts:208-227`, incluido "rejects an event that omits environment instead of treating it as fine"). El módulo tenant no es un outlier estricto: replica la convención ya vigente en el riel de suscripciones de la plataforma. Presentar esto como "más estricto que el contrato del equipo" invierte la historia.

2) EL IMPACTO "JAMÁS LIQUIDADO, EN SILENCIO" ESTÁ EXAGERADO. Existe y es alcanzable un camino canónico de rescate que liquida la MISMA plata por la MISMA función: `tenant-payments.service.ts:1178-1215` — para cualquier intent wompi en `pending`/`failed` hace `getTransaction` con la llave pública del tenant y llama `store.settleWompiTransaction({... source:'poll'})`, o sea la misma liquidación que el webhook. Y está cableado en runtime: tool `get_payment_status` (`conversations/tools/payment-tools.ts:25`) → `ai-tool-executor.service.ts:301` → `payment-operation.service.ts:754` → `tenant-mercadopago-operation.provider.ts:101-107` (clase con nombre histórico, hoy router MP/Wompi) → registrado con `useExisting` en `conversations.module.ts:115`. Cualquier cliente que pregunte "¿entró mi pago?" liquida. Además Wompi reintenta 24h, ventana en la que un fix recupera todo. No es pérdida terminal.

3) EL VALOR DEFENSIVO QUE SE PIERDE ES CASI NULO — esto es lo único que le da sustento real al hallazgo. El `eventsSecret` es específico por ambiente y se valida por prefijo: `tenant-wompi.client.ts:42-54` (`environmentForKeys`) exige que pública, privada y events_secret coincidan en ambiente, y `getWompiCredentials` (`tenant-payments.service.ts:792-798`) lo revalida por generación. Un evento de sandbox firmado con el secreto de sandbox NUNCA pasa el checksum contra el secreto de producción, y la lectura canónica va contra la base URL del ambiente. O sea: el checksum YA vincula el ambiente; el campo `environment` es redundante, y ponerlo antes de la firma lo convierte en una vía de rechazo no autenticada. Ese es el argumento correcto para relajarlo — no "el equipo lo dio por verificado".

VERDADERO Y NO REFUTADO: nada en el código garantiza que el payload traiga 'prod' exacto en minúsculas; si el evento real llega sin el campo o como 'production'/'PROD', el 100% de los eventos da 401 y, además, el Ops Center NO monitorea fallos de webhook de tenant-payments (grep de `tenant_payment|tenant-payments` en `health/platform-monitor.service.ts`: cero coincidencias — los contadores `billing:webhook:fail:*` son solo del riel de plataforma), así que el operador no se entera. Y el memory del proyecto registra explícitamente "la entrega del webhook end-to-end" como SIN VERIFICAR contra tráfico real.

SEVERIDAD: baja de P1 a P2. No hay plata mal cobrada (el cliente paga lo que corresponde), ni credencial filtrada, ni fuga cross-tenant; hay riesgo de demora en la liquidación con rescate funcionando, en un modo de falla que se detecta con el primer pago real y se arregla en una línea. Arreglo mínimo y barato, que además cierra una divergencia real con el gemelo de plataforma: normalizar con `.toLowerCase()` (hoy 'PROD' rompe acá y pasa allá) y, si se quiere, exigir el campo solo cuando llega — el binding de ambiente ya lo sostienen el secreto por-ambiente y la lectura canónica. Complemento operativo: agregar un contador/alerta de 401 del webhook de tenant-payments, que es lo que hoy hace que la falla sea muda.

### 23. [P2] El pedido se marca 'paid' aunque la transición del intent no ocurra: el UPDATE del dominio no está condicionado al ledger

- **Dónde:** `apps/api/src/modules/tenant-payments/tenant-payment-store.service.ts:592`
- **Escenario de fallo:** El tenant edita el total del pedido mientras hay un link vivo: llega el primer evento, `payable_snapshot_changed` manda el intent a 'requires_review'. El tenant deshace la edición. Llega un segundo `transaction.updated` limpio y APPROVED: el UPDATE de `orders` corre sin mirar el estado del intent y deja `payment_status='paid'`, pero el UPDATE del intent excluye explícitamente 'requires_review' de las transiciones a 'paid', así que devuelve 0 filas → `transitioned=false` → no se emite `tenant_payment.succeeded` y el intent queda en revisión para siempre. La lista de pedidos dice 'pagado', el ledger dice 'revisar', y nada reconcilia las dos verdades (`getPaymentStatus:1230` hace ganar a requires_review, así que la IA le contesta al cliente que su pago está en revisión sobre un pedido ya marcado como cobrado).
- **Evidencia:** await query(`UPDATE ${parsed.target.table} SET payment_status = $2 ... WHERE id = $1::uuid AND ($2='refunded' OR ...)`, [parsed.entityId, domainStatus]);
const transitioned = await query<IntentRow[]>(`UPDATE tenant_payment_intents ... AND ($2='refunded' OR ($2='paid' AND status NOT IN ('paid','refunded','requires_review','ambiguous')) ...) RETURNING *`, ...);
- **Arreglo:** Invertir el orden: correr primero el UPDATE del intent con RETURNING y escribir el `payment_status` del dominio solo si devolvió fila (o permitir explícitamente requires_review → paid cuando el evento nuevo ya no trae validationError). Ambas sentencias ya están en la misma transacción, así que el cambio es local.
- **Veredicto del refutador:** CONFIRMADO en el código, con el impacto acotado. (1) tenant-payment-store.service.ts:592-602: el UPDATE del pedido solo se guarda contra su propio payment_status, nunca contra el estado del intent. (2) :603-619 (línea 614): el UPDATE del intent excluye 'requires_review' de las transiciones a 'paid' → 0 filas → transitioned=false. La asimetría es real. (3) :512-514 agrava la entrada al estado: con cualquier validationError el normalizedStatus se fuerza a 'requires_review' AUNQUE la transacción sea PENDING (el branch pending de :557 es inalcanzable porque :535 corta antes), así que un solo transaction.updated PENDING durante la ventana de inconsistencia envenena el intent de forma permanente. (4) tenant-wompi-webhook.service.ts:99 confirma que no se emite tenant_payment.succeeded. (5) La cita a getPaymentStatus es correcta: tenant-payments.service.ts:1230 hace ganar requires_review, y payment-operation.service.ts:758-776 devuelve paid:false + shouldHandoff:true, o sea que un cliente que SÍ pagó es escalado a un humano sobre un pedido ya marcado 'paid'. (6) "Nada reconcilia" también es cierto: no hay ningún @Cron en el módulo, tenant-payments.controller.ts no expone ningún endpoint para listar/resolver intents, y 'requires_review' no aparece ni una vez en apps/dashboard/src. El .spec.ts de al lado no cubre este caso (cubre APPROVED limpio, mismatch de monto, segunda APPROVED, duplicado y VOIDED tardío; ninguno parte de un intent ya en revisión). LO QUE ACOTA EL IMPACTO Y JUSTIFICA MANTENER P2, NO SUBIRLO: (a) no hay plata mal cobrada ni perdida — el cobro es real y validado en monto/moneda/dueño, y marcar el pedido 'paid' es el resultado correcto; lo que queda mal es el flag del ledger. (b) El evento faltante hoy no rompe nada: no existe NINGÚN listener de tenant_payment.succeeded en todo apps/api/src (los @OnEvent de pagos son todos de BillingEventType, la suscripción de plataforma). (c) La divergencia "dominio pagado / ledger en revisión" ya es un estado contemplado a propósito por la arquitectura — el comentario en tenant-payments.service.ts:1225-1229 la describe para el caso de la segunda transacción APPROVED y define la autoridad de lectura fail-closed; acá el origen es distinto pero el read path se comporta conservador, no peligroso. (d) La ventana es estrecha: hacen falta DOS eventos con eventKey distinto (el eventKey es el checksum, wompi-event-signature.util.ts:57, y insertAttempt hace ON CONFLICT DO NOTHING, así que un reintento de Wompi es duplicado y no reprocesa), o sea un método asíncrono tipo PSE/Nequi con PENDING→APPROVED, MÁS la edición del payable y su reversión cayendo justo entre ambos. (e) Descarté el camino sin culpa del tenant que habría subido la severidad: un intent en requires_review nacido de markCreationState (tenant-payments.service.ts:1017-1026) nunca devuelve la URL al cliente en ese branch, así que no puede llegar un APPROVED limpio por ahí, y el poll de getPaymentStatus:1180 solo re-consulta intents en ['pending','failed'], nunca rescata un requires_review. Resultado neto: intent trabado para siempre sin superficie de operador + cliente pagador escalado a humano. Fricción y ruido operativo, no dinero ni credenciales.

### 24. [P2] Alquiler vacacional no tiene referencia pagable: create_property_booking no la devuelve y no existe el target 'property'

- **Dónde:** `apps/api/src/modules/tenant-payments/tenant-payment-reference.ts:21`
- **Escenario de fallo:** El cliente reserva la propiedad "Amazon Minimalist" por WhatsApp. create_property_booking persiste la reserva y devuelve {id, totalPrice, currency, status} pero SIN payableReference (ai-tool-executor.service.ts:2297-2312) — a diferencia de tour (2432), pedido (2893), matrícula (3131) y restaurante (4092), que sí la devuelven. list_my_property_bookings tampoco la expone. Y aunque el LLM invente 'property:<uuid>' o 'booking:<uuid>', parsePaymentReference lo rechaza porque PAYMENT_REFERENCE_TARGETS no tiene la clave 'property' (tenant-payment-reference.ts:21-51, sólo order/tour/food/enrollment) → resolveOwnership devuelve owned:false → payment_ownership_unverified + shouldHandoff. Encima property_bookings ni siquiera tiene columna payment_status (apps/api/prisma/tenant-schema.sql:2042-2064), que loadOwnedReference exige leer (tenant-payments.service.ts:1271). Resultado: el vertical de turismo/alquiler — el que el dueño está probando en vivo — no puede cobrar NUNCA una reserva por IA; el cliente escucha "para realizar el pago…" y no llega nada.
- **Evidencia:** tenant-payment-reference.ts:21 → export const PAYMENT_REFERENCE_TARGETS: Record<string, PaymentReferenceTarget> = { order: {...}, tour: {...}, food: {...}, enrollment: {...} };  // no hay 'property'

ai-tool-executor.service.ts:2297-2311 → return { success: true, booking: { id, propertyId, checkIn, checkOut, nights, nightPrice, cleaningFee, totalPrice, currency, status, guestName } };  // sin payableReference

ai-tool-executor.service.ts:1173 → private payableReference(kind: 'order' | 'tour' | 'food' | 'enrollment', ...)
- **Arreglo:** Migración aditiva (expand-contract): ALTER TABLE property_bookings ADD COLUMN IF NOT EXISTS payment_status VARCHAR(50) DEFAULT 'pending'. Agregar el target property en PAYMENT_REFERENCE_TARGETS (table 'property_bookings', amountExpression 'target.total_price', currencyExpression 'target.currency', rejectedStatuses ['cancelled','refunded']), sumar 'property' al tipo kind de payableReference (ai-tool-executor.service.ts:1173) y devolver payableReference en createPropertyBooking y listMyPropertyBookings igual que ya lo hace createTourBooking.
- **Veredicto del refutador:** El hallazgo es REAL en todos sus anclajes, pero el impacto está exagerado.

VERIFICADO:
1. `apps/api/src/modules/tenant-payments/tenant-payment-reference.ts:12-13` tipa `table: 'orders' | 'tour_bookings' | 'food_orders' | 'enrollments'` y `:21-51` define exactamente esas 4 claves. `parsePaymentReference` devuelve `null` si `PAYMENT_REFERENCE_TARGETS[kind]` no existe (`:65-66`). No hay 'property'.
2. `apps/api/src/modules/conversations/ai-tool-executor.service.ts:2297-2312` — `createPropertyBooking` retorna `{success:true, booking:{id, propertyId, checkIn, checkOut, nights, nightPrice, cleaningFee, totalPrice, currency, status, guestName}}`, sin `payableReference`. Y `:1172-1177` tipa `payableReference(kind: 'order'|'tour'|'food'|'enrollment', ...)`, así que ni siquiera podría emitirla. Contraste confirmado por grep: sí la emiten `:977`/`:1146` (order), `:2432`/`:4030` (tour), `:2893`/`:4092`/`:4123` (food), `:3131`/`:4235` (enrollment). Ninguna línea la emite para property.
3. `apps/api/prisma/tenant-schema.sql:2042-2064` — `property_bookings` no tiene `payment_status` (las 4 tablas cubiertas sí: líneas 456, 2166, 2428, 2654). `loadOwnedReference` (`tenant-payments.service.ts:1272`) hace `SELECT ... target.payment_status`, así que agregar un target 'property' ingenuamente también fallaría.
4. Camino de fallo confirmado: `active-operations-context.service.ts:568-591` mete en el TurnContext `{type:'property', id:<uuid del booking>}` — o sea, el modelo tiene el material exacto para inventar `property:<uuid>`. Eso muere en `parsePaymentReference` → `resolveOwnership` → `resolveCanonicalPayable` devuelve null (`payment-operation.service.ts:652-681`) → `preparePaymentLink` retorna `payment_ownership_unverified` + `shouldHandoff:true` (`:258-268`).
5. No hay escape manual: `tenant-payments.controller.ts` sólo expone config (`:25-99`) y webhooks (`:114-131`). El único llamador de `createPaymentLink` fuera del módulo es el ejecutor de IA (`ai-tool-executor.service.ts:293`). Tampoco `PropertiesService.createBooking` (`apps/api/src/modules/vacation-rental/properties.service.ts:379-...`) crea una fila en `orders` que diera referencia por la vía 'order'.
6. El alcance documentado SÍ prometía esto: `docs/tenant-customer-payments-wompi.md:5-7` dice que el riel cobra "pedidos, **reservas**, matrículas u otros objetos comerciales", y la UI lo vende como "señas, anticipos y pedidos" (`apps/dashboard/messages/es.json:1319`). Las señas/anticipos son justo el caso de alquiler vacacional.
7. No hay ningún test que cubra property como pagable (grep en `ai-tool-executor.vertical-safety.spec.ts` y `tenant-payments.service.spec.ts`: cero menciones de property), ni una nota de alcance que lo excluya (la única nota "payment v1" es la de refund, `tools/payment-tools.ts:39`).

DONDE EL HALLAZGO EXAGERA (por eso bajo P1 → P2):
a) "El vertical de turismo no puede cobrar NUNCA" es falso: `tour_bookings` está cubierto de punta a punta (`ai-tool-executor.service.ts:2432` en la creación y `:4030` en el listado). Lo que no puede cobrar es sólo *alquiler vacacional* (properties), no turismo entero.
b) Lo mismo pasa con `appointments`, que tampoco está en `PAYMENT_REFERENCE_TARGETS` — o sea, esto es un alcance v1 de 4 objetos de catálogo, no un olvido específico de alquiler. El hueco es más ancho de lo que dice el hallazgo, pero también menos "bug de un vertical" y más "capacidad no construida".
c) El sistema FALLA CERRADO: nadie cobra de más, no se pierde plata, no se filtra credencial ni datos de otro tenant. El guard devuelve `payment_ownership_unverified` + `shouldHandoff:true` con mensaje explícito ("No se pudo demostrar que esta compra pertenece al contacto"), y la descripción de la tool (`tools/payment-tools.ts:9-11`) prohíbe inventar o reusar una URL. El resultado realista es escalamiento a humano, no el "cliente escucha 'para realizar el pago…' y no llega nada" que describe el escenario.

Conclusión: defecto real y accionable (gap entre alcance documentado/vendido y lo implementado, con una tabla que ni siquiera tiene la columna que el resolver exige), pero sin riesgo de dinero mal cobrado ni de credencial; corresponde P2.

### 25. [P2] El clasificador de confirmación rechaza 'Sí, confirmo': no normaliza puntuación interna

- **Dónde:** `apps/api/src/modules/conversations/tool-execution-control.service.ts:149`
- **Escenario de fallo:** La IA pide la confirmación explícita que exige el guard ('Pide al cliente confirmar explícitamente $150.000 por Pago de reserva…'). El cliente responde 'Sí, confirmo' o 'Ok, dale'. classifyExplicitToolConfirmation normaliza acentos y sólo recorta la puntuación FINAL (/[.!¡¿?]+$/), así que queda 'si, confirmo' — que no coincide con la alternativa 'si confirmo' del regex — y devuelve 'unclear' → confirmationRequired otra vez. El cliente confirmó de forma inequívoca y el sistema vuelve a preguntar; el link no se emite en ese turno y el diálogo puede quedar en bucle hasta que el cliente conteste exactamente 'si' o 'dale'. Falla cerrado (no hay plata mal movida) pero bloquea la venta.
- **Evidencia:** tool-execution-control.service.ts:149-156 →
        .replace(/[.!¡¿?]+$/g, '')
        .replace(/\s+/g, ' ');
    ...
    if (/^(si|confirmo|si confirmo|autorizo|si autorizo|dale|hazlo|ok|okay|yes|i confirm|confirm|go ahead|sim|confirmo sim|autorizo sim|pode fazer|oui|je confirme|confirme|allez-y)$/.test(normalized)) {
- **Arreglo:** Normalizar también comas y puntuación interna antes del match (por ejemplo .replace(/[.,;:!¡¿?]+/g, ' ') seguido del colapso de espacios) manteniendo la lista blanca cerrada; así 'Sí, confirmo' y 'Ok, dale' caen en las alternativas ya existentes sin ampliar el vocabulario aceptado.
- **Veredicto del refutador:** CONFIRMADO, con el impacto acotado tal como lo reclama (P2, falla cerrada).

1) La cita es exacta y no está fuera de contexto. tool-execution-control.service.ts:144-151 normaliza NFD + sin diacríticos + trim + toLowerCase + `.replace(/[.!¡¿?]+$/g, '')` + colapso de espacios. El `$` ancla la puntuación al FINAL y la coma ni siquiera figura en la clase de caracteres, así que la coma interna sobrevive. El regex de la línea 156 está anclado `^...$` con la alternativa `si confirmo` (sin coma), de modo que "Sí, confirmo" -> "si, confirmo" cae al `return 'unclear'` de la línea 159. Igual "Ok, dale" -> "ok, dale".

2) No hay guarda aguas arriba que lo impida. Grep de `classifyExplicitToolConfirmation` sobre apps/ devuelve SOLO la definición (línea 142), un llamador (línea 1267) y el spec. El llamador pasa `latest.content_text` crudo, leído por `latestInboundMessage` (líneas 1619-1624, `SELECT id, content_text`). Nada limpia comas antes.

3) El escenario es alcanzable en el camino de pago. tool-policy-registry.ts:171-182 declara `create_payment_link` con `confirmation: 'runtime_enforced'`, por lo que preflight (línea 855) entra siempre a `resolveConfirmation`. Con disposición `unclear`, la línea 1276 devuelve `confirmationRequired(ledger.id)` y payment-operation.service.ts:302 reemite el mismo pedido ("Pide al cliente confirmar explícitamente $X por Y") sin informar nunca qué vocabulario acepta el guard. El turno se pierde y el link no se emite.

4) No hay test que lo cubra. tool-execution-control.service.spec.ts:260-270 prueba 'sí', 'I confirm', 'pode fazer', 'je confirme' como confirmed y 'quizás', 'yes, but change the amount', 'I said yes yesterday' como unclear. Ninguna variante con coma interna.

Por qué NO sube de P2: falla cerrada (no se emite link ni se mueve plata; el ledger queda en awaiting_confirmation con el token firmado vivo, TTL 15 min, línea 13) y es recuperable en el turno siguiente, porque en la línea 1266 `latest.id !== ledger.confirmation_source_message_id` y un "si" pelado sí confirma. No hay estado corrupto ni bloqueo permanente.

Matices que el hallazgo no dice: (a) el comentario de la línea 141 ("Exact, deliberately narrow confirmations") muestra que la lista corta es decisión de diseño; lo defectuoso es la INCONSISTENCIA — se normaliza acento y puntuación final ("Sí." pasa) pero no la coma ("Sí," no pasa), distinción invisible para el cliente. (b) El mismo hueco afecta la rama de rechazo de la línea 153: "No, cancela" -> unclear en vez de rejected (también falla cerrado). (c) Hablar de "bucle" exagera: solo persiste si el cliente repite puntuación interna en cada turno. (d) El arreglo es seguro: quitar comas antes del match deja "no, confirmo" -> "no confirmo" y "si, no" -> "si no" en unclear, sin ampliar la superficie de confirmación ambigua.

### 26. [P2] Todo rechazo del backend se muestra como "Error 400": el motivo real se descarta

- **Dónde:** `apps/dashboard/src/app/admin/settings/integrations/payments/page.tsx:145`
- **Escenario de fallo:** El dueño elige "Producción" en el select pero pega llaves mezcladas (p.ej. pub_test_ con prv_prod_). El backend rechaza con `new BadRequestException({ error: 'invalid_wompi_key_set' })` (tenant-payments.service.ts:488). Como NestJS usa el objeto tal cual como cuerpo HTTP, la respuesta NO trae `message`, así que apiPut (api.ts:2320) arma `error: json.message || `Error ${res.status}`` = "Error 400" y guarda el código estable en `errorCode`. La página nunca lee `errorCode`, así que el banner rojo dice literalmente "Error 400". Lo mismo pasa con `invalid_wompi_credentials` (el comercio no existe en ese ambiente), `payment_provider_not_ready`, `tenant_payment_config_changed` (409) y `customer_payments_not_entitled`. El dueño no tiene forma de saber si el problema son las llaves, el ambiente, el plan o una edición concurrente.
- **Evidencia:** setFeedback({ ok: false, text: res?.error || t("invalidCredentials") });  // idéntico en handleActivate:162 y handleDisconnect:179
- **Arreglo:** Leer `res.errorCode` y mapearlo a claves i18n (tenantPayments.errors.*) en los 4 JSON, con `invalidCredentials` como fallback — exactamente el patrón que ya usa la pantalla hermana del switch de plataforma en apps/dashboard/src/app/admin/plans/_components/ProvidersTab.tsx:197 (`ERROR_KEY_BY_CODE[res.errorCode]`).
- **Veredicto del refutador:** CONFIRMADO en lo esencial, con dos correcciones que acotan el alcance.

Cadena verificada extremo a extremo:

1. apps/dashboard/src/app/admin/settings/integrations/payments/page.tsx:145 dice literalmente `setFeedback({ ok: false, text: res?.error || t("invalidCredentials") })`. Leí el archivo completo (423 líneas): la cadena "errorCode" NO aparece ni una vez. Idéntico en handleActivate:162.

2. apps/dashboard/src/lib/api.ts:2320 (apiPut): `if (!res.ok) return { success: false, error: json.message || `Error ${res.status}`, errorCode: json.error };`. El motivo estable queda en `errorCode`, que la página nunca lee. Mismo patrón en apiGet:2292, apiPost:2306, apiPatch:2334.

3. apps/api/src/modules/tenant-payments/tenant-payments.service.ts:488 lanza `new BadRequestException({ error: 'invalid_wompi_key_set' })`. NestJS `HttpException.createBody` devuelve el objeto tal cual cuando no es string, así que el cuerpo HTTP es exactamente `{"error":"invalid_wompi_key_set"}`: sin `message`, sin `statusCode`. Verifiqué que NO hay nada que lo reescriba: `grep -rn "ExceptionFilter|useGlobalFilters|@Catch"` sobre apps/api/src devuelve CERO resultados, y main.ts solo registra un ValidationPipe (main.ts:96). El controller usa `@Body() body: any` sin DTO, así que el pipe tampoco interviene.

4. El escenario disparador es alcanzable, no hipotético: apps/api/src/modules/tenant-payments/tenant-wompi.client.ts:47-53, `environmentForKeys` devuelve `null` si `publicEnv !== privateEnv` (línea 51) y también si `input.environment !== publicEnv` (línea 52). Mezclar pub_test_ con prv_prod_, o elegir "Producción" con llaves de test, cae en la línea 488. No hay guarda aguas arriba que lo impida: el early-return del cliente (page.tsx:112) solo chequea que los campos no estén vacíos, no su coherencia.

5. No hay mapa de códigos en i18n: `tenantPayments` tiene 50 claves en los 4 idiomas y ninguna es un diccionario de errores. La convención SÍ existe en el proyecto — apps/dashboard/src/app/admin/plans/_components/ProvidersTab.tsx:197 usa `ERROR_KEY_BY_CODE[res.errorCode]` — esta página simplemente no la aplicó. No hay .spec.ts de la página que cubra esto.

DOS AFIRMACIONES DEL HALLAZGO QUE NO SOBREVIVEN:

a) "lo mismo pasa en handleDisconnect:179" es FALSO. Esa ruta llama `api.disconnectTenantPaymentsProvider` (api.ts:1427) que usa `apiDelete`, y apiDelete es la excepción del archivo: api.ts:2360-2361 hace `const code = typeof json.error === "string" ? json.error : undefined; return { ..., error: json.message || code || `Error ${res.status}` }`, con un comentario en 2351-2353 que documenta que ese mismo bug ya se arregló para los guards de purga. Disconnect muestra el código crudo (p.ej. "tenant_payment_provider_busy" de service:2040), en inglés y sin traducir, pero NO "Error 409".

b) El código de plan es `customer_payments_not_available_on_plan` (service:2018), no `customer_payments_not_entitled`.

IMPACTO REAL Y AJUSTE DE SEVERIDAD: el camino de guardado es fail-closed. `assertCustomerPaymentsEntitled` (service:319 y :529) y el chequeo de hash (service:531) corren ANTES de cualquier escritura, y la excepción aborta antes de `mutateStoredConfigLocked`. No se persiste nada, no se mueve plata, no se filtra credencial, ningún tenant ve datos de otro. El daño es exclusivamente de diagnosticabilidad: el dueño que acaba de cargar una cuenta Wompi real en producción no puede distinguir un desajuste de llaves/ambiente, de un gate de plan, de una edición concurrente (409 tenant_payment_config_changed, service:532) — ve "Error 400"/"Error 409" y nada más. Es real y molesto en el momento exacto en que el dueño lo necesita, pero no califica como P1 porque no hay pérdida de plata, credencial ni datos. P2.

### 27. [P2] Un proveedor en sandbox activo se ve idéntico a uno en producción

- **Dónde:** `apps/dashboard/src/app/admin/settings/integrations/payments/page.tsx:264`
- **Escenario de fallo:** El dueño guarda llaves de prueba (pub_test_/prv_test_/test_events_) y activa. La cabecera muestra la píldora verde "Cuenta identificada", la tarjeta muestra verde "Listo" y aparece "Usado por el agente" en índigo. Ninguna píldora renderiza `state.environment`. El backend tampoco bloquea: ni `activationReady` (tenant-payments.service.ts:272) ni `activateProvider` (609-633) miran el ambiente. Resultado: el agente empieza a mandar enlaces del checkout sandbox a clientes reales, nadie paga plata real y el panel informa una conexión sana. El único rastro del ambiente es el `<select>` editable de más abajo (page.tsx:365), cuyo valor es estado local — si el dueño lo cambia a "Producción" y no guarda, la pantalla muestra "Producción" mientras lo almacenado sigue siendo sandbox, sin ningún indicador de cambios sin guardar.
- **Evidencia:** {state.verified && <StatusPill tone="green" text={t("accountVerified")} />}
{isActive && state.ready && <StatusPill tone="indigo" text={t("activeForAgent")} />}
- **Arreglo:** Renderizar el ambiente devuelto por el servidor como píldora al lado del nombre del proveedor (ámbar "PRUEBAS" cuando `state.environment === 'sandbox'`, ya viene en la respuesta: tenant-payments.service.ts:268) y mostrar un aviso bloqueante/ámbar cuando el proveedor ACTIVO está en sandbox. Nuevas claves en los 4 JSON.
- **Veredicto del refutador:** El núcleo del hallazgo se sostiene, pero dos sub-afirmaciones son falsas y el impacto está inflado.

LO QUE EL CÓDIGO CONFIRMA:
1) page.tsx:264-265 está citado textual y en contexto. Las píldoras de cabecera son solo accountVerified (verde) y activeForAgent (índigo); las tarjetas de proveedor (page.tsx:249-250) solo active/ready/setupIncomplete. Ninguna renderiza state.environment. Verificado por grep: las únicas dos referencias a `.environment` en toda la carpeta payments/ son page.tsx:42 (la proyección) y page.tsx:87 (hidratar el select).
2) tenant-payments.service.ts:272 `activationReady: wompiConnected && !!wompi.verifiedAt && !!wompi.webhookTokenEnc && !!wompiWebhookUrl` — sin ambiente. isStoredProviderActivationReady (1740-1746) exige `!!config.environment` solo como EXISTENCIA, nunca === 'production'. activateProvider (609-633) no agrega guarda. Las tres citas son exactas.
3) Sandbox es un estado activable de primera clase: environmentForKeys (tenant-wompi.client.ts:42-54) acepta el triple consistente pub_test_/prv_test_/test_events_; verifyMerchant (56-75) pega a https://sandbox.wompi.co/v1 y al responder OK setea verifiedAt → píldora verde "Cuenta identificada". Luego activationReady=true → "Usar con el agente" → activeProvider='wompi' + webhookAcknowledgedAt → ready=true → píldora índigo. Panel 100% sano en sandbox.
4) La escalada a clientes reales NO tiene guarda: `grep -n environment` sobre conversations/payment-operation.service.ts, tools/payment-tools.ts y payment-tool-registration.ts devuelve CERO coincidencias. Nada en el camino IA distingue riel de prueba de riel real.
5) Peor de lo que dice el hallazgo: tenant-wompi.client.ts:206 devuelve `https://checkout.wompi.co/l/${id}` para AMBOS ambientes, así que el enlace que recibe el cliente final es indistinguible de uno de producción por el host.

DONDE EL HALLAZGO SE EQUIVOCA (baja la severidad):
a) "El único rastro del ambiente es el <select> ... cuyo valor es estado local" — FALSO en lo material. El select se hidrata desde la config persistida en page.tsx:87 (`setWompiEnvironment(wompi.environment || "sandbox")`) dentro de load(), que se re-llama tras cada save/activate/disconnect (líneas 143, 160, 177) y al montar (98). En cualquier vista normal dice fielmente "Pruebas (sandbox)", bajo una etiqueta "Ambiente", una sección debajo de la cabecera.
b) "Si lo cambia a Producción y no guarda ... sin ningún indicador de cambios sin guardar" — el escenario peligroso NO puede persistir ni pasar en silencio. Al guardar con el select en producción y llaves test almacenadas, environmentForKeys retorna null (client línea 52: `input.environment !== publicEnv`) y el servicio tira BadRequest `invalid_wompi_key_set` (487-488), que la UI muestra en el Notice rojo (page.tsx:145, 219-228). Y cualquier recarga resetea el select.
c) Mitigación omitida: el confirm de activación nombra explícitamente el ambiente — es.json:18 "confirma que copiaste la URL de eventos ... y la configuraste en el comercio y AMBIENTE correctos de Wompi" — disparado en page.tsx:152, justo al armar el riel.

VEREDICTO: defecto real (falta indicador de ambiente en las píldoras + cero gate de sandbox en activación y en el camino IA), pero no es un estado que el sistema produzca por error: exige que el tenant_admin vaya a buscar y pegue deliberadamente llaves de sandbox, el ambiente real SÍ se muestra en la misma pantalla y el confirm de activación lo nombra. No hay fuga de credencial, ni cruce entre tenants, ni monto mal cobrado. El riesgo residual real es que el camino previsto "probar y después cambiar" no tiene aviso persistente ni estado visual distinto en las píldoras que el dueño realmente lee. Eso es P2, no P1.

### 28. [P2] cfg.provider es un placeholder, no el proveedor activo: guardar Mercado Pago lo activa solo

- **Dónde:** `apps/dashboard/src/app/admin/settings/integrations/payments/page.tsx:102`
- **Escenario de fallo:** Cuando no hay proveedor activo, getConfig devuelve `activeProvider: null` pero esparce un objeto de relleno cuyo `provider` es SIEMPRE 'mercadopago' (tenant-payments.service.ts:281-288). La página hace `cfg.activeProvider || cfg.provider`, así que `activeProvider` local vale 'mercadopago' y `isActive` da true estando parado en la pestaña de Mercado Pago. Entonces handleSave manda `activate: isActive || !activeProvider` = true (page.tsx:132), y el servicio ejecuta `latest.activeProvider = provider` (540-545). Escenario: el dueño, con Wompi todavía sin quedar listo, guarda las credenciales de Mercado Pago sólo para dejarlas cargadas — y Mercado Pago queda de inmediato como el riel de cobro vivo del agente, sin ninguna confirmación, mientras que para Wompi la misma pantalla exige un confirm explícito. Los clientes empiezan a recibir enlaces de una cuenta que el dueño no eligió activar.
- **Evidencia:** const activeProvider = cfg.activeProvider || cfg.provider;
const isActive = activeProvider === provider;
- **Arreglo:** Usar sólo `cfg.activeProvider` para decidir `isActive` (nunca `cfg.provider`, que es relleno) y mandar `activate` en el save de Mercado Pago sólo cuando ese proveedor ya era el activo; para activarlo de cero, exigir el mismo botón "Usar con el agente" que usa Wompi.
- **Veredicto del refutador:** VERIFIQUÉ LA CITA (es literal, pero la cadena causal es falsa).

1) La línea existe tal cual: `apps/dashboard/src/app/admin/settings/integrations/payments/page.tsx:102-103` dice `const activeProvider = cfg.activeProvider || cfg.provider; const isActive = activeProvider === provider;`. Y el relleno del backend existe: `tenant-payments.service.ts:281-288` devuelve `{version:2, activeProvider, providers, ...active}` donde `active` es `{provider:'mercadopago', connected:false, ready:false, ...}` cuando `activeProvider` es null; el tipo lo expone (`apps/dashboard/src/lib/api.ts:210 provider?: TenantPaymentProvider`). Hasta ahí el hallazgo tiene razón.

2) PERO EL PLACEHOLDER ES UN NO-OP EN LA EXPRESIÓN QUE MUEVE PLATA. `handleSave` manda `activate: isActive || !activeProvider` (page.tsx:132). Enumeré los dos estados posibles:
   - `cfg.activeProvider` no-null → el `||` nunca llega a `cfg.provider`; el placeholder no participa.
   - `cfg.activeProvider` null → CON placeholder: `activeProvider='mercadopago'`, en la pestaña MP `isActive=true` → activate=true. SIN placeholder: `activeProvider=undefined`, `isActive=false`, pero `!activeProvider=true` → activate=true.
   El valor enviado es IDÉNTICO en todos los estados. O sea: el relleno `provider:'mercadopago'` no causa ninguna activación. Lo que activa es el fallback deliberado `|| !activeProvider`. El hallazgo culpa a la línea equivocada.

3) LA ACTIVACIÓN AL GUARDAR ES DISEÑO EXPLÍCITO Y TESTEADO, NO UN ACCIDENTE. `tenant-payments.service.ts:314-318` documenta que `activate` es "a legacy MP convenience flag" e intencionalmente se IGNORA para Wompi; el gate está en 540-545 (`provider==='mercadopago' && (input.activate===true || !input.provider) && !disabledAt`). Hay test que lo fija: `tenant-payments.service.spec.ts:688-706` guarda MP con `activate:true` y espera `{activeProvider:'mercadopago', ready:true}`.

4) EL RIEL WOMPI SANO NO SE PUEDE SECUESTRAR (esto es lo que más importa para el dueño, que acaba de configurar Wompi real). Si Wompi está activo Y ready, `getConfig` (278-280) devuelve `activeProvider='wompi'`, entonces en la pestaña MP: `isActive=false` y `!activeProvider=false` → `activate:false`. Y la segunda rama del backend (`!input.provider`) tampoco puede disparar porque el dashboard SIEMPRE manda `provider:'mercadopago'` en el body (page.tsx:130-131). Guardar MP con Wompi vivo NO cambia el riel. El escenario "los clientes empiezan a recibir enlaces de una cuenta que el dueño no eligió" con Wompi funcionando es imposible.

5) EL ESTADO REQUERIDO ES CARO DE ALCANZAR Y AUTOINFLIGIDO. MP sólo pasa a ser el riel efectivo si `mpState.ready` (241): token verificado CONTRA MERCADO PAGO por red (`verifyMpToken`, 395-403, tira `invalid_mp_credentials` si falla) + webhook secret tipeado a mano (424-426 rechaza secret sin token). Y el endpoint es `@Roles('tenant_admin')` (controller:26-27, 35-37). O sea: el propio dueño tipea las credenciales vivas de SU cuenta y aprieta Guardar, y no había ningún riel operativo antes (si lo hubiera, ver punto 4). La plata va a la cuenta que él acaba de cargar. No hay fuga de credencial, no hay cruce entre tenants, no hay pago desviado a un tercero.

LO QUE SÍ SOBREVIVE (redefinido, y NO es lo que dice el hallazgo):
   a) El placeholder sí produce una MENTIRA EN PANTALLA. Con `stored.activeProvider='wompi'` pero Wompi no-ready (p.ej. tras un cambio material que limpia `webhookAcknowledgedAt`, 524), `getConfig` devuelve `activeProvider:null` (278-280) y el relleno pone `provider:'mercadopago'` → la tarjeta MP muestra el pill "Activo" (page.tsx:249) y "activeForAgent" (265) cuando NO hay ningún riel activo y el agente no puede cobrar nada (`createPaymentLink` corta en 878-881 con `payments_not_configured`). Además en ese estado el botón "usar para el agente" queda OCULTO para MP por la condición `(!isActive || !state.ready)` (271). Es un defecto real de UI/UX, pero no mueve un peso.
   b) La asimetría de consentimiento es real: guardar MP lo pone en vivo sin confirmación, mientras Wompi exige `window.confirm` (152) + `activateProvider` (617-628). El riesgo concreto no es el que describe el hallazgo sino SANDBOX: `mercadoPagoEnvironmentForToken` acepta entorno sandbox y `mpState.ready` no exige producción (241), y `createPaymentLink` no tiene gate de entorno para MP (sólo el `wompi_cop_only` de 884). Un dueño que guarda credenciales MP de prueba "para dejarlas cargadas" queda con un riel de PRUEBA vivo y el agente manda checkouts de sandbox a clientes reales → cobro que nunca se acredita.

CONCLUSIÓN: el mecanismo citado está refutado (el placeholder es demostrablemente un no-op para `activate`), el impacto de plata está exagerado (el Wompi configurado no se puede pisar, la cuenta activada es la que el propio admin acaba de verificar), pero el comportamiento "guardar MP = riel vivo sin confirmar" sí ocurre y arrastra el riesgo sandbox. Queda en P2 solo por (a) el badge "Activo" falso y (b) la falta de confirmación/gate de entorno en MP — no por la causa que el hallazgo afirma.

### 29. [P2] El toggle de Cobros a clientes se pinta apagado aunque esté guardado como activo

- **Dónde:** `apps/dashboard/src/app/admin/agent/_components/CapabilitiesSection.tsx:487`
- **Escenario de fallo:** Un tenant que tenía cobros habilitados baja a un plan sin `customerPayments`. La tarjeta calcula el color del switch como `payments.enabled && customerPaymentsAllowed`, así que se ve gris (=apagado) aunque `config.tools.payments.enabled` siga siendo `true` en la persona guardada. El onClick hace `enabled: payments.enabled ? false : true`: el dueño ve el switch apagado, lo pulsa creyendo que lo enciende y en realidad escribe `false`; lo pulsa de nuevo y escribe `true`, y sigue viéndose gris. La pantalla nunca refleja lo que está guardado. Las demás herramientas no tienen el problema porque ToolToggleCard colorea sólo desde `enabled` (línea 606).
- **Evidencia:** payments.enabled && customerPaymentsAllowed ? "bg-indigo-500" : "bg-neutral-300 dark:bg-neutral-600"
// y el knob en la línea 492 con la misma condición
- **Arreglo:** Colorear el switch y posicionar el knob desde `payments.enabled` solamente, y expresar la falta de plan con el badge/aviso que ya existe (líneas 464-466 y 497-504) en vez de mintiendo sobre el estado guardado.
- **Veredicto del refutador:** La evidencia es literal y el defecto de render existe: CapabilitiesSection.tsx:487 y :492 derivan color y posición del knob de `payments.enabled && customerPaymentsAllowed`, mientras ToolToggleCard (:606/:611) colorea solo desde `enabled`. El estado que lo dispara (config.tools.payments.enabled=true con features.customerPayments=false) SÍ es alcanzable: la guarda de escritura persona.controller.ts:44-61 (rejectUnavailableCustomerPayments) sólo bloquea guardados nuevos, no normaliza ni reescribe filas ya persistidas, así que un downgrade (o un super_admin editando billing_plans.features desde /admin/plans) lo produce. Además la UI y el backend leen la misma fuente (persona.controller.ts:421-426 → throttleService.getPlanFeatures con overrides; mismo origen que isFeatureEnabled, tenant-throttle.service.ts:67), así que no hay divergencia que lo agrande ni que lo desmienta. No hay .spec para el componente (apps/dashboard/src/app/admin/agent/** sin specs).

Pero el escenario reclamado está mal en dos puntos y el impacto está inflado: (1) NO hay bucle de dos clics — `disabled={planLoading || (!customerPaymentsAllowed && !payments.enabled)}` (:474) deja el botón habilitado sólo mientras enabled=true; el primer clic escribe false y a partir de ahí el botón queda DESHABILITADO, o sea es un apagado silencioso de una sola vía, nunca "lo pulsa de nuevo y escribe true". (2) La pantalla no engaña en silencio: con !customerPaymentsAllowed se muestran el badge paymentsPlanBadge (:464-466) y el aviso ámbar paymentsPlanRequired con link de upgrade (:497-504), presentes en los 4 idiomas (messages/{es,en,pt,fr}.json:3540-3541), o sea el gris viene con explicación. (3) Impacto: cero plata y cero credencial — bajo ese plan la herramienta ya estaba bloqueada en runtime por payment-operation.service.ts:725 y tenant-payments.service.ts:1998. El daño real es la pérdida silenciosa del flag guardado (al volver a subir de plan aparece apagado) y que el control no representa lo persistido.

Matiz que el hallazgo omite y que es lo más operativo: mientras payments.enabled siga true con plan sin la feature, TODO guardado del agente se rechaza en persona.controller.ts:452-453 y :528-529 con {success:false, message:'Los cobros a clientes no están disponibles en tu plan actual.'}, y el usuario no puede deducir que el remedio es pulsar ese mismo switch que ve apagado.

Queda en P2: real, sin impacto en dinero ni credenciales, requiere un downgrade previo, y no toca el caso actual del dueño (plan con customerPayments → el switch pinta bien).

### 30. [P2] Todo rechazo del webhook Wompi del tenant es invisible: sin log, sin Sentry y sin incidente en el Ops Center

- **Dónde:** `apps/api/src/app.module.ts:169`
- **Escenario de fallo:** El dueño pega mal el `events_secret` de su cuenta Wompi real (o Wompi lo rota, o guarda credenciales de sandbox y configura la URL en el panel de producción). Wompi postea a /api/v1/tenant-payments/webhook/wompi/{tenantId}/{token} y `verifyWompiEventSignature` falla -> `UnauthorizedException` -> HTTP 401. Ese 401 NO deja rastro en ningún lado: (a) pino no loguea la request porque el prefijo completo está en `autoLogging.ignore` (app.module.ts:169); (b) Sentry no lo captura porque `SentryGlobalFilter` trata todo `HttpException` como 'expected error' (node_modules/@sentry/nestjs/build/cjs/setup.js:129 + helpers.js:22-28); (c) `tenant-wompi-webhook.service.ts` lanza sin ningún `logger.warn` previo en las 4 rutas de rechazo (líneas 31, 39, 47, 52); (d) no se incrementa ningún contador tipo `billing:webhook:fail:*`, que es justamente lo que el Ops Center barre para levantar el incidente 'webhooks con firma rechazada' (platform-monitor.service.ts:694-738). Wompi reintenta 3 veces en 24h y abandona. Resultado: el cliente final pagó de verdad, el pedido/cita nunca pasa a 'paid', y Grafana, Loki, Sentry y /admin/ops están todos en verde. El dueño se entera por un cliente enojado, sin ninguna evidencia para diagnosticar.
- **Evidencia:** app.module.ts:161-171 -> `autoLogging: { ignore: (req) => ['/api/v1/health','/docs','/admin/queues','/api/v1/tenant-payments/webhook/wompi/'].some(p => req.url?.startsWith(p)) }`

tenant-wompi-webhook.service.ts:46-48 -> `if (!signature.valid || !signature.eventKey) { throw new UnauthorizedException(`invalid_wompi_event_signature:${signature.reason || 'unknown'}`); }`  // sin logger.warn, sin contador

Contraste con el riel de plataforma, que SÍ instrumenta: billing/webhook.controller.ts:170 -> `const key = `billing:webhook:fail:${provider}:${kind}:${day}`;`
- **Arreglo:** Antes de cada `throw` en `TenantWompiWebhookService.process` (líneas 31, 39, 47, 52) incrementar el mismo contador que ya barre el Ops Center, p.ej. `billing:webhook:fail:wompi_tenant:signature:{YYYY-MM-DD}` / `:processing:`, y agregar el proveedor 'wompi_tenant' a la lista que recorre platform-monitor.service.ts:694. Además, cambiar el `autoLogging.ignore` por un `customSuccessMessage`/`customProps` que enmascare solo el último segmento de la ruta en vez de suprimir la request entera: hoy se pierde el registro completo para proteger un token que igual viaja a Sentry (ver hallazgo siguiente).
- **Veredicto del refutador:** Intenté derribarlo por cinco vías y las cinco confirman el hallazgo; solo el impacto está algo inflado.

1) La cita de pino es exacta y el efecto es el que dice. `apps/api/src/app.module.ts:161-171` pone `'/api/v1/tenant-payments/webhook/wompi/'` en `autoLogging.ignore`, y el prefijo global es `api/v1` (`apps/api/src/main.ts:104`), así que `req.url` de esa ruta empieza justo con ese string. Verifiqué el comportamiento real de la librería en `node_modules/pino-http/logger.js:181-201`: cuando `autoLoggingIgnore(req)` da true, `shouldLogSuccess=false` y NO se registran los listeners de `'close'`/`'finish'`; solo queda `res.on('error')`. Un 401 emitido por un exception filter termina la respuesta normalmente (nunca dispara `'error'`), así que la request no deja ninguna línea de log. La rama `if (err || res.err || res.statusCode >= 500)` de `onResFinished` ni siquiera se alcanza.

2) Sentry tampoco lo ve. `SentryGlobalFilter` está registrado como `APP_FILTER` en `app.module.ts:115`, y en `node_modules/@sentry/nestjs/build/cjs/setup.js` la rama HTTP hace `if (!helpers.isExpectedError(exception)) captureException(...)`; `helpers.js:14-34` devuelve `true` para cualquier objeto con `getStatus`/`getResponse`/`initMessage`, que es exactamente `UnauthorizedException`. Además `SentryGlobalFilter` extiende `BaseExceptionFilter`, que solo loguea excepciones NO-HttpException. Revisé `main.ts:37-82`: los tres middlewares son helmet/CORS, ninguno loguea errores. No hay otro `useGlobalFilters` en el repo.

3) Las 4 rutas de rechazo efectivamente no dejan rastro. `tenant-wompi-webhook.service.ts:31` (token de callback inválido), `:39` (mismatch de entorno), `:47` (firma inválida) y `:52` (transaction id inválido) lanzan sin un solo `logger.*` previo — y el contraste está en el MISMO archivo: las rutas 5xx sí loguean (`:63` y `:80`). El servicio hermano de MercadoPago sí instrumenta (`tenant-payments-webhook.service.ts:132,142,182,285,321,323`). O sea: la asimetría es del código, no de mi lectura.

4) El Ops Center no puede verlo. `platform-monitor.service.ts:694` solo lee `billing:webhook:fail:{provider}:{kind}:{day}`, y el ÚNICO escritor de esas claves en todo el repo es `billing/webhook.controller.ts:170` (riel de plataforma). Grepeé `webhook:fail` en `apps/api/src`: cero ocurrencias en `tenant-payments/`. El incidente "webhooks con firma rechazada" es literalmente inalcanzable para el riel del tenant.

5) Busqué una recuperación aguas abajo y NO existe. `provider_transaction_id` de un intent Wompi solo se escribe dentro de `settleWompiTransaction` (`tenant-payment-store.service.ts:539,560,606`), es decir, solo si el webhook pasó. El poll de `tenant-payments.service.ts:1178-1180` exige `intent.providerTransactionId` para consultar a Wompi, así que con el webhook rechazado nunca entra. `TenantWompiClient` no tiene ningún método para listar transacciones por payment link (solo `verifyMerchant`, `createAndVerifyPaymentLink`, `getAndValidatePaymentLink`, `getTransaction` por id): no hay forma de descubrir el id perdido. Y `reconcileExpiredWompiIntent` (`:1410-1445`) deliberadamente NO resuelve: marca `requires_review`. Tampoco hay ningún `@Cron` en el módulo. Confirmado que no hay reconciliación que rescate el cobro.

Chequeos extra que refuerzan el escenario en vez de matarlo: el guardado no puede validar el `events_secret` (`setConfig` solo hace `verifyMerchant(publicKey)` en `tenant-payments.service.ts:490`; el secreto de eventos no se ejerce nunca), así que un secreto mal pegado con el prefijo correcto queda "verified" en la UI; y `webhookAcknowledgedAt` — que es lo que enciende `ready`/`webhookConfigured` en pantalla (`:264,273`) — se setea por AUTO-DECLARACIÓN al activar el proveedor (`:626`), no por haber recibido un evento válido. La UI queda verde sin evidencia. El único test del caso (`tenant-wompi-webhook.service.spec.ts:164`) solo verifica que lance; no cubre logging ni contadores.

Dónde SÍ acoto el hallazgo (por eso bajo a P2, no P1): el sistema no queda 100% mudo ni se pierde plata mal cobrada. La plata cae en la cuenta Wompi del propio tenant (no se desvía), el contrato de la tool prohíbe afirmar "pagado" sin verificación backend (`tools/payment-tools.ts:26`), y cuando el link vence el intent pasa a `requires_review`, que `payment-operation.service.ts:758-776` convierte en `shouldHandoff: true` con mensaje explícito de no pedir otro pago: el caso escala a un humano por la consola. Lo que falta de verdad es la CAUSA (ninguna línea dice "firma rechazada") y la alerta a nivel plataforma; el diagnóstico depende de mirar el panel de entregas de Wompi. Además el disparador más probable es una mala configuración del propio tenant_admin. Real, con impacto operativo en un camino de dinero, pero un grado por debajo de P1.

### 31. [P2] El callbackToken secreto del webhook llega a Sentry en request.url del 20% de las transacciones

- **Dónde:** `apps/api/src/instrument.ts:17`
- **Escenario de fallo:** El token de callback es material secreto en este diseño: se guarda cifrado AES-256-GCM con el campo `callback_token` (tenant-payment-credential-crypto.service.ts:20) y se compara con `timingSafeEqual` (tenant-payments.service.ts:1904-1908); por eso app.module.ts:166-168 lo excluye de los logs a propósito. Pero Sentry corre con `tracesSampleRate: 0.2` en producción y el integration `requestData` adjunta SIEMPRE la URL absoluta al evento — `sendDefaultPii:false` solo apaga la IP, no la URL (node_modules/@sentry/core/build/cjs/utils/request.js:91 `url: absoluteUrl`; integrations/requestdata.js:30-32 donde solo `include.ip` depende de sendDefaultPii). Escenario concreto: por cada 5 eventos Wompi que reciba el tenant en producción, 1 transacción se envía a Sentry con `request.url = https://api.parallly-chat.cloud/api/v1/tenant-payments/webhook/wompi/<tenantId>/<callbackToken>`. Cualquiera con acceso de lectura al proyecto de Sentry (o un token Sentry filtrado, o el propio SENTRY_AUTH_TOKEN que ya vive en el .env) obtiene el token que el código guarda cifrado. No permite cobrar dinero falso por sí solo — falta el events_secret y además el servicio reconsulta la transacción canónica a Wompi — pero anula la capa de defensa que el commit construyó explícitamente.
- **Evidencia:** instrument.ts:17 -> `tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.2 : 1.0,`
instrument.ts:26 -> `sendDefaultPii: false,`  // solo afecta ip/headers/cookies, no la URL
app.module.ts:166-169 -> `// ... the callback URL still should not enter routine logs.` + `'/api/v1/tenant-payments/webhook/wompi/',`
@sentry/core/build/cjs/utils/request.js:91 -> `url: absoluteUrl,`
- **Arreglo:** Agregar en `instrument.ts` un `beforeSend` y un `beforeSendTransaction` que reescriban `event.request.url` reemplazando el último segmento cuando la ruta empiece con `/api/v1/tenant-payments/webhook/wompi/` (p.ej. `.../wompi/<tenantId>/[REDACTED]`). Es el mismo criterio que ya se aplicó a `x-event-checksum` en el `redact` de pino (app.module.ts:157).
- **Veredicto del refutador:** CONFIRMADO. Intenté derribarlo por cuatro caminos y los cuatro fallaron.

1) ¿La línea citada dice lo que se afirma? Sí. Leí `apps/api/src/instrument.ts` completo (39 líneas): línea 17 `tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.2 : 1.0`, línea 26 `sendDefaultPii: false`, y **no hay `beforeSend` ni `beforeSendTransaction`** en todo el archivo. Es el único `Sentry.init` del API (importado por `main.ts:2` y `worker.main.ts:12`).

2) ¿El array `integrations` desactiva las defaults (que sería la refutación limpia)? NO. `node_modules/@sentry/core/build/cjs/integration.js:49-51`: `if (Array.isArray(userIntegrations)) { integrations = [...defaultIntegrations, ...userIntegrations] }`. Pasar un array **suma** a las defaults. Y `node_modules/@sentry/node-core/build/cjs/sdk/index.js:36` incluye `core.requestDataIntegration()` entre las defaults; `@sentry/nestjs/build/cjs/sdk.js:31-32` las hereda.

3) ¿`sendDefaultPii:false` apaga la URL? NO. `@sentry/core/build/cjs/integrations/requestdata.js:7-13` → `DEFAULT_INCLUDE = { cookies:true, data:true, headers:true, query_string:true, url:true }`, y :30-32 → `ip: include.ip ?? client.getOptions().sendDefaultPii`. Solo `ip` depende de sendDefaultPii; `url` queda en true. La URL absoluta se arma en `@sentry/node-core/.../httpServerIntegration.js:114,125` (`normalizedRequest = httpRequestToRequestData(request)`) y `@sentry/core/.../utils/request.js` devuelve `url: absoluteUrl` = protocolo://host + path crudo.

4) ¿Está armado en prod? Sí: `infra/docker/Dockerfile.api:37 ENV NODE_ENV=production` (y `docker-compose.prod.yml:89`) → 0.2; `.github/workflows/deploy.yml:845` escribe `SENTRY_DSN` en el .env de producción.

El token ES material secreto, no un id de ruteo: `tenant-payments.service.ts:499` lo genera con `randomBytes(32).toString('base64url')`, se guarda como `webhookTokenEnc` y se descifra bajo el contexto de campo `'callback_token'` en `:786-789`, se compara con `constantTimeEqual` en `:791` (`:1904-1908` usa `timingSafeEqual`), y `app.module.ts:166-169` lo excluye a propósito de los logs de pino. Entra a la URL en `:1918-1923` y se consume como `@Param('callbackToken')` en `tenant-payments.controller.ts:129-133`. O sea: el mismo valor que el commit cifra con AES-256-GCM y esconde de los logs viaja en claro a Sentry en ~1 de cada 5 eventos Wompi.

DOS CORRECCIONES al hallazgo (ninguna lo salva, una lo acota):

a) La explotabilidad es acotada y el propio hallazgo lo admite: `tenant-wompi-webhook.service.ts:41-48` exige HMAC válido contra `eventsSecret` (otro secreto cifrado que NUNCA va en una URL), `:36-40` filtra familia de evento y entorno, `:57-65` reconsulta la transacción canónica a Wompi, y `:87` deduplica por unicidad de intento. El token solo NO mueve un peso ni expone datos de otro tenant.

b) La ruta de error NO agrega exposición — esperaba que la agravara y no lo hace: `@sentry/nestjs/build/cjs/helpers.js:22-28` (`isExpectedError`) devuelve `true` para CUALQUIER `HttpException` sin mirar el status, así que ni los 503 `wompi_transaction_lookup_failed` / `tenant_payment_persistence_failed` se capturan como error events. La exposición real es el 20% de traces, tal cual se reclamó (más un crash no-HttpException al sampleRate 1.0 por defecto).

Severidad: se mantiene P2. Es fuga real de material secreto a un almacén de terceros que anula una capa de defensa construida a propósito, pero es un factor de dos, no monetizable por sí solo, y legible solo por quien ya tiene acceso al proyecto de Sentry. No llega a P1 porque no mueve plata ni cruza tenants por sí mismo.

Arreglo mínimo anclado: agregar en `instrument.ts` un `beforeSendTransaction`/`beforeSend` que reescriba `event.request.url` cuando matchee `/api/v1/tenant-payments/webhook/wompi/`, o pasar `integrations: [nodeProfilingIntegration(), Sentry.requestDataIntegration({ include: { url: false } })]` — nótese que por `filterDuplicates` (integration.js:26-31) una instancia de usuario SÍ pisa la default del mismo nombre, así que esa segunda vía funciona.

### 32. [P2] Adoptar TENANT_PAYMENT_CREDENTIAL_KEY más adelante inutiliza en silencio todas las credenciales Wompi ya guardadas

- **Dónde:** `apps/api/src/modules/tenant-payments/tenant-payment-credential-crypto.service.ts:82`
- **Escenario de fallo:** Hoy el secreto TENANT_PAYMENT_CREDENTIAL_KEY está vacío, así que el llavero usa ENCRYPTION_KEY bajo el id 'primary' y cada sobre guardado en la base queda escrito como `tpc:v2:primary:...`. El día que el dueño quiera separar la llave de pagos (que es exactamente lo que invita el comentario de .env.example:38-41) y cargue SOLO el GitHub Secret TENANT_PAYMENT_CREDENTIAL_KEY, deploy.yml:816-818 escribe la llave nueva y `TENANT_PAYMENT_CREDENTIAL_KEY_ID` con el default `primary`. El llavero pasa a mapear 'primary' -> llave NUEVA, los sobres viejos dicen keyId 'primary' -> `keys.get('primary')` devuelve la llave equivocada -> el tag GCM no valida -> `tenant_payment_credential_decryption_failed` en TODAS las lecturas. Consecuencia inmediata en producción: los webhooks Wompi del tenant devuelven 401/503 (y encima sin dejar rastro, ver hallazgo P1), no se puede generar ningún link de pago nuevo, y el texto plano ya no es recuperable, así que el rewrap automático es imposible: el dueño tiene que volver a pegar private key, events secret y reconfigurar la URL de eventos en el panel de Wompi. La guarda de colisión existente (líneas 88-91) NO dispara, porque solo compara ids repetidos dentro de PREVIOUS_KEYS, no el choque entre la llave actual y los sobres ya escritos. Ni .env.example ni el comentario de deploy.yml:596-597 advierten que hay que listar ENCRYPTION_KEY bajo el id 'primary' en TENANT_PAYMENT_CREDENTIAL_PREVIOUS_KEYS.
- **Evidencia:** tenant-payment-credential-crypto.service.ts:78-85 ->
  `const currentKeyId = this.readKeyId(process.env.TENANT_PAYMENT_CREDENTIAL_KEY_ID || 'primary');`
  `const currentKey = this.readKey(process.env.TENANT_PAYMENT_CREDENTIAL_KEY || process.env.ENCRYPTION_KEY, 'tenant_payment_crypto_key_invalid');`
  `const keys = new Map<string, Buffer>([[currentKeyId, currentKey]]);`

deploy.yml:816-818 -> escribe KEY y `TENANT_PAYMENT_CREDENTIAL_KEY_ID=${PROD_TENANT_PAYMENT_CREDENTIAL_KEY_ID:-primary}` sin exigir PREVIOUS_KEYS.
- **Arreglo:** En `getKeyring()`, fallar fuerte en vez de en silencio: si `TENANT_PAYMENT_CREDENTIAL_KEY` está seteada, es distinta de `ENCRYPTION_KEY`, y `currentKeyId === 'primary'` (el id que ya usan los sobres del fallback), lanzar `tenant_payment_crypto_key_id_conflict`. Eso obliga al operador a elegir un keyId nuevo y a registrar ENCRYPTION_KEY en `TENANT_PAYMENT_CREDENTIAL_PREVIOUS_KEYS` bajo 'primary', que es la única rotación que preserva las credenciales. Documentar esa condición en .env.example:38-44 y en el comentario de deploy.yml:596-597.
- **Veredicto del refutador:** MECANISMO: CONFIRMADO. Las líneas citadas dicen exactamente lo afirmado. `tenant-payment-credential-crypto.service.ts:78-85` construye el llavero con `keyId = TENANT_PAYMENT_CREDENTIAL_KEY_ID || 'primary'` y `key = TENANT_PAYMENT_CREDENTIAL_KEY || ENCRYPTION_KEY`, y `encrypt()` (líneas 111-118) estampa ese id en el sobre `tpc:v2:<keyId>:...`. Hoy, con el secret vacío, todo sobre en producción quedó escrito como `tpc:v2:primary:` cifrado con ENCRYPTION_KEY. `deploy.yml:816-818` efectivamente escribe `TENANT_PAYMENT_CREDENTIAL_KEY_ID=${PROD_..._KEY_ID:-primary}` cuando sólo se carga el secret de la llave, así que 'primary' pasaría a mapear material NUEVO. `read()` (131-135) busca por id, encuentra 'primary', y descifra con la llave equivocada: el tag GCM no valida y cae en `tenant_payment_credential_decryption_failed` (155). Verifiqué además que NO hay guarda aguas arriba: no existe columna ni JSON que persista el keyId junto al material, no hay validación de arranque, y la guarda de colisión de 88-91 sólo compara ids repetidos entre PREVIOUS_KEYS y el id vigente (nunca contra los sobres ya escritos). También confirmé que no hay rewrap automático en lectura: `needsRewrap` sólo se calcula (151) y el único consumidor sería `rewrapProviderCredentials`, que no tiene ningún llamador en todo el repo (grep sobre src/, scripts/ y dist/: sólo el propio archivo y su spec). El spec del crypto cubre rotación con id DISTINTO (líneas 98-120, key-a -> key-b) y el fallback a ENCRYPTION_KEY (170-176), pero ningún test cubre el choque de material bajo el mismo id.

LO QUE SÍ REFUTO — el impacto está exagerado en su parte más grave. La afirmación "el texto plano ya no es recuperable... el dueño tiene que volver a pegar private key, events secret y reconfigurar la URL de eventos en el panel de Wompi" es FALSA. `deploy.yml:815` escribe `ENCRYPTION_KEY` incondicionalmente en cada deploy y el secret sigue vivo; y el bloque 816-822 está envuelto en `if [ -n "${PROD_TENANT_PAYMENT_CREDENTIAL_KEY}" ]`, así que vaciar ese único GitHub Secret y redeployar borra las tres líneas del .env, `getKeyring()` vuelve a caer en ENCRYPTION_KEY bajo 'primary' (línea 82) y TODOS los sobres viejos vuelven a descifrar tal cual. Es un rollback de un deploy, sin pérdida de credenciales, sin re-pegar nada y sin tocar el panel de Wompi (el `webhookTokenEnc` se recupera idéntico, así que la URL de eventos sigue siendo válida). Segunda corrección: la afirmación de que la doc no advierte es parcial — `docs/server-installation.md:127-129` documenta el llavero dedicado con un id NO-'primary' (`TENANT_PAYMENT_CREDENTIAL_KEY_ID=payments-2026-08`) más `PREVIOUS_KEYS`, que es justamente el patrón que evita la colisión; y `.env.example:42-44` ejemplifica ids fechados. Lo que falta es la advertencia explícita de que reusar el id 'primary' con material nuevo es destructivo, y que `.env.example:41` fija `TENANT_PAYMENT_CREDENTIAL_KEY_ID=primary` al lado de la llave vacía, que es el renglón que invita al error.

RESIDUO REAL (por eso no lo tumbo del todo): (1) la misconfiguración es SILENCIOSA hasta la primera lectura — no hay binding keyId->material ni chequeo de arranque; (2) la reparación ingenua está bloqueada por diseño: listar ENCRYPTION_KEY bajo 'primary' en PREVIOUS_KEYS dispara `tenant_payment_crypto_key_id_conflict` (88-91) y rompe TODA operación de pagos de todos los tenants, no sólo la lectura; (3) más grave que lo reportado: `rewrapProviderCredentials` (tenant-payments.service.ts:566) no tiene NINGÚN llamador — ni controller, ni cron, ni script — así que hoy la rotación CORRECTA (id nuevo + PREVIOUS_KEYS + rewrap + retiro) tampoco se puede ejecutar sin shipear código primero. Durante la ventana de misconfig el daño es un outage reversible del cobro tenant-owned (webhook Wompi responde 401 en `tenant-wompi-webhook.service.ts:31` porque `tryDecryptCredential` devuelve undefined, y no se pueden emitir links nuevos), no plata mal cobrada ni credencial filtrada. Un matiz que el hallazgo no menciona y que sí agrava: si durante la ventana el tenant re-guarda credenciales, esos sobres nuevos quedan bajo 'primary' con la llave nueva y el rollback los deja ilegibles a ellos — pero eso ya requiere DOS acciones humanas encadenadas.

VEREDICTO: escenario reproducible, defecto real, pero es un footgun operativo latente con rollback de un deploy y cero pérdida de datos, no la pérdida permanente de credenciales que se reclama. Mantengo P2, apoyado en el motivo más fuerte (rotación inejecutable + fallo silencioso), no en el "irrecuperable".

### 33. [P2] ERROR A — to_regclass sin ::text: Prisma revienta en CADA turno y el motor de Procedimientos (AOP/SOP) está muerto en toda la plataforma

- **Dónde:** `apps/api/src/modules/conversations/procedure-engine.service.ts:71`
- **Escenario de fallo:** `procedureEngine.process()` corre en todos los turnos (conversations.service.ts:1857, justo después del log "Routing Factors"). Entra a `loadActiveProcedures` y ejecuta `SELECT to_regclass('procedures') AS reg` por `executeInTenantSchema` → `tx.$queryRawUnsafe` (prisma.service.ts:126). La columna vuelve con tipo `regclass` y Prisma no la sabe deserializar → excepción. La atrapa el `catch {}` de la línea 89, que por diseño devuelve `[]` y NO cachea ('do NOT cache it, or a momentary DB blip would disable procedures for the full cache TTL'). Resultado: (1) `procedures:active:{tenantId}` nunca se llena, así que la consulta rota se repite en cada mensaje entrante de cada tenant — un `prisma:error` y una transacción desperdiciada por turno; (2) `matchTrigger` recibe siempre la lista vacía, así que un tenant que crea y activa un procedimiento y el cliente escribe la keyword disparadora NUNCA lo ejecuta, sin ningún error visible en el panel. La intención del código era correcta (to_regclass no lanza para tabla ausente); lo que falta es el cast, que el propio repo ya usa bien en prisma.service.ts:355 (`to_regclass('public.feature_requests')::text`).
- **Evidencia:** const reg = await this.prisma.executeInTenantSchema<any[]>(schemaName, `SELECT to_regclass('procedures') AS reg`, []); if (reg?.[0]?.reg) { ... } } catch { // to_regclass already handled the "table missing" case (returns NULL, no throw). Reaching here means the SELECT failed — a TRANSIENT error. return []; }
- **Arreglo:** Castear a texto: `SELECT to_regclass('procedures')::text AS reg`. Es el mismo patrón ya probado en prisma.service.ts:355 y 441. Con eso el probe vuelve NULL/string, el resultado sí se cachea y el ruido de `prisma:error` por turno desaparece.
- **Veredicto del refutador:** VERIFIQUÉ LA CITA — es literal, no está fuera de contexto.

1) `apps/api/src/modules/conversations/procedure-engine.service.ts:69-73` dice exactamente `SELECT to_regclass('procedures') AS reg` sin ningún cast, y el `catch` de las líneas 89-95 devuelve `[]` **sin cachear** (el comentario lo declara como intencional: "do NOT cache it, or a momentary DB blip would disable procedures for the full cache TTL"). El caché exitoso solo se escribe en la línea 98, que es inalcanzable si el SELECT tira.

2) EL CAMINO EXISTE. `conversations.service.ts:1855-1878`: `procedureEngine.process()` corre cuando `!engineProducedText` (o sea, siempre que el motor de reservas no tomó el turno), envuelto en try/catch no fatal. Dentro de `process()` (procedure-engine.service.ts:158-161), si NO hay estado en Redis se llama `loadActiveProcedures`. Como el estado solo se crea tras un match, y el match siempre recibe `[]`, el sistema queda en un punto fijo: nunca hay estado → siempre se ejecuta la probe rota → siempre lista vacía. Matiz al hallazgo: no es "cada turno" en sentido absoluto (los turnos en que el booking engine produce texto se saltean el bloque), pero sí es la enorme mayoría.

3) NO HAY RESCATE AGUAS ARRIBA. Busqué específicamente un warm-write del caché: `apps/api/src/modules/procedures/procedures.service.ts:118` solo hace `redis.del('procedures:active:{tenantId}')`; nunca escribe la lista activa. Así que ni siquiera crear/activar un procedimiento puede poblar el caché por otro camino. `loadProcedureById` (línea 102) sí está bien (usa `$1::uuid`), pero solo se alcanza con estado previo, que jamás se crea.

4) NO HAY GATE QUE LO VEA. El contrato estático `apps/api/src/common/utils/tenant-query-void-columns.spec.ts` solo cubre `SELECT pg_advisory_xact_lock(...)` suelto (línea 39) y `query(\`SET LOCAL` (línea 56). `regclass` no está contemplado. `procedure-engine.central-controls.spec.ts` mockea Prisma, así que tampoco toca la deserialización.

5) EL MECANISMO DE FALLA ES EL DOCUMENTADO EN ESTE REPO. `executeInTenantSchema` (prisma.service.ts:117-128) corre TODO por `tx.$queryRawUnsafe`, que siempre deserializa el result set; PrismaClient 5.20 sin driver adapter (apps/api/package.json:48, constructor en prisma.service.ts:44 sin `adapter`), o sea motor Rust/quaint. Grepeé el binario `node_modules/.prisma/client/query_engine-windows.dll.node` y ahí está literal el mensaje de `query-engine\connectors\sql-query-connector\src\error.rs`: "Failed to deserialize column of type ''. If you're using $queryRaw and this column is explicitly marked as `Unsupported`... try casting this column to". `regclass` no está entre los tipos que quaint convierte (bool/int/float/numeric/text/uuid/json/date/time/bytea/oid/inet/bit/money/xml y arrays). El propio repo ya trata a `to_regclass` como no deserializable: `prisma.service.ts:355-356` y `441-442` lo castean a `::text` aunque solo necesitan truthiness. Y el incidente prod de ago 2026 con `void` (mismo modo de falla, mismo primitivo) está documentado en el spec citado arriba.

LO QUE NO PUDE HACER: ejecutarlo contra Postgres real (no hay docker ni DB en este entorno). La conclusión descansa en el comportamiento documentado del motor + la convención del propio repo, no en una corrida. Es la única incertidumbre que queda, y es chica.

POR QUÉ BAJO LA SEVERIDAD DE P1 A P2:
- No hay plata mal cobrada, ni credencial expuesta, ni tenant viendo datos de otro. El turno del cliente NO se rompe: hay doble red (catch interno línea 89 + catch en conversations.service.ts:1875).
- El daño es (a) una función de nicho muerta en silencio y (b) una transacción fallida + un `prisma:error` por mensaje entrante. Lo segundo es costo de logs/DB, no de corrección.
- Para que sea visible al usuario hace falta que el tenant use una feature de nicho. Confirmé que SÍ es alcanzable desde la UI (`apps/dashboard/src/app/admin/procedures/page.tsx` + `procedures.controller.ts:50` POST con rol tenant_admin), así que el escenario "el dueño arma un procedimiento, lo activa, el cliente escribe la keyword y no pasa nada, sin error en el panel" es real y no requiere auto-sabotaje. Eso es lo que lo mantiene como defecto legítimo y no lo refuta.
- Cero relación con el cobro tenant-owned de Wompi/MP: es un hallazgo colateral del barrido.

El arreglo es de una línea: `SELECT to_regclass('procedures')::text AS reg`.

### 34. [P2] ERROR B — la sincronización oportunidad→deal lanza en vez de canonicalizar: el tenant vertical nunca espeja sus deals

- **Dónde:** `apps/api/src/modules/pipeline/pipeline.service.ts:1123`
- **Escenario de fallo:** En cada inicio de conversación, conversations.service.ts:945 llama `syncOpportunityToDeal(tenantId, leadId, oppStage, oppId)` con la etapa CRUDA de la oportunidad. Adentro (línea 1244) `resolveTenantStage` traduce esa etapa al catálogo del tenant y después `syncExactOpportunityDealTx` compara `opportunity.stage !== stage.slug` y lanza ConflictException. Para el tenant turismo el catálogo es consulta/cotizacion/reserva/confirmado/completado/cancelado (vertical-definitions.ts:446-453) y no contiene `listo_para_cierre`; entonces la resolución cae al alias semántico y elige por cercanía de probabilidad (pipeline.service.ts:216-221): el genérico `listo_para_cierre` vale 95 y el vecino más cercano no terminal es `confirmado` (90). Traducción exacta del log: la oportunidad 131aec15 está en `listo_para_cierre`, la canónica resuelta es `confirmado`, y explota. Consecuencia de plata: el deal espejo NUNCA se crea ni se actualiza, así que esa oportunidad no aparece en el Kanban, no suma al forecast ponderado ni al win/loss, y el error se repite en cada conversación. El propio motor de auto-progreso sí sabe reparar esto (pipeline.service.ts:2201-2215 canonicaliza antes de avanzar); este camino, no.
- **Evidencia:** if (opportunity.stage !== stage.slug) { throw new ConflictException(`Opportunity ${opportunityId} is at ${opportunity.stage}, not canonical stage ${stage.slug}`); }
- **Arreglo:** En `syncOpportunityToDeal`, antes de abrir la transacción, reparar como ya lo hace el auto-progreso: si `opportunity.stage !== canonicalStage.slug`, llamar `writeLeadStage(tenantId, leadId, canonicalStage.slug, { schemaName, opportunityId, onlyActiveOpportunities:false, triggeredBy:'canonical_repair' })` — que persiste el slug nativo y sincroniza el deal en la misma transacción (líneas 455-461). Alternativa mínima: en syncExactOpportunityDealTx comparar `resolveTenantNativeStage(catalog, opportunity.stage).slug === stage.slug` en lugar del string crudo.
- **Veredicto del refutador:** CITA VERIFICADA (el código dice lo que se afirma). `apps/api/src/modules/pipeline/pipeline.service.ts:1123-1127` es exactamente `if (opportunity.stage !== stage.slug) throw new ConflictException(...)`. El llamador `syncOpportunityToDeal` (mismo archivo, 1234-1248) canonicaliza en 1244 con `resolveTenantStage` y recién después entra a la transacción, así que la comparación es "etapa cruda de la fila" contra "etapa canónica resuelta". Y `conversations.service.ts:945-952` sí llama con `oppStage` crudo leído en 943. La asimetría contra `autoProgressFromConversation` (2188-2215, que sí repara antes de seguir) es real. La aritmética del ejemplo también da: turismo tiene consulta 10 / cotizacion 30 / reserva 60 / confirmado 90 no terminales (`verticals/vertical-definitions.ts:447-450`), el genérico `listo_para_cierre` vale 95 (`pipeline.service.ts:290`) y el reduce por cercanía de probabilidad (216-221) elige `confirmado`. Hasta ahí el hallazgo se sostiene.

LO QUE DERRIBO — LA CONSECUENCIA, QUE ES DONDE ESTÁ TODO EL PESO DEL P1.

1) "El deal espejo NUNCA se crea ni se actualiza" es falso para el escenario que el propio hallazgo describe. En el MISMO turno, después de la respuesta de la IA, `conversations.service.ts:748` dispara `autoProgressFromConversation`, que en 2201-2211 detecta `opp.opp_stage !== currentStage.slug` y llama `writeLeadStage(..., 'confirmado', {triggeredBy:'canonical_repair'})`. Y `writeLeadStage` no solo canonicaliza la fila: en `pipeline.service.ts:455-461` primero hace `UPDATE opportunities SET stage = $1` con el slug canónico y **acto seguido, en la misma transacción, llama `syncExactOpportunityDealTx(query, ..., stage)`** — que ahora pasa la guarda de 1123 porque la fila acaba de quedar en `stage.slug`. O sea: el espejo se crea en el primer turno de IA de esa conversación, no "nunca". El throw de 1123 cuesta UN intento de sync, no el espejo.

2) El error no rompe nada del turno: `conversations.service.ts:950-952` lo atrapa y lo loguea (`.catch(e => this.logger.error(...))`). El cliente igual recibe respuesta.

3) El estado que dispara esto no lo produce ningún escritor vigente. Todos canonicalizan antes de persistir `opportunities.stage`: alta conversacional `conversations.service.ts:932` y 943 (`initialPipelineStage.slug`, resuelto en 840-844), alta CRM `crm.controller.ts:148-155`, import CSV `crm/services/import-export/import-export.service.ts:174` (y falla cerrado con etapa inventada), bulk-update `crm.controller.ts:198-201`, tablero de deals `pipeline.service.ts:1869` (`newStage.slug`), tablero de oportunidades `pipeline.service.ts:2482-2483`, intake `intake/intake.service.ts:248,275`. Además el CRUD de etapas es fail-closed: `crm.controller.ts:940-968` prohíbe renombrar el slug o borrar una etapa que tenga oportunidades o deals, y `verticals.service.ts:1424-1459` solo AGREGA las etapas verticales (`ON CONFLICT (pipeline_id, slug) DO UPDATE`, sin DELETE), mientras `common/utils/primary-pipeline.util.ts:513-523` ADOPTA las etapas legacy huérfanas al embudo primario en vez de borrarlas — si el tenant tuvo etapas genéricas, `listo_para_cierre` sigue en el catálogo y la resolución da match exacto (182-186), no conflicto. Para un tenant turismo aprovisionado con el código actual el escenario simplemente no existe.

LO QUE QUEDA EN PIE (por eso no lo refuto del todo). Sí existe una vía donde la reparación no llega y el espejo se pierde de forma permanente: `autoProgressFromConversation` busca la oportunidad por `conversation_id` (`pipeline.service.ts:2173-2182`), mientras `resolveConversation` reusa cualquier oportunidad activa del lead por `lead_id` (`conversations.service.ts:938-944`). Si un lead vuelve y se le abre una conversación NUEVA (la vieja quedó cerrada), no se crea oportunidad nueva (guarda de 922-927) y la activa conserva el `conversation_id` viejo → autoProgress corta en 2182, nunca repara, y `syncOpportunityToDeal` tira ConflictException en cada arranque de conversación para siempre. El barrido de arranque tampoco la rescata: `prisma/prisma.service.ts:1091-1104` busca la etapa por slug EXACTO y lanza `No canonical stage "..."`, saltando la fila (1159-1161). Ese caso requiere filas legacy con slug genérico en un tenant vertical — algo que sí existió históricamente (el bug conocido de "todas las tarjetas en la columna 1" por slugs genéricos vs verticales) y que ninguna migración canonicalizó: en `prisma/tenant-schema.sql` solo hay backfill de `won_at/lost_at` (856-865), ningún UPDATE que reescriba `opportunities.stage` al catálogo del tenant.

SEVERIDAD. Lo bajo de P1 a P2: (a) no hay plata mal cobrada, ni pago perdido, ni credencial, ni fuga entre tenants — es visibilidad de CRM/forecast; (b) el error está atrapado y logueado, no corta el turno ni la conversación; (c) el camino principal que el hallazgo describe se autorrepara en el mismo turno y el espejo queda creado por la propia reparación; (d) el resto exige datos legacy pre-canonicalización MÁS una oportunidad desenganchada de la conversación en curso, y cualquier movimiento en el tablero, bulk-update o escritura de etapa la sana. El arreglo correcto sigue siendo trivial y vale hacerlo: que `syncOpportunityToDeal` (1244) canonicalice la fila igual que `writeLeadStage` en vez de comparar y lanzar, o que pase el `canonicalStage.slug` al llamador. La guarda de 1123 en sí es sana y debe quedarse para `syncExactOpportunityDealTx`, que es un método público reusado desde `crm/repositories/opportunities.repository.ts:120-126`.

### 35. [P2] Toda reparación y auto-avance de etapa está atada a opportunities.conversation_id, que nunca se re-apunta: el cliente que vuelve queda congelado para siempre

- **Dónde:** `apps/api/src/modules/pipeline/pipeline.service.ts:2177`
- **Escenario de fallo:** conversations.service.ts:922-934 sólo inserta una oportunidad si el lead NO tiene ninguna activa; si ya tiene una, la reutiliza. Pero cuando el cliente vuelve días después se crea una conversación NUEVA (línea 916) y `opportunities.conversation_id` sigue apuntando a la conversación vieja — no existe en todo el repo ningún `UPDATE opportunities ... SET conversation_id`. Y los dos únicos caminos que reparan/avanzan la etapa durante el turno filtran justamente por esa columna: `autoProgressFromConversation` (pipeline.service.ts:2173-2180, `WHERE o.conversation_id = $1::uuid`, y si no hay filas retorna en la 2182 antes de canonicalizar) y el auto-avance por respuesta del cliente (conversations.service.ts:415-420, mismo filtro). Resultado concreto y verificable con el log del dueño: la oportunidad 131aec15 quedó con un slug genérico huérfano y jamás se va a canonicalizar sola, por eso el ERROR B se repite en cada arranque en vez de autocurarse tras un turno; y además, para cualquier contacto recurrente de cualquier tenant, el embudo deja de moverse — el cliente puede decir "quiero reservar y pagar" y la tarjeta no avanza de etapa ni dispara las reglas de automatización enganchadas a `stage_changed`.
- **Evidencia:** const oppRows = await this.prisma.executeInTenantSchema<any[]>(schema, `SELECT o.id as opp_id, o.stage as opp_stage, o.lead_id FROM opportunities o WHERE o.conversation_id = $1::uuid LIMIT 1`, [conversationId]); if (!oppRows || oppRows.length === 0) return;
- **Arreglo:** Cuando una conversación nueva reutiliza una oportunidad activa existente, re-apuntarla: `UPDATE opportunities SET conversation_id = $1::uuid, updated_at = NOW() WHERE id = $2::uuid AND won_at IS NULL AND lost_at IS NULL` en el bloque de conversations.service.ts:937-953 (ya se hace ahí el SELECT de la oportunidad activa). Como red de seguridad, hacer que `autoProgressFromConversation` caiga a buscar por `lead_id` cuando el match por conversación no devuelve filas. Mientras tanto, el botón de re-sync del embudo (`resyncDeals`, pipeline.service.ts:2340) sí repara los slugs huérfanos ya existentes.
- **Veredicto del refutador:** CONFIRMADO en su núcleo, pero con dos correcciones al mecanismo y una acotación fuerte del impacto.

CADENA VERIFICADA LEYENDO CÓDIGO (el escenario SÍ es alcanzable):
1. `apps/api/src/modules/automation/nurturing.service.ts:197-220` — `@Cron('0 */6 * * *') autoResolveStale()` hace `UPDATE conversations SET status='resolved', resolved_at=NOW() WHERE status='active' AND updated_at < NOW() - INTERVAL '72 hours'`. O sea: el estado "conversación vieja cerrada" SÍ lo produce el sistema solo, sin intervención humana.
2. `apps/api/src/modules/conversations/conversations.service.ts:883-891` — el SELECT de reutilización filtra `status IN ('active','waiting_human','with_human','snoozed')`. `'resolved'` NO está. Confirmado: el cliente que vuelve cae al `INSERT INTO conversations` de la línea 916 (conversación NUEVA).
3. `conversations.service.ts:922-934` — la guarda `existingOpp` (`WHERE lead_id = $1::uuid AND won_at IS NULL AND lost_at IS NULL`) encuentra la oportunidad abierta y saltea el INSERT. La oportunidad queda apuntando a la conversación vieja ya `resolved`.
4. No existe re-apunte en ningún lado. El whitelist de update del repositorio es `['estimated_value','currency','assigned_to','metadata','loss_reason']` (`apps/api/src/modules/crm/repositories/opportunities.repository.ts:154`) — `conversation_id` no está. Todos los demás `UPDATE opportunities` del repo escriben solo `stage`, `deal_id`, `score`, `approval_*` o `metadata`.
5. No hay camino de reapertura: el único `UPDATE conversations SET status='active'` es `apps/api/src/modules/handoff/handoff.service.ts:376` (devolución del humano al bot), que actúa sobre una conversación que YA está en handoff, nunca sobre una `resolved`.

La línea citada dice literalmente lo que se afirma: `apps/api/src/modules/pipeline/pipeline.service.ts:2173-2182` (`WHERE o.conversation_id = $1::uuid LIMIT 1` + `if (!oppRows || oppRows.length === 0) return;` ANTES de canonicalizar en 2193). El otro camino también: `conversations.service.ts:415-420` (`WHERE conversation_id = $1::uuid`, y el `for` de 421 no itera nunca). Ningún test lo cubre: `pipeline-stage-resolver.spec.ts:102` mockea el resultado con filas presentes, así que nunca ejercita el caso de oportunidad huérfana.

CORRECCIÓN 1 — el hallazgo SUBESTIMA: hay una TERCERA víctima que no mencionó. `apps/api/src/modules/crm/services/lead-scoring/lead-scoring.service.ts:219-229` (`scoreAfterMessage`) usa el mismo `JOIN opportunities o ON o.lead_id = l.id WHERE o.conversation_id = $1::uuid LIMIT 1` y hace early-return. El scoring del lead también queda congelado para todo contacto recurrente.

CORRECCIÓN 2 — la atribución del ERROR B es INCORRECTA, aunque su conclusión sobrevive. El error repetido del slug huérfano NO viene del camino de `conversation_id`. `conversations.service.ts:937-953` corre en TODO turno (está fuera del `if (!conversation)`), es lead_id-based, y llama `syncOpportunityToDeal` → `pipeline.service.ts:1244` resuelve el stage canónico y `syncExactOpportunityDealTx` en `pipeline.service.ts:1123-1127` LANZA `ConflictException(\`Opportunity ... is at ${opportunity.stage}, not canonical stage ${stage.slug}\`)` en vez de reparar. Ese es el que se repite. La conclusión "jamás se autocura" es correcta, pero por otra razón: el camino lead-based tira excepción en lugar de canonicalizar.

LO QUE BAJA LA SEVERIDAD — el camino de la PLATA está intacto. `apps/api/src/common/utils/native-evidence-opportunity.util.ts:78-107` intenta primero por `o.conversation_id = $2::uuid`, y si devuelve 0 candidatos NO corta: cae al bloque de contacto en las líneas 109-131 (`WHERE l.contact_id = $1::uuid ... AND won_at IS NULL AND lost_at IS NULL`, con fallback por `contact_identities`). O sea que un pago o una reserva que la IA registre para un cliente recurrente SÍ se atribuye a la oportunidad abierta correcta. No hay plata mal cobrada, ni credencial filtrada, ni cross-tenant, ni pantalla rota. Los movimientos manuales del tablero (opp-id based) tampoco se ven afectados, y el avance por evidencia (cita/pago creados) sigue funcionando vía ese fallback por contacto.

VEREDICTO: defecto real, sistémico y silencioso (afecta a todo tenant con clientes que vuelven después de 72h), pero el daño es degradación de automatización de CRM + scoring, no dinero ni seguridad. P1 reclamado → P2 ajustado.
