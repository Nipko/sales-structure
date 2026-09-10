# Estado del remanente local, leído del código

Generado por `docs/audits/2026-09-09/generate-closure-state.cjs`. **Ningún número de este documento**
**está escrito a mano**: cada uno lo responde la autoridad que lo decide. Todos los contadores de este
programa que sí se escribieron a mano envejecieron —el 32/10 de la matriz, el `complete` de canales,
«otras salidas», «faltan términos en otras familias»—, y ése es exactamente el motivo.

Revisión: `9a7dc5e16f5e629fc711b4c3c1901cb13048e3ed`. Sin base de datos, sin modelo, sin proveedor, sin tenant.

## Matriz de tareas

| Perfiles | Tareas | Comprometen al negocio | Sin positivo verificable | Sin verificador | Certificados |
|---:|---:|---:|---:|---:|---:|
| 76 | 268 | 146 | 5 | 5 | 0 |

## Lo que costaría certificar el catálogo

Un modelo (`gpt-4.1-mini`), 5 canales, 4 idiomas, k=1:

- **78.120** casos requeridos
- **139.940** llamadas al modelo (derivadas de los mensajes de cliente de cada escenario)
- techo **US$677.40** con un límite declarado de 8000 tokens de entrada y 1000 de salida por turno
- **233 h** de tiempo de modelo
- rechazos del plan: —

## Certificación de canales

| Autoservicio | Implementados | Operando | Certificados |
|---:|---:|---:|---:|
| 5 | 3 | 0 | 0 |

| Canal | Estado | Sin implementar | Declarado, nunca operado | Operando sin prueba |
|---|---|---|---|---|
| instagram | prepared | — | `outbound_media`, `payment_link`, `token_lifecycle`, `reconnect`, `rate_limits`, `handoff`, `multi_account`, `privacy_erasure`, `agent_per_connection` | `inbound`, `outbound_text`, `delivery_receipt`, `read_receipt`, `durable_dispatch` |
| messenger | prepared | — | `outbound_media`, `payment_link`, `token_lifecycle`, `reconnect`, `rate_limits`, `handoff`, `multi_account`, `privacy_erasure`, `agent_per_connection` | `inbound`, `outbound_text`, `delivery_receipt`, `read_receipt`, `durable_dispatch` |
| telegram | pending | `delivery_receipt`, `read_receipt` | `outbound_media`, `payment_link`, `token_lifecycle`, `reconnect`, `rate_limits`, `handoff`, `multi_account`, `privacy_erasure`, `agent_per_connection` | `inbound`, `outbound_text`, `durable_dispatch` |
| web_widget | pending | `read_receipt` | `outbound_media`, `payment_link`, `reconnect`, `rate_limits`, `handoff`, `multi_account`, `privacy_erasure`, `agent_per_connection` | `inbound`, `outbound_text`, `delivery_receipt`, `durable_dispatch` |
| whatsapp | prepared | — | `outbound_media`, `payment_link`, `flow`, `token_lifecycle`, `reconnect`, `rate_limits`, `handoff`, `multi_account`, `privacy_erasure`, `agent_per_connection` | `inbound`, `outbound_text`, `delivery_receipt`, `read_receipt`, `durable_dispatch` |

## Dónde descansan las palabras del agente

20 lugares inventariados, **0 abiertos**:

Ninguno. Cada store declara qué lo alcanza y por qué; los que siguen sin llegar a algo lo
dicen como límite aceptado (`by_design`) con el motivo, no como pendiente.

## Términos que el cliente aceptó

15 familias. Sin comando vinculado: —.

Sin cobro vinculado: —.

Para actualizar: `node docs/audits/2026-09-09/generate-closure-state.cjs` desde la raíz.
