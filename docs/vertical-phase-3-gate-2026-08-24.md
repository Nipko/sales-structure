# Gate de Fase 3 — autoría 1:1, país, navegación y tools

**Corte:** 24 de agosto de 2026
**Estado:** código cerrado; promoción bloqueada por las revisiones y evidencias descritas aquí
**Contrato:** `VerticalAuthoringPackageV1`

## Resultado

La plataforma ya compone un paquete versionado por cada configuración de negocio sin mantener 76 prompts paralelos. El paquete reúne las dimensiones obligatorias del plan —algunas desglosadas para poder auditarlas por separado—: identidad, cliente objetivo, jobs-to-be-done, objetos, alcance, intents, slots, fuentes de verdad, tools, estado degradado, navegación, terminología, templates, localización, privacidad, evals y benchmark. Cada campo crítico declara su registro de origen, si fue heredado y si requiere experto; un valor heredado ya no puede presentarse silenciosamente como autoría 1:1.

La misma proyección llega a:

- `/verticals/audit/native-backlog`, con 81 identidades y matriz país por país;
- `/verticals/:tenantId/effective-profile`, junto al dominio, certificación, operaciones y menú efectivos;
- el turno live y Agent Test, donde el plan autoral se cruza con tools publicadas y explica `runtimeToolPlan`, `runtimeStatus` y `missingTools`;
- el dashboard de auditoría y la identidad regional del tenant, en ES/EN/PT/FR.

## Evidencia de cobertura

| Dimensión | Resultado mecánico | Puerta posterior explícita |
|---|---:|---|
| Paquetes canónicos | **76/76** | Ninguna pérdida de perfil. |
| Compatibilidad | **81** identidades; **5** legacy | Migraciones productivas se ejecutan por tenant, nunca en silencio. |
| Terminología propia | **16** perfiles | Su revisión histórica no certifica país/regulación. |
| Terminología heredada | **60** perfiles identificados | Glosario, aliases, términos prohibidos y firma de experto. |
| Reglas de persona 1:1 | **6** perfiles con contrato explícito; **70** aún usan reglas de vertical | Revisión de fit por subtipo; el rol heredado también queda marcado en cada paquete. |
| Idiomas base | **ES/EN/PT/FR** con el mismo piso de evals | Claims, límites o guidance sin traducción revisada se omiten y generan `domainReviewRequired`; nunca se inyecta español en otro idioma. |
| Países | **15 preview**, **US/CA recognized** | Los 15 packs siguen `draft`; US/CA siguen `fallback_only`; hay cero mercados `pilot/certified`. |
| Navegación | **0** perfiles con gap | Permisos y rutas siguen sujetos a tests de web/móvil y al gate E2E. |
| Tool control | **0** tools autorales con control faltante | Readiness, plan, role, channel, provider y SoR pueden excluir tools por tenant/turno con motivo. |
| Implementación de producto | **6** perfiles con `scope_without_committing_intent` | Pertenece a Fase 5: Promotora, Construcción, Pagos/Recaudos, Marketplace, MSP y Event Planning. |
| Revisión regulatoria/dominio | **34** perfiles `REG` en el catálogo completo | El ledger nativo anterior contaba 21 gates dentro de 54 perfiles build/hybrid; no era el universo de 76. Ninguno se promueve por derivación. |

## LOC-01 / P34

Se separaron dos ejes que antes podían confundirse:

- `CountryPackStatus` demuestra evidencia lingüística: `draft`, `fallback_only`, `pilot`, `certified`.
- `CountryMarketState` gobierna disponibilidad/claim: `recognized`, `preview`, `pilot`, `certified`.

Los quince packs LatAm/Brasil existentes quedan en `preview` comercial y `draft` lingüístico. US/CA quedan `recognized` y `fallback_only` porque país no decide `en-US/es-US`, `en-CA/fr-CA`, estado/provincia ni una identidad `+1`. Un ISO aceptado pero sin pack siempre cae a `recognized`, sin claim y con capacidades genéricas no reguladas.

El turno incluye `<market state=… claim_mode=… capability_mode=…>`. La regla universal impide convertir idioma, moneda, formato o frase entendida en autoridad regulatoria o claim de mercado. Snapshots regionales anteriores que permanezcan hasta cinco minutos en Redis no traen el campo: por compatibilidad se omite el bloque y nunca se promueve a certificado.

## AUTH-01 / TERM-01

El paquete no copia prompts enteros. Referencia componentes L1 universales, la persona vertical existente, contratos nativos de subtipo cuando existen y el contrato de dominio derivado. Las fuentes críticas llevan `profile_explicit`, `manifest_explicit`, `domain_derived`, `operation_derived`, `vertical_default`, `universal_component`, `country_overlay`, `legacy_alias` o `unresolved`.

`mechanically_complete` significa que el schema está íntegro, las fuentes son trazables, los cuatro idiomas son seguros y los evals deterministas existen. No significa `expert_reviewed`, `pilot_ready` ni `certified`. Los 60 glosarios heredados y las 70 reglas de persona vertical permanecen visibles en la bandeja de expertos; no se fabricaron términos ni guiones para cerrar un contador.

## NAV-01 / TOOL-01

La proyección del menú se extrajo a un productor puro compartido por config tenant, perfil efectivo y auditoría. Trabajo diario queda primero, catálogo separado y las etiquetas no colisionan. El hallazgo adicional de esta fase fue `servicios_profesionales/*`: Casos es el registro diario aunque su tool sea de lectura; clasificar sólo por presencia de writer lo colocaba falsamente como catálogo. La clasificación ahora combina operación y orden canónico.

Cada acción autoral conserva tool, intents, efecto, objeto activo, deep link, familia, subpermiso, readiness, assurance, confirmación, aprobación, idempotencia, ownership, efecto externo y SoR. El turno conserva el plan estable y sólo publica su intersección efectiva. Un writer creado por el agente debe tener Active Object y deep link humano; los tests fijan cero huecos de control.

## Compatibilidad y configuración

Esta fase no añade variables de entorno, secretos, migraciones DDL ni writes externos. Conserva todas las variables productivas y sus fallbacks de Fase 2. El único cambio regional es aditivo; cachés v1 sin `marketPolicy` funcionan hasta expirar y permanecen fail-closed para claims.

## Lo que no autoriza este gate

- no certifica un perfil, país, proveedor ni claim competitivo;
- no firma los 60 glosarios, las 70 reglas de persona ni los perfiles regulados;
- no implementa los seis productos profundos de Fase 5;
- no ejecuta migraciones de tenants;
- no activa Hostaway, Toast, Mindbody, Cliniko ni writers externos;
- no sustituye sandbox, pilotos de 3–5 tenants o evidencia E2E real.

## Verificación

La verificación local previa a promoción quedó verde en los seis typechecks, lint de shared/API/dashboard, builds de shared/API/dashboard/landing/WhatsApp, schema Prisma, claims/evidencia competitiva, JSON ES/EN/PT/FR y la matriz estática **1.660/1.660**. Suites: API **370/370** (**3.577** pruebas; una suite y diez pruebas marcadas skip por su propio contrato), dashboard **31/31** (**275**), mobile **24/24** (**321**) y WhatsApp **3/3** (**13**).

Los dos specs nuevos también forman parte de los gates bloqueantes de Deploy y Vertical Quality. CI, Browser E2E, migraciones efímeras, boot real, publicación de imágenes y despliegue se validan después del push; una prueba local no se transforma en certificación externa.
