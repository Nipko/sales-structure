# Super_admin — Modelo de acceso, gobernanza e impersonación

_Última actualización: 2026-07-23_

Documento de referencia único del modelo de acceso `super_admin` y de la gobernanza de impersonación. Antes esta convención (crítica) estaba dispersa y desalineada entre `SECURITY.md`, `security-specification.md`, `analytics-billing-reference.md` y los `CLAUDE.md` de app. Esta es la fuente de verdad.

> **Principio:** el `super_admin` opera la **plataforma**, no un tenant. No tiene un tenant "implícito". Para tocar los datos de un tenant debe **impersonar** de forma explícita, con motivo, y toda escritura queda atribuida a su identidad real.

---

## 1. Modo plataforma (sin tenant implícito)

El `super_admin` no arrastra un `tenantId` por defecto. Las acciones sobre un tenant específico se resuelven vía un `tenantId` **explícito** (p. ej. entrando a `/admin/tenants/[id]`); el backend exige ese id (no lo infiere). Esto evita que una acción de plataforma modifique silenciosamente el tenant "actual".

## 2. `roles.ts` — deny-by-default

La autorización del panel super_admin es **deny-by-default**: cada página/endpoint nuevo necesita una **regla explícita** en `roles.ts` o el acceso queda denegado. **Consecuencia para el desarrollo:** al agregar una página o ruta de super_admin, hay que registrar su regla; si no, no será accesible (falla cerrada, no abierta). Es intencional — nada queda expuesto por olvido.

## 3. Impersonación gobernada

Para actuar en nombre de un tenant, el super_admin abre una sesión de impersonación:

```
impersonate(superAdminId, tenantId, { reason, ticketId })
```

- **Motivo obligatorio** (`reason`): sin él, la operación falla con `400 Bad Request`. Queda registrado para auditoría.
- **Tokens de 1h** con `impersonatedBy` (el super_admin real) e `impersonationSid` (identificador de la sesión emparejada).
- **Sesión emparejada:** `endImpersonation()` cierra de forma emparejada la sesión (mata el refresh token en Redis asociado al `impersonationSid`). No quedan sesiones de impersonación colgadas.
- **Alcance:** los tokens de impersonación tienen la vida y el alcance de la sesión emparejada; expiran solos a la hora.

## 4. Auditoría con el actor REAL

Las escrituras hechas **durante** una impersonación se atribuyen al **super_admin real**, no al usuario del tenant impersonado. `common/utils/audit-actor.util.ts` resuelve el actor real (`performedBy` + `impersonationSid`) para las escrituras de auditoría. Acciones registradas: `super_admin.impersonation_started` / `super_admin.impersonation_ended`, con `userId` = el super_admin (nunca el usuario impersonado).

Esto cierra el hueco clásico: sin esto, un cambio hecho "como el tenant" durante una impersonación aparecería como hecho por el tenant, borrando la traza de quién actuó realmente.

## 5. UI

- **Modal de impersonación**: pide el motivo (y ticket opcional) antes de iniciar; sin motivo no deja continuar.
- **Banner de impersonación persistente**: mientras la sesión está activa, el dashboard muestra un aviso de que se está actuando como el tenant, con acción para terminar (dispara `endImpersonation`).
- Las rutas/guardas del dashboard aplican el modelo deny-by-default descrito en §2.

## 6. Superficie super_admin gobernada

Páginas/áreas que operan bajo este modelo (todas requieren regla explícita en `roles.ts`):

- `/admin/tenants` (+ `/[id]`) — gestión de tenants, punto de entrada a la impersonación
- `/admin/ops` — Ops Center (platform-monitor)
- `/admin/storage`, `/admin/incidents` — almacenamiento por tenant, incidentes
- `/admin/plans`, `/admin/billing-ops` — catálogo de planes + billing cross-tenant (sync MP, refund, reconciliación)
- `/admin/sms-packages` — tiers de créditos SMS
- `/admin/fiscal` — configuración fiscal DIAN
- Auditoría / audit log

## 7. Regla para páginas nuevas (checklist)

Al crear una página o endpoint de super_admin:

1. **Registrar la regla** en `roles.ts` (si no, queda denegada).
2. Si la acción toca datos de un tenant, **resolver el `tenantId` explícito** (no asumir un tenant implícito).
3. Si es una escritura durante una posible impersonación, usar el resolver de `audit-actor.util.ts` para atribuir el **actor real**.
4. Nunca revocar credenciales compartidas (p. ej. el `system_user_token` compartido de WhatsApp) desde una acción de tenant.

---

## Referencias

- [`security-specification.md`](security-specification.md), [`SECURITY.md`](SECURITY.md) — controles de seguridad y RBAC
- [`analytics-billing-reference.md`](analytics-billing-reference.md) — endpoints super_admin (billing-ops, financials)
- `apps/api/src/modules/auth/` — `impersonate` / `endImpersonation`; `common/utils/audit-actor.util.ts`; `roles.ts`
