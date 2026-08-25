# Gate 2 — contratos compartidos y compatibilidad de configuración

Fecha de corte: 24 de agosto de 2026
Estado: **código completo; la promoción conserva como gates el Browser E2E y CI remoto del commit**.

## Resultado

La Fase 2 quedó implementada sin crear una segunda taxonomía, sin migrar tenants, sin activar writers externos y sin cambiar el significado de las variables productivas actuales:

- contrato de certificación v1 para **76 perfiles canónicos y 81 IDs resolubles**;
- estado separado por producto, país y proveedor, con motivos tipados;
- contrato operativo v1 por perfil con objeto, acción, permiso, readiness, assurance, confirmación, aprobación humana, idempotencia y límite de sistema de registro;
- catálogo global de controles derivado de los registries ejecutables, con cero brechas mecánicas abiertas;
- matriz CFG-01 v1 de variables, secretos, precedencia, validación, rotación y rollback;
- consumo del mismo snapshot por API/runtime, Agent Test, dashboard, móvil y landing.

El snapshot estático actual de los 81 IDs resolubles reporta:

| Estado | Total |
|---|---:|
| `read_write` | 69 |
| `read_only_handoff` | 12 |
| `certified` | 0 |

`read_write` significa que la disponibilidad actual del producto no revoca writers que un tenant ya posee. **No significa certificación.** Los cero certificados son el resultado esperado mientras no exista un promotion record con evidencia E2E, país certificado, proveedor/version/capacidad cuando aplique, piloto y sign-off.

## CTR-01 — certificación y disponibilidad unificadas

`VerticalCertificationSnapshotV1` conserva ejes independientes:

1. **producto:** availability, commercialisable, etapa y modo de ejecución;
2. **mercado:** país operativo explícito, pack, estado y certificación;
3. **proveedor:** boundary, obligatoriedad, proveedor elegido, versión API, salud y capacidades certificadas;
4. **resultado:** etapa, certificación, autorización de marketing profundo y razones tipadas.

Controles principales:

- una integración sana no se interpreta como certificada;
- Toast `menus-v2`, Mindbody `public-v6` y Cliniko `v1` llegan al snapshot como identidad de versión, no como evidencia de certificación;
- los bindings nativos de esos conectores se declaran como límites condicionales para autoría/certificación, sin ampliar el registro ejecutable de SoR ni encender políticas nuevas;
- los destinos `waitlist` y los aliases `legacy_only` mantienen `read_only_handoff`;
- API tenant, Agent Test y móvil consumen el contrato efectivo; Ops consume el catálogo completo; la landing deriva estado y razones desde la misma política compartida;
- ningún estado se promueve por inferencia o por una frase documental.

## CTR-02 — contrato operativo versionado

`VerticalOperationContractV1` se compone desde las fuentes ejecutables existentes:

- intents y tool plans del contrato de dominio;
- `TOOL_POLICY_REGISTRY` para efecto y controles de commit;
- familias y subpermisos del registro de agentes;
- readiness compartido;
- Active Objects y deep links;
- declaración de sistema de registro.

Cada action devuelve sus brechas en `gaps`; el catálogo global hace lo mismo para todas las tools estáticas. Las pruebas fallan si aparece un writer sin clasificación explícita o si falta assurance, confirmación, aprobación, idempotencia, ownership u otro control requerido.

Las declaraciones contractuales de los destinos futuros están separadas de `PROFILE_SYSTEM_OF_RECORD_POLICIES`: describen el límite aprobado para autoría y certificación, pero no activan una política runtime antes de que existan objeto, adapter y evidencia.

## CFG-01 — compatibilidad con producción

La precedencia adoptada es:

`nuevo explícito válido → legacy compatible → default seguro/fail-closed`.

Compatibilidad preservada:

| Nuevo contrato | Compatibilidad vigente | Default/corte seguro |
|---|---|---|
| `TENANT_SECRET_KEY` | `ENCRYPTION_KEY` | ausencia permitida al arrancar; uso criptográfico falla cerrado |
| `TENANT_SECRET_KEY_ID` | no aplica | `primary` |
| `TENANT_SECRET_PREVIOUS_KEYS` | no aplica | `{}` |
| `TENANT_SECRET_PLAINTEXT` | comportamiento actual | `accept`; cambiar a `reject` solo con inventario cero |
| `INTEGRATION_WRITE_CAPABILITIES` | `INTEGRATION_WRITE_PROVIDERS` | vacío: writers externos apagados |
| allowlists Toast/Cliniko | hosts oficiales actuales | namespace oficial validado |

El snapshot de configuración solo publica origen, presencia, validez y un código diagnóstico. No devuelve valores. Un grant granular mal formado falla cerrado y no cae silenciosamente al legacy. Las allowlists personalizadas rechazan URLs, comodines, IPs y dominios locales/internos; el snapshot reporta únicamente `host_allowlist_invalid`, sin devolver el hostname configurado.

`INTEGRATION_WRITE_CAPABILITIES` queda definido y probado como contrato de cutover, pero **no sustituye todavía el interruptor runtime legacy**: activar por `provider@apiVersion:operation` exige primero persistir esa versión en el binding/adapter durable y liberar el outbox por operación. Ese cableado pertenece a INT-01 y permanece apagado hasta sandbox. Las variables productivas actuales continúan gobernando el flujo existente.

## Superficies consumidoras

| Superficie | Consumo |
|---|---|
| Runtime/API | `EffectiveCapabilityContract` contiene `certification` y `operations`. |
| Agent Test | devuelve exactamente el contrato efectivo usado por el turno. |
| API de vertical | expone effective profile y catálogo de certificación. |
| Dashboard Ops | muestra resumen del contrato compartido y recibe razones/controles completos. |
| Móvil | carga best-effort el effective profile y lo fusiona solo en memoria; no persiste un manifest nuevo. |
| Landing | deriva estado, razones y autorización de claims desde la política compartida y falla a copy genérico. |

## Evidencia local

| Control | Resultado |
|---|---:|
| TypeScript: shared, API, dashboard, landing, mobile y WhatsApp | 6/6 limpios |
| API Jest | 368 suites pasaron, 1 omitida; 3.564 tests pasaron, 10 omitidos |
| Dashboard Jest | 31 suites y 275 tests pasaron |
| Mobile Jest | 24 suites y 321 tests pasaron |
| WhatsApp Jest | 3 suites y 13 tests pasaron |
| Contratos focales CTR/CFG/SoR | verdes |
| Claims públicos | 18/18 verticales, es/en/pt/fr y variantes verificadas |
| `git diff --check` | limpio después de documentar |

El smoke de arranque se ejecutó con `JWT_SECRET`, `JWT_REFRESH_SECRET` y `ENCRYPTION_KEY` efímeros dentro del proceso de Jest. No se creó `.env`, no se modificaron secretos persistidos y ninguna variable nueva se volvió obligatoria.

## Gates que siguen cerrados

La Fase 2 permite abrir autoría y navegación de Fase 3, pero no autoriza:

- promover un perfil, país o claim;
- habilitar `INTEGRATION_WRITE_CAPABILITIES` en runtime;
- registrar capacidades certificadas de proveedor sin sandbox y evidencia;
- migrar los tenants pendientes del inventario TAX-03;
- cambiar `TENANT_SECRET_PLAINTEXT=reject` antes de demostrar cero plaintext;
- ejecutar una migración o un writer externo.

Antes de integrar este commit en producción deben pasar Browser E2E, Vertical Quality Evidence, Release y Deploy. Cualquier fallo detiene la promoción y se corrige sin debilitar expectativas.
