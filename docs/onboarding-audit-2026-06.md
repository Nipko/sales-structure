# Auditoría de Onboarding & Plan de Rediseño (Jun 2026)

> **Objetivo:** que un usuario nuevo tenga **un canal (WhatsApp prioritario) conectado y 100% funcional en ≤10 min**, con un flujo **simple, coherente, profesional y guiado** que recolecte **y conecte** toda la info que el agente de chat necesita — seguido de un **tour guiado** que muestre primero las funcionalidades que impactan al agente y luego las de valor adicional.

Basado en auditoría multi-agente (6 frentes: wizard actual, conexión de canal, readiness del agente, infra guiada/tour, docs de rediseño previos, best-practices 2025-2026).

---

## 1. Veredicto

**El objetivo de ≤10 min NO se cumple hoy.** TTFV (time-to-first-value = primer canal activo) real: **~15–40 min**, y el canal **nunca es obligatorio** (se puede llegar al dashboard sin ningún canal conectado, indefinidamente).

Lo bueno: **el backend es sólido** y **el rediseño ya está ~60% implementado** (existe un `/admin/setup-wizard` con los pasos correctos, de la sesión anterior). La brecha es un set **acotado y bien definido**, casi todo en el flujo/frontend.

---

## 2. Mapa del flujo actual (3 flujos fragmentados)

```
/signup (nombre, email, pass)
  → POST /auth/signup (crea user SIN tenant + email OTP)
  → /verify-email (OTP 6 dígitos)
  → /onboarding  ← WIZARD A (5 pasos)
       1. Empresa (14 campos; 3 requeridos)
       2. Audiencia (checkboxes por vertical)
       3. Objetivos del agente (checkboxes por vertical)
       4. Referido (marketing interno) ⚠ sin valor para el usuario
       5. Plan + tarjeta (paywall) ⚠ antes del primer valor
  → POST /auth/complete-onboarding  → crea: tenant, schema, AGENTE default
       (createDefaultAgentFromGoals), business-info, vertical bootstrap
       (pipeline/FAQs/servicios), suscripción trial
  → window.location = /admin
  → /admin detecta setupWizardCompleted=false → /admin/setup-wizard  ← WIZARD B (5 pasos)
       0. Elegir template de agente
       1. Personalizar (nombre, greeting, tono, horario)
       2. Pruébalo (AgentTestChat) ← "aha moment"
       3. Conéctalo (WhatsAppConnectPanel + SecondaryChannels) ← canal
       4. Descúbrelo (ToolsTour = grid estático de tarjetas)
  + OnboardingChecklist (panel lateral, solo xl+) + SetupBanner
```

**Problema estructural:** dos wizards (A y B) + un checklist, sin puente visible. El usuario no percibe una secuencia única, y el clímax (conectar canal) es **saltable con 1 clic**.

---

## 3. Diagnóstico por categoría

### 3.1 `/onboarding` (Wizard A) — demasiado largo, 2 pasos sin valor
- **Paso 4 (Referido):** marketing/analytics interno. No configura nada del agente. Cada paso extra = 3–7% menos conversión (benchmarks 2025).
- **Paso 5 (Plan + tarjeta):** muro de pago **antes** de conectar el primer canal. El cambio de mayor impacto de fricción según el doc de rediseño.
- **Paso 1:** hasta 14 campos (solo 3 requeridos: nombre, industria, timezone) → es el primero que ve el usuario y el de mayor abandono.
- **Sin persistencia:** si recarga, pierde todo (useState local).
- **El usuario nunca ve qué agente se le creó** (nombre/personalidad) ni la promesa de valor.

### 3.2 Conexión de canal (el núcleo del objetivo) — no garantizada y con cuellos de botella
- **El canal NO es obligatorio.** `setup-wizard` tiene "Skip" siempre visible; el checklist es descartable. → cuenta sin canal indefinidamente.
- **Meta Embedded Signup (ESU) sin pre-check de prerrequisitos:** es la variable que más infla el tiempo (2–5 min con Business Manager listo; **30–60 min sin él**). El usuario entra al popup de Meta y falla a la mitad sin guía.
- **Sin verificación post-conexión:** tras conectar, no se confirma que el agente quedó asignado al canal ni que responde. No hay CTA "probá tu agente" (QR/número).
- **`/admin/channels/whatsapp` sobre-cargada:** ~212 líneas de UI educativa (3 rutas: new/coexistence/migration) vs el panel simple del wizard (~40 líneas) → parálisis de decisión.
- **Coexistencia (QR con número existente) y sandbox** son las rutas de **menor fricción** para LatAm, pero no están destacadas.

### 3.3 Readiness del agente — falta info crítica conectada
El "agente mínimo viable" necesita: identidad ✓, business name ✓, **about/descripción** (el campo más impactante), **horarios**, **≥1 FAQ/conocimiento**, canal asignado ✓.
- **`about` es opcional y poco prominente** (debajo de redes sociales). Sin él, el agente no puede responder "¿qué hacen?".
- **Horarios no se recolectan** en el wizard → default 24/7 aunque el negocio no lo sea.
- **KB/FAQ nunca se siembra.** El campo `website` existe pero **no está conectado al crawler de KB** (`POST /knowledge/documents/crawl` **ya existe** en el backend). Oportunidad de 0 esfuerzo backend.
- **El "Pruébalo" prueba el agente pre-customización** (el template aún no se guardó al testear).

### 3.4 Tour guiado — no existe como tal
- **`ToolsTour` (Descúbrelo) es un grid estático de tarjetas** (un sitemap), no un walkthrough con spotlight/tooltips anclados a la UI.
- **No hay librería de product-tour instalada.**
- **`OnboardingChecklist`:** oculto en pantallas <xl (1280px → invisible en gran parte del mercado LatAm), item "conectar canal" genérico (no prioriza WhatsApp), descartable permanentemente.
- Las **~13 features nuevas** (Procedimientos, Simulación, Dual-skillset, integraciones verticales, MCP, B2B, atribución, reviews, managed) no tienen hogar ni jerarquía.
- Aclaración: el namespace i18n `tours` es la feature de **turismo** (paquetes), NO product-tours.

### 3.5 Sin métricas
No hay evento de activación (`activation_first_channel_connected`) ni medición de TTFV → imposible saber si el rediseño funciona.

---

## 4. Flujo objetivo (rediseñado) — ≤10 min, guiado de punta a punta

```
Signup (email + pass)  →  Verify (OTP)
  →  /onboarding RECORTADO (≤2 pasos, <2 min)
        1. Tu negocio: nombre + industria + timezone + WEBSITE (prominente) + about corto
        2. Objetivos del agente (checkboxes por vertical)
        [trial-first: plan "emprendedor" por defecto, SIN tarjeta. Referido fuera.]
        → al terminar: auto-crawl del website → KB sembrada
  →  Setup guiado unificado (continuación, no "otro wizard")
        • Personalizá tu agente (nombre/tono ya pre-cargados por vertical)  [~1 min]
        • Pruébalo: chateá con tu agente → "aha moment"  [<3 min del signup]
        • Conectá WhatsApp:
            - Pre-check de prerrequisitos (número libre, OTP, 2FA, Business Manager)
            - Ruta recomendada destacada + coexistencia/sandbox de baja fricción
            - Progreso visual (Autenticando → Configurando número → Activando agente → Listo)
            - Verificación: agente asignado ✓ + CTA "Escaneá este QR / escribí a +XX y mirá responder"
        • Tour guiado (Onborda)  [~45s]
  →  Dashboard. Si NO hay canal: empty-state con demo + banner persistente (no-descartable) "Conectá tu canal".
```

**Principios:** ruta crítica mínima, "aha" antes de 3 min, soft-gate (no hard-lock — la competencia no lo hace), todo lo demás diferido al checklist/tour.

---

## 5. Tour guiado — mecanismo y secuencia

**Librería recomendada: [Onborda](https://onborda.dev)** — nativa para Next.js App Router + Tailwind + shadcn, usa Framer Motion (ya en el proyecto), ~8KB, soporta multi-tour, routing entre páginas y tarjetas 100% personalizables.
- Alternativas evaluadas: **driver.js** (5KB, vanilla, ok si se prefiere sin dep React) · evitar **react-joyride** (34KB, sin App Router), **intro.js** (AGPL), **shepherd.js** (fricción con React 19).
- Se dispara **post-activación** (flag en localStorage al cerrar el setup) — tour contextual DESPUÉS del valor, no antes (patrón Intercom/Tidio/ManyChat).

**Secuencia (impacto-agente primero, valor-adicional después):**
- **Bloque A — empoderan al agente:** ① Agente IA (persona/tono) · ② Conocimiento/FAQ ("cargá tu web o FAQs para respuestas precisas") · ③ Info del negocio · ④ Horarios · ⑤ Procedimientos.
- **Bloque B — valor adicional:** ⑥ Inbox (tomar el control) · ⑦ CRM · ⑧ Automatización · ⑨ Analytics (tasa de contención) · ⑩ Broadcast.
- Cada paso: spotlight + popover (qué es + para qué sirve + CTA "Configurar ahora / Más tarde"). Total ≤45s. "Reiniciar tour" disponible en el HelpAssistant.

---

## 6. Plan por fases

| Fase | Foco | Cambios principales | Esfuerzo |
|------|------|---------------------|----------|
| **0 — Quick wins** | Recortar ruta crítica + medir | Quitar referido (→ micro-encuesta post-activación) · trial-first (diferir tarjeta) · persistencia de estado del wizard · evento `activation_first_channel_connected` (TTFV) · checklist no-descartable si no hay canal + link directo a WhatsApp · checklist visible en mobile | ~1 día |
| **1 — Canal garantizado** | El clímax en ≤10 min | Pre-check de prerrequisitos WhatsApp · unificar panel de conexión (versión simple) · coexistencia/sandbox destacadas · progreso visual del ESU · verificación post-conexión + asignación de agente + CTA "probá tu agente" (QR/número) · soft-gate (empty-state + banner persistente) · puente visual /onboarding → setup | ~2–3 días |
| **2 — Readiness del agente** | "Todo conectado" | `about` requerido/prominente + inyectado al prompt del agente · mini-paso de horarios · **website→crawl KB** · mini-FAQ en el wizard · test chat tras guardar · readiness banner en el editor del agente (about/horarios/KB/canal) | ~2 días |
| **3 — Tour Onborda** | Guía real | Instalar Onborda · `TourProvider` + spotlight · 2 bloques (A agente, B valor) · disparo post-activación · i18n 4 idiomas · "reiniciar tour" en HelpAssistant | ~2–3 días |
| **4 — Checklist hub + pulido** | Coherencia | Checklist con divulgación progresiva (Día-1 / Recomendado / Avanzado, por vertical) · empty-state demo del dashboard · verificar rutas del tour por vertical (sin 404) | ~1–2 días |

---

## 7. Decisiones clave (a confirmar antes de implementar)

1. **Fuerza del gate de canal:** *soft-gate* (recomendado: empty-state + banner persistente no-descartable, pero sin bloquear el dashboard) vs hard-lock vs solo banner.
2. **Librería de tour:** **Onborda** (recomendado) vs popover custom de shadcn vs driver.js.
3. **Trial-first / sacar tarjeta del onboarding:** toca lógica de billing — confirmar que "emprendedor/starter" sin tarjeta es el default y el upgrade va post-activación.
4. **Website → auto-crawl de KB:** sembrar conocimiento del negocio automáticamente (recomendado; backend ya existe).
5. **Orden de ejecución:** ¿implemento Fase 0+1 primero (lo que mueve la aguja del TTFV) y revisás, o todo de corrido?

---

## 8. Verificación de terreno (ground-truth)

Los hallazgos pivotales del audit fueron **verificados leyendo el código directamente** (no solo por los agentes):

- ✅ `/admin/setup-wizard/page.tsx` existe con **5 pasos** (template → personalizar → Pruébalo → Conéctalo → Descúbrelo) y `_components/` (AgentTestChat, SecondaryChannels, ToolsTour). Importa `WhatsAppConnectPanel`.
- ✅ **Es saltable:** botón "Skip" siempre visible → `api.skipSetupWizard()`. Confirma que **el canal NO es obligatorio**.
- ✅ Componentes de conexión existen: `WhatsAppConnectPanel.tsx`, `WhatsAppEmbeddedSignup.tsx`.
- ✅ **Endpoint de crawl KB existe:** `POST /knowledge/documents/crawl` → `crawlUrl(tenantId, url, title, category)`. La Fase 2 (website→KB) es **0 esfuerzo backend**.
- ✅ `createDefaultAgentFromGoals(tenantId, goals, createdBy, industry)` existe → el agente default se auto-crea.
- ✅ **i18n del setupWizard OK:** verificación previa probó set de claves **idéntico en es/en/pt/fr** (7357 c/u) y **6333 `t()` resuelven** (0 perdidas) — incluye el setup-wizard.
- ✅ **Sin riesgo de 404:** TODAS las rutas que linkea `ToolsTour` por vertical existen (`/admin/treatment-plans`, `/memberships`, `/pets`, `/food-orders`, `/service-requests`, `/photo-sessions`, `/knowledge/faqs`, `/settings/business-info`, `/settings/business-hours`, `/procedures`, etc.). El flag de "posible 404" de un agente fue falsa alarma.

**Conclusión:** el diagnóstico es correcto y el plan se apoya en hechos verificados. El "≈60% ya construido" es real: la espina (setup-wizard + componentes) existe; el gap es Fase 0 (quick-wins) + prereqs WhatsApp + tour interactivo real (Onborda) + website→KB + soft-gate + métricas.

## 9. Reconciliación con docs previos

`docs/onboarding-redesign-2026-q2.md` (research/propuesta) y `docs/onboarding-redesign-implementation-plan.md` (plan file-by-file) ya diseñaron esta dirección. **Fases 1–2 de ese plan están parcialmente implementadas** (el setup-wizard con sus 5 pasos y componentes existe). **Lo que falta** es lo de este documento: las **Fase 0** quick-wins (referido, trial-first, TTFV), el **pre-check de prerrequisitos**, el **tour interactivo real** (Onborda), el **website→KB**, y el **checklist hub + soft-gate**. Este doc actualiza y prioriza ese plan hacia el objetivo explícito de **canal en ≤10 min + tour guiado**.

---

## 10. Estado de implementación (jun 2026 — TODO de corrido)

Implementado en su totalidad salvo una pieza diferida por plan-gating. Verificado con `tsc` en api/dashboard/landing (0 errores) e i18n a paridad en 4 idiomas.

| Fase | Estado | Notas |
|------|--------|-------|
| **0 — Quick wins** | ✅ | Referido removido (trial-first), wizard 3 pasos, checklist no-descartable sin canal + link directo a WhatsApp + visible en mobile, `about` requerido (2.1). |
| **1.2 — Verificación + "probá tu agente"** | ✅ | CTA verde con link `wa.me` al número conectado en `/admin/channels/whatsapp` (estado conectado). |
| **1.4 — Soft-gate** | ✅ | Banner `needsChannel` apunta directo a WhatsApp. |
| **1.6 — TTFV** | ✅ | Columna `tenants.first_channel_connected_at` (idempotente, marcada en cada conexión de canal) + step "Canal conectado" en el funnel con mediana TTFV. |
| **2.2 — Mini-paso de horarios** | ✅ | Form compacto (apertura/cierre + días) cuando no es 24/7; **persiste `settings.businessHours` canónico** (corrige inconsistencia: antes el wizard solo seteaba el schedule del agente). |
| **2.4 — Mini-FAQ** | ✅ | Hasta 3 Q&A opcionales → `POST /knowledge/documents` (categoría `faq`) fire-and-forget. Funciona en el plan emprendedor (`knowledgeArticles: 5`). |
| **2.5 — Readiness banner** | ✅ | Banner en el editor del agente: canal/about/horarios/conocimiento, cada pendiente con link directo. `setup-status` extendido con `hasBusinessAbout` + `hasBusinessHours`. |
| **3 — Tour Onborda** | ✅ | Onborda + TourBoundary (aísla fallas) + disparo post-wizard + **"reiniciar tour"** en HelpAssistant (vía evento de window, sin acoplar `useOnborda`). |
| **4 — Checklist hub + empty-state** | ✅ | Checklist en 3 niveles (Esencial/Recomendado/Avanzado, Avanzado colapsado) + empty-state guiado en el dashboard (hero con 3 acciones cuando el tenant aún no tiene actividad). |
| **2.3 — Website→KB** | ⏸️ **Diferido (por diseño)** | El crawl está plan-gated a **0 páginas** en el plan por defecto (emprendedor); auto-crawlear en el wizard daría `ForbiddenException` para casi todos los nuevos trials. Ya está expuesto **con upsell** en `/admin/knowledge` y enlazado desde el banner de readiness (item "conocimiento"). La mini-FAQ (2.4) cubre el sembrado de KB en el onboarding para todos los planes. |
