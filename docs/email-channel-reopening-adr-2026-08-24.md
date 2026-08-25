# ADR — Reapertura de Email como canal conversacional self-service

- Estado actual: **retirado de self-service**
- Fecha: 2026-08-24
- Decisión relacionada: P28
- Dueño de una futura reapertura: Producto + Plataforma + Seguridad

## Decisión vigente

Email no es un canal conversacional certificado de Parallly. El adapter inbound existente se conserva como infraestructura interna/legacy, con observabilidad y aislamiento de tenant, pero no autoriza claims comerciales, onboarding, selector de agentes, campañas, pricing ni una pantalla de conexión para tenants.

`/admin/channels/email` redirige al inventario real de canales. No se reabre agregando un formulario o reutilizando credenciales SMTP existentes: eso produciría otra superficie sin contrato operativo completo.

## Gate obligatorio de reapertura

La reapertura exige evidencia almacenada y pruebas E2E de todos estos bloques:

1. API tenant de configuración, lectura enmascarada, rotación/revocación de secretos y OAuth cuando corresponda.
2. Threading determinista (`Message-ID`, `In-Reply-To`, `References`), deduplicación, identidad cross-channel y resolución de colisiones.
3. Inbound y outbound certificados por proveedor, firma/webhook, rate limits, retries, idempotencia y dead-letter/recovery.
4. Attachments con límites, malware scan, tipos permitidos, ownership, retención y descarga autorizada.
5. Bounce, complaint, unsubscribe, suppression list, spam/reputation y cumplimiento aplicable por país.
6. Un agente por conexión operativa, binding granular y permisos equivalentes a los otros canales certificados.
7. Atribución de conversaciones, mensajes, handoffs y costos a `channel_type=email` y `channel_account_id`, incluida etiqueta histórica.
8. Inbox humano, SLA, reasignación, macros, historial y entrega outbound en el mismo thread.
9. UI completa sin callejones: conectar, probar, estado/freshness, desconectar, reparar y soporte.
10. Evals en ES/EN/PT/FR, Browser E2E, pilotos controlados, runbook, alertas, soporte y sign-off de seguridad/producto.

## Condición de promoción

El estado sólo puede pasar de `internal_legacy` a `private_pilot` mediante una decisión versionada. El paso a `certified_self_service` exige pilotos con evidencia real, cero divergencia API/UI/runtime y rollback probado. Hasta entonces, cualquier intento de activarlo por las rutas genéricas debe fallar de forma tipada.
