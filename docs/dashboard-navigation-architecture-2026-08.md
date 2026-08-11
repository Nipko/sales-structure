# Arquitectura de navegación del dashboard — agosto de 2026

## Objetivo

La navegación de Parallly debe hacer visible el trabajo importante sin convertir
el sidebar en una lista plana de módulos internos. La solución usa una jerarquía
estable, sensible al rol y a la vertical, con una sola autoridad para rutas,
etiquetas, breadcrumbs, retornos y visibilidad.

## Referentes y decisiones

- Carbon recomienda panel lateral cuando existen más de cinco opciones
  secundarias o se cambia con frecuencia entre ellas, y limita la jerarquía a
  dos niveles. Parallly conserva sidebar izquierda y mueve el tercer nivel a la
  página mediante tabs o navegación local.
- Material ordena destinos por importancia, frecuencia y secuencia natural, y
  mantiene relacionados juntos. Por eso Conversaciones/CRM aparecen antes que
  configuración o facturación.
- Intercom permite reorganizar, fijar y plegar destinos, y expone búsqueda global
  con `Ctrl/Cmd+K`. Parallly adopta preferencias persistentes, favoritos,
  recientes y paleta de comandos sin alterar el orden base.
- HubSpot agrupa herramientas por función y complementa la jerarquía con
  búsqueda global. Parallly agrupa por trabajo del usuario, no por módulos del
  backend.
- WCAG 2.2 exige navegación repetida en orden relativo consistente, reflow sin
  pérdida y foco visible/restaurado. El shell usa links/botones semánticos,
  `aria-current`, disclosure con `aria-expanded`, skip link y drawers modales.

Fuentes primarias:

- Carbon UI shell left panel: https://carbondesignsystem.com/components/UI-shell-left-panel/usage/
- Carbon accessibility: https://preview.carbondesignsystem.com/building-blocks/core/components/ui-shell-left-panel/accessibility
- Material navigation drawer: https://m2.material.io/components/navigation-drawer
- Intercom custom inbox: https://www.intercom.com/help/en/articles/7911926-customize-the-inbox-to-suit-you-and-how-you-work-best
- Intercom workspace settings: https://www.intercom.com/help/en/articles/9385650-your-workspace-settings
- HubSpot navigation: https://knowledge.hubspot.com/help-and-resources/a-guide-to-hubspots-navigation
- WCAG consistent navigation: https://www.w3.org/WAI/WCAG22/Understanding/consistent-navigation.html
- WCAG 2.2: https://www.w3.org/TR/WCAG22/

## Jerarquía canónica

1. **Esenciales** — Inicio, Conversaciones y CRM.
2. **IA y crecimiento** — Agente IA, Procedimientos, Conocimiento,
   Automatización y Campañas.
3. **Operación** — módulos habilitados por la vertical.
4. **Insights** — Análisis y rendimiento.
5. **Administración** — canales, usuarios, cumplimiento y facturación.
6. **Zona estable del pie** — Ayuda, Novedades y Configuración.

Los grupos secundarios son plegables y recuerdan la preferencia. El grupo activo
se abre automáticamente. El sidebar completo puede reducirse a rail en desktop;
en móvil se convierte en drawer modal.

## Contratos técnicos

- `navigation-contract.ts`: registro de todas las rutas `/admin`, matching por
  segmentos, títulos, padres semánticos, breadcrumbs y `returnTo` seguro.
- `navigation-access.ts`: decisión única rol + impersonación + vertical.
- `vertical-dashboard-resolver.ts`: módulos operativos realmente visibles.
- `_settings-config.ts`: única fuente para hub y navegación local de Settings.
- `navigation-preferences.ts`: favoritos y recientes sanitizados; las rutas
  retiradas o no descubribles no reaparecen.
- `product-tour-contract.ts`: anclas estables del tour y frontera responsive.

La URL directa, el sidebar, la paleta y los favoritos deben aplicar la misma
decisión. Ninguna superficie puede mostrar un enlace que el layout rechazará.

## Reglas de retorno

- Settings recibe `returnTo` solo si es una ruta interna registrada y permitida.
- Query y hash se preservan para no perder filtros del Inbox, CRM o Embudo.
- Las páginas de detalle usan breadcrumb semántico y padre inmediato en móvil.
- Una ruta denegada vuelve al destino inicial del rol, nunca a un dashboard
  genérico o a una sección sin relación.

## Tour y asistente de configuración

- El primer paso apunta a **Agente IA**, no a Automatización.
- Antes de medir un target se abren los grupos requeridos y se espera el render.
- Las etiquetas verticales usan el mismo resolver que sidebar/paleta.
- El tour anclado se difiere bajo 768 px; queda pendiente hasta existir sidebar
  persistente, evitando punteros sobre elementos ocultos.
- Las tarjetas “Descúbrelo” y Email abren otra pestaña, de modo que el wizard no
  pierde progreso ni expulsa al usuario antes de Finalizar.
- El wizard es un Dialog modal con foco contenido. Copiloto y tour no se abren
  simultáneamente.

## Criterios de regresión

- exactamente un `aria-current="page"` por navegación;
- filesystem `/admin/**/page.tsx` cubierto por el registro canónico;
- rutas no descubribles ausentes de búsqueda, favoritos y recientes;
- matrices rol/API y vertical/ruta alineadas;
- Settings vuelve al origen completo;
- drawers caben a 390 px, cierran con Escape y restauran foco;
- tour pendiente en móvil no se consume y al pasar a desktop apunta a Agente IA;
- paridad total de claves es/en/pt/fr;
- Playwright hermético: ninguna llamada al API productivo.
