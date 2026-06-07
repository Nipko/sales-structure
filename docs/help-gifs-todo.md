# 📋 Pendiente: grabar GIF de ayuda (HelpPanel)

> Agenda de assets visuales para el panel de ayuda. La cobertura de **texto** está
> 100% completa (104 páginas, 106 claves, 4 idiomas — ver `docs/help-panel-audit-2026-06.md`).
> Falta solo lo **visual**: grabar los GIF. Este doc es el checklist para irlos completando.

## Cómo funciona (ya está listo en código)
- Cada página con ayuda pasa `mediaKey="<clave>"` a `<HelpPanel>`.
- El componente carga automáticamente **`apps/dashboard/public/help/<clave>.gif`**.
- Si el archivo **no existe**, el panel lo oculta solo (sin imagen rota). → puedes
  subir los GIF de a poco, en cualquier orden, sin tocar código.
- Componente: `apps/dashboard/src/components/ui/help-panel.tsx` (`HelpMedia`).

## Especificaciones de grabación
- **Formato:** `.gif` (o screencast convertido a GIF). Nombre = exactamente la clave.
- **Tamaño:** ~800 px de ancho, peso **< 2 MB** (carga rápida; recorta/optimiza).
- **Duración:** 5–12 s en loop, mostrando UNA acción concreta (la del checklist).
- **Herramientas sugeridas:** ScreenToGif (Windows), Kap (Mac), o grabar mp4 y convertir.
- **Dónde:** dejar el archivo en `apps/dashboard/public/help/` y commitear.
- El "qué mostrar" de cada clave está en `apps/dashboard/public/help/README.md`.

---

## Prioridad 1 — Onboarding / conexión (máximo valor)
- [ ] `channelsWhatsapp` — Embedded Signup de Meta (conectar WhatsApp)
- [ ] `channelsInstagram` — OAuth de Instagram DM
- [ ] `channelsMessenger` — login FB SDK + selección de página
- [ ] `channelsTelegram` — pegar Bot Token de @BotFather
- [ ] `channelsEmail` — conexión de email
- [ ] `channelsWhatsappTemplates` — crear/sincronizar plantilla
- [ ] `agent` — crear agente desde plantilla + asignar canal
- [ ] `pipeline` — arrastrar tarjeta entre etapas
- [ ] `inbox` — filtros + tomar handoff

## Prioridad 2 — Uso diario (alto valor)
- [ ] `contacts` — filtros avanzados + detalle 360°
- [ ] `automation` — crear regla (trigger → condición → acción)
- [ ] `automationTemplates` — instalar una plantilla
- [ ] `broadcast` — crear campaña + audiencia
- [ ] `appointments` — configurar disponibilidad + crear cita
- [ ] `knowledge` — subida masiva + consultas sin respuesta
- [ ] `procedures` — "Redactar SOP" → compilar a pasos
- [ ] `crmAnalytics` — recorrer pestañas (embudo/velocidad)
- [ ] `reportBuilder` — armar un reporte y guardarlo

## Prioridad 3 — Opcional (config / verticales / super-admin)
La mayoría de tabs de **Settings** (`settings*`), **verticales** (`classes`, `tours`,
`listings`, `treatmentPlans`, etc.) y paneles de **super-admin** (`financials`, `tenants`,
`health`, `llmStats`, `verticalAnalytics`, `managed`, `usage`, `funnel`, `attribution`,
`audit`, `complianceAdmin`, `plans`, `coupons`) son en general autoexplicativos.
Grabar GIF solo donde un recorrido aporte (sugeridos: `settingsSecurity`,
`settingsScoringConfig`, `settingsPrechat`, `identity`, `inventory`, `orders`).
Lista completa de claves: ver `apps/dashboard/public/help/README.md`.

## Notas
- `channelsSms` y `settingsIntegrations` son redirects (sin panel); su contenido i18n
  está pre-cargado para cuando esas UIs existan — no requieren GIF aún.
- Al subir un GIF, basta con `git add apps/dashboard/public/help/<clave>.gif` + push;
  se despliega por el pipeline normal y aparece automáticamente.
