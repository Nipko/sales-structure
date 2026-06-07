# Auditoría del Panel de Ayuda (HelpPanel) — Junio 2026

> **ESTADO (actualizado): COMPLETADO.** Cobertura de ayuda llevada de 23 → **104 páginas**
> (namespace `help` = **106 claves**, paridad es/en/pt/fr). Fase 0 (enriquecer 23) ✅ ·
> Fase 1 núcleo (26) ✅ · Fase 2 Settings (36) ✅ · Fase 3 Verticales (12) ✅ ·
> Fase 4 Canales (7) ✅. Excluidos a propósito: páginas de detalle `[id]` (heredan
> contexto), `setup-wizard` (asistente guiado) y redirects (`channels/sms`,
> `settings/integrations`, `channels/instagram/callback`). Pendiente transversal:
> grabar los GIF en `apps/dashboard/public/help/{key}.gif` (ver README ahí).

## Objetivo
Identificar qué páginas del dashboard tienen el menú de ayuda contextual (`HelpPanel`)
y cuáles no, para (1) cerrar las brechas y (2) enriquecer el contenido existente con
ejemplos, mayor claridad y, donde aplique, apoyo visual/animado.

## Cómo funciona el sistema de ayuda hoy
- Componente: `src/components/ui/help-panel.tsx` (`<HelpPanel />`), botón colapsable
  con animación (motion/react).
- Props soportadas:
  - `title` (string, requerido)
  - `description` (string, requerido)
  - `tips?` (string[]) — lista de consejos con ícono de bombillo
  - `images?` ({ src, alt, caption? }[]) — soporta GIF/animaciones por imagen
  - `videoUrl?` (string) — embed de YouTube (iframe)
  - `defaultOpen?` (boolean)
- Contenido vía i18n: namespace `help` en `messages/{es,en,pt,fr}.json`.
  Patrón en página: `const tHelp = useTranslations("help")` →
  `<HelpPanel title={tHelp("X.title")} description={tHelp("X.description")} tips={tHelp.raw("X.tips") as string[]} />`
- **NO** se usa en componentes compartidos ni en layouts: cada página lo invoca
  directamente. No hay herencia de ayuda entre página padre/hijo.

## Resumen cuantitativo
- Total de páginas admin (`page.tsx`): **117**
- Con `HelpPanel`: **23**
- Sin `HelpPanel`: **94**
- Claves existentes en namespace `help` (es.json): **23** (1:1 con las páginas que lo usan)

| Categoría | Páginas | Acción sugerida |
|-----------|--------:|-----------------|
| A. Con ayuda (enriquecer) | 23 | Complementar: ejemplos + claridad + visual |
| B. Secciones funcionales SIN ayuda (Prioridad 1) | 39 | Agregar ayuda nueva |
| C. Sub-páginas de Settings SIN ayuda (Prioridad 2) | 37 | Agregar ayuda (puede ser más breve) |
| D. Setup de canales SIN ayuda | 9 | Agregar ayuda enfocada en "cómo conectar" |
| E. Páginas de detalle `[id]` / utilitarias | 9 | Opcional / omitir (heredan contexto del padre) |

---

## Categoría A — Páginas CON ayuda (23) → a enriquecer
root dashboard, agent, agent-analytics, analytics-v2, appointments, automation,
automation/drip-sequences, automation/templates, broadcast, channels, compliance,
contacts, crm-analytics, feature-requests, financials, inbox, knowledge, pipeline,
properties, report-builder, settings, tenants, users

> Estado: tienen `title` + `description` + `tips`. Faltan ejemplos concretos,
> casos de uso, y en muchos casos apoyo visual (imágenes/GIF/video).

---

## Categoría B — Secciones funcionales SIN ayuda (Prioridad 1, 39)

### B.1 Núcleo de plataforma (aplican a todos los tenants)
| Ruta | Qué es (probable) |
|------|-------------------|
| agent/simulation | Probar/simular el agente antes de publicar |
| attribution | Atribución: anuncios → WhatsApp → venta |
| audit | Registro de auditoría |
| catalog | Catálogo (productos/cursos/campañas) |
| catalog/campaigns | Campañas |
| catalog/courses | Cursos (catálogo) |
| catalog/offers | Ofertas |
| compliance-admin | Administración de cumplimiento (super admin) |
| contacts/organizations | Organizaciones (CRM B2B) |
| contacts/segments | Segmentos guardados de contactos |
| conversations | Vista global de conversaciones |
| coupons | Cupones / descuentos |
| funnel | Embudo de conversión |
| health | Estado/salud del sistema (observabilidad) |
| identity | Identidad: fusión de contactos cross-canal |
| inventory | Inventario / stock |
| knowledge/faqs | FAQs de la base de conocimiento |
| landings | Constructor de landing pages |
| llm-stats | Estadísticas de uso de IA/LLM |
| managed | Servicio gestionado "done-for-you" (super admin) |
| orders | Pedidos / órdenes |
| plans | Planes de suscripción |
| procedures | Procedimientos / SOP |
| usage | Consumo / uso del plan |
| vertical-analytics | Analítica por vertical |
| webhooks | Webhooks salientes |
| setup-wizard | Asistente de configuración inicial |

### B.2 Vertical-específicas (visibles solo según industria)
| Ruta | Vertical |
|------|----------|
| classes | Gimnasio / fitness |
| courses | Educación |
| food-orders | Restaurante |
| menu | Restaurante |
| memberships | Gimnasio / fitness |
| insurance | Seguros |
| listings | Alojamiento / inmobiliaria |
| pets | Veterinaria |
| photo-sessions | Fotografía |
| tours | Turismo |
| treatment-plans | Salud |
| service-requests | Servicios |

---

## Categoría C — Sub-páginas de Settings SIN ayuda (Prioridad 2, 37)
ai-config, ai-providers, alerts, api-keys, appearance, billing, business-hours,
business-info, change-password, channels, company, custom-attributes, email-templates,
integrations, integrations/crm, integrations/mcp, integrations/reviews, integrations/slack,
integrations/vertical, integrations/web-chat, integrations/web-chat/triggers,
integrations/webhooks, localization, macros, media, notifications, nurturing, pipeline,
platform, platform/changelog, policies, prechat, profile, public-booking, recall,
scoring-config, security

> Nota: `settings` (raíz) sí tiene ayuda; cada sub-tab es una funcionalidad distinta.
> `billing` y `email-templates` además son accesibles desde el sidebar.

---

## Categoría D — Setup de canales SIN ayuda (9)
channels/email, channels/instagram, channels/instagram/callback, channels/messenger,
channels/sms, channels/telegram, channels/whatsapp, channels/whatsapp/profile,
channels/whatsapp/templates

> Ayuda ideal: pasos de conexión, requisitos (tokens, permisos Meta), y troubleshooting.
> `channels` (overview) sí tiene ayuda. `instagram/callback` es utilitaria (omitir).

---

## Categoría E — Detalle `[id]` / utilitarias (9) — opcional/omitir
agent/[agentId], agent/[agentId]/test, automation/drip-sequences/[sequenceId],
contacts/[leadId], listings/[listingId], pipeline/[dealId], properties/[propertyId],
tenants/[tenantId], tours/[packageId]

> Heredan el contexto de su sección padre. La ayuda aquí es opcional; si se agrega,
> debe ser específica de la vista de detalle (acciones, campos editables).

---

## Recomendaciones de enriquecimiento (parte 2)
Estructura sugerida por entrada de ayuda:
1. **Qué es** (1 frase clara, sin jerga).
2. **Para qué sirve / cuándo usarlo** (caso de uso).
3. **Tips** (3–5 accionables, con ejemplo concreto).
4. **Apoyo visual** (opcional): imagen/GIF anotado o video corto.

Opciones para "animación":
- **A) GIF/screencast** vía prop `images` (ya soportado, 0 código). Más simple.
- **B) Video YouTube** vía prop `videoUrl` (ya soportado). Requiere subir videos.
- **C) Ilustración animada** (Lottie/CSS) → requiere extender `HelpPanel`. Mayor esfuerzo.

Requisito transversal: **toda** entrada nueva debe ir en los 4 idiomas (es/en/pt/fr).

## Plan de ejecución sugerido (por fases)
- **Fase 0**: Enriquecer las 23 existentes (Categoría A) — mayor impacto inmediato.
- **Fase 1**: Categoría B.1 núcleo (27) — secciones que ven todos los tenants.
- **Fase 2**: Categoría D canales (8 útiles) — alto valor en onboarding.
- **Fase 3**: Categoría C settings (37) — ayuda breve por tab.
- **Fase 4**: Categoría B.2 verticales (12) — por industria.
- **Detalle/utilitarias (E)**: solo si se solicita.
