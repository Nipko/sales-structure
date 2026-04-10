# Guía de tema visual y sistema de navegación para la plataforma

## Objetivo

Definir un sistema visual moderno, profesional, limpio y escalable para una plataforma SaaS/B2B, con soporte real para light mode, dark mode y system mode, además de una navegación sólida para CRM, operaciones, automatizaciones, reportes y configuración.

Este documento está pensado para entregarse directamente a un agente de código y servir como base de implementación.

---

## Conclusión de la investigación

Sí: **ya existen bases visuales y de navegación muy maduras** que encajan casi exactamente con lo que buscamos. No conviene inventar todo desde cero.

La mejor estrategia es combinar:

1. **Arquitectura visual basada en design tokens**
2. **Sistema de componentes serio y accesible**
3. **Sidebar / app shell moderno para productos SaaS complejos**
4. **Soporte nativo para light / dark / system**

### Base recomendada

**Stack visual recomendado:**
- **Radix Themes / Radix Primitives** para estructura, accesibilidad y theming
- **shadcn/ui** como base práctica de componentes y dashboard shell
- **Tailwind CSS** para implementación rápida y consistente
- **Design Tokens** como contrato del sistema visual

### Sistemas/documentaciones que más se alinean

#### 1. Radix Themes
Muy alineado con lo que buscamos para una app seria, limpia y moderna:
- soporte claro de light/dark
- layout bien resuelto
- componentes sobrios
- filosofía fuerte de composición
- estética enterprise / product UI

Uso recomendado: **base del sistema visual**.

#### 2. shadcn/ui
Muy útil para implementación real:
- dark mode práctico
- theming por variables CSS
- sidebar ya pensado para aplicaciones
- componentes modernos y ampliamente adoptados

Uso recomendado: **base práctica para construir rápido**.

#### 3. Atlassian Design Tokens
Muy buena referencia para:
- diseño con tokens
- dualidad light/dark
- consistencia en apps complejas
- escalabilidad para múltiples productos

Uso recomendado: **modelo conceptual para tokens y semántica**.

#### 4. IBM Carbon
Muy fuerte para software enterprise:
- temas claros y oscuros bien estructurados
- enfoque serio de color y contraste
- organización por themes y tokens

Uso recomendado: **referencia de disciplina enterprise**.

#### 5. Material Design 3
Muy útil para decidir **cómo ubicar menús y navegación**:
- drawer
- navigation rail
- responsive adaptation
- jerarquía de destinos

Uso recomendado: **referencia para navegación responsive**.

---

## Decisión recomendada

### Nombre del sistema
**Professional Clean Platform UI**

### Filosofía
Una interfaz:
- profesional
- limpia
- moderna
- sobria
- premium
- enfocada en productividad
- excelente para operaciones, dashboards, CRM y automatización

### Qué no debe ser
- recargada
- colorida en exceso
- “startup juguetona”
- llena de degradados
- con glassmorphism pesado
- demasiado minimalista al punto de perder claridad operativa

---

## Tema visual recomendado

### Tema principal
**`professional-clean`**

Variantes:
- `professional-clean-light`
- `professional-clean-dark`
- `system`

### Temas futuros opcionales
Dejar preparados, pero no priorizar en la primera fase:
- `graphite`
- `midnight`
- `warm-neutral`
- `ocean`

---

## Dirección estética

### Sensación buscada
Pensar en una mezcla entre:
- Linear
- Vercel dashboard
- Notion
- Stripe dashboard
- apps modernas hechas con shadcn/ui + Radix

### Principios visuales
- mucho espacio en blanco
- jerarquía clara
- texto muy legible
- bordes suaves
- sombras discretas
- tablas limpias
- formularios claros
- estados consistentes
- animaciones cortas y sutiles
- foco fuerte en usabilidad antes que decoración

---

## Paleta y color

### Regla general
Base neutra + un color de acento fuerte pero sobrio.

### Recomendación
**Color principal:** azul índigo sobrio

Porque comunica:
- confianza
- tecnología
- estabilidad
- producto serio

### Light mode
- fondo principal: blanco roto / gris muy claro
- superficies: blanco o casi blanco
- bordes: gris suave
- texto principal: gris muy oscuro
- texto secundario: gris medio
- acento: azul índigo

### Dark mode
- fondo principal: gris muy oscuro, no negro puro general
- superficies: un nivel más claras que el fondo
- bordes: suaves pero visibles
- texto principal: casi blanco
- texto secundario: gris claro
- acento: el mismo azul con ajuste para contraste

### Regla crítica
No usar colores hardcodeados dentro de componentes.
Todo debe salir de tokens.

---

## Arquitectura de temas

## Soporte obligatorio
- `light`
- `dark`
- `system`

## Persistencia
Guardar preferencia de tema del usuario.

Prioridad de resolución:
1. preferencia explícita del usuario
2. system theme
3. fallback light

## Aplicación técnica
Aplicar el tema en:
- `html`
- o `data-theme`
- y sincronizar con `color-scheme`

Ejemplo de estrategia:
- `html.light`
- `html.dark`
- `html[data-theme="professional-clean-light"]`
- `html[data-theme="professional-clean-dark"]`

---

## Design tokens requeridos

## Tokens globales
```css
:root {
  --bg: ;
  --bg-subtle: ;
  --surface: ;
  --surface-elevated: ;
  --surface-hover: ;
  --border: ;
  --border-strong: ;
  --text: ;
  --text-muted: ;
  --text-soft: ;
  --primary: ;
  --primary-hover: ;
  --primary-active: ;
  --primary-foreground: ;
  --success: ;
  --warning: ;
  --danger: ;
  --info: ;
  --focus-ring: ;
  --shadow-sm: ;
  --shadow-md: ;
  --shadow-lg: ;
  --radius-sm: ;
  --radius-md: ;
  --radius-lg: ;
  --radius-xl: ;
}
```

## Tokens semánticos por componente
```css
:root {
  --card-bg: ;
  --card-border: ;
  --input-bg: ;
  --input-border: ;
  --input-placeholder: ;
  --sidebar-bg: ;
  --sidebar-border: ;
  --sidebar-item-hover: ;
  --sidebar-item-active: ;
  --sidebar-item-active-text: ;
  --table-header-bg: ;
  --table-row-hover: ;
  --modal-bg: ;
  --popover-bg: ;
  --badge-neutral-bg: ;
  --badge-neutral-text: ;
}
```

## Tokens de spacing y layout
```css
:root {
  --space-1: ;
  --space-2: ;
  --space-3: ;
  --space-4: ;
  --space-5: ;
  --space-6: ;
  --sidebar-width: 272px;
  --sidebar-width-collapsed: 72px;
  --topbar-height: 64px;
  --content-max-width: 1600px;
}
```

---

## Tipografía

### Recomendación
- **Primaria:** Inter
- **Monoespaciada:** JetBrains Mono o Geist Mono

### Escala sugerida
- display / headings: 700
- section titles: 600
- body: 400–500
- labels: 500–600
- captions: 500

### Principios
- line-height cómodo
- buen contraste
- no usar demasiados tamaños
- jerarquía simple y repetible

---

## Sistema de navegación recomendado

Aquí es donde más vale la pena apoyarse en patrones ya documentados.

## Recomendación principal
Usar un **App Shell** con esta estructura:

### Desktop
- **Sidebar izquierda fija**
- **Topbar superior**
- **Contenido principal**
- **Panel contextual derecho opcional**

### Tablet / pantallas medias
- sidebar colapsable
- o navigation rail si la app lo necesita

### Mobile
- drawer temporal
- topbar con acceso hamburguesa

---

## Colocación recomendada de menús

### 1. Sidebar izquierda como navegación principal
Es la mejor opción para una plataforma compleja porque:
- escala mejor que un menú superior
- soporta módulos y submódulos
- mejora orientación espacial
- funciona mejor para CRM, operaciones, tickets, automatizaciones y settings

### 2. Topbar superior para acciones globales
Debe contener:
- búsqueda global
- selector de workspace o empresa
- notificaciones
- accesos rápidos
- ayuda
- perfil de usuario
- selector de tema

### 3. Panel derecho opcional
Solo para:
- detalles contextuales
- filtros avanzados
- actividad
- inspector
- vista rápida

No debe usarse como navegación principal.

---

## Estructura de menú recomendada

### Bloques del sidebar
```txt
[Logo / Workspace]

Principal
- Inicio
- Bandeja / Conversaciones
- Clientes / Contactos
- Oportunidades / Ventas

Operación
- Automatizaciones
- Campañas
- Tickets / Casos
- Reservas / Órdenes / Procesos

Análisis
- Reportes
- Métricas
- Auditoría / Logs

Configuración
- Canales
- Integraciones
- Usuarios y roles
- Facturación
- Preferencias
```

### Reglas
- máximo 1 nivel visible + subnivel expandible
- ícono + label siempre
- colapsado a solo íconos en escritorio si el usuario quiere
- grupo activo claramente resaltado
- breadcrumb dentro del contenido
- no meter demasiadas rutas en primer nivel

---

## Comportamiento del sidebar

### Debe soportar
- expandido
- colapsado a íconos
- hover reveal opcional en colapsado
- submenús expandibles
- estado activo persistente
- scroll interno si el menú crece
- footer fijo con perfil o acceso rápido a settings

### Estado visual recomendado
- item normal
- item hover
- item active
- group expanded
- disabled
- badge count opcional

---

## Cuándo usar top navigation en vez de sidebar

Solo si la plataforma fuera muy simple.

Para este caso, **no lo recomiendo** como navegación principal, porque la app apunta a crecer en:
- CRM
- canales
- automatizaciones
- analytics
- configuración
- backoffice

Todo eso funciona mejor con sidebar.

---

## Navigation rail

Se puede contemplar en responsive intermedio, pero **no como patrón principal**.

Úsalo solo si:
- el viewport es mediano
- se requiere ahorrar espacio horizontal
- los destinos principales son pocos y muy claros

No lo usaría como único sistema para escritorio.

---

## Componentes visuales clave

## Botones
- tamaños consistentes
- radio medio
- foco visible
- variantes: primary, secondary, ghost, danger
- transiciones suaves

## Inputs
- altura uniforme
- borde limpio
- focus ring visible
- placeholder suave
- error state claro

## Cards
- padding generoso
- bordes suaves
- sombra mínima
- muy buena separación de bloques

## Tablas
- header sutil
- filas claras
- hover suave
- alineación impecable
- acciones visibles pero no invasivas

## Badges
- discretos
- usar semántica visual
- no abusar del color

## Modales / drawers
- foco claro
- overlay elegante
- espaciado amplio
- CTA principal bien visible

---

## Accesibilidad mínima obligatoria

- contraste suficiente en light y dark
- focus visible en todos los controles
- navegación por teclado
- labels claros
- estados hover/focus/active/disabled definidos
- no depender solo del color para comunicar estado
- tamaños de click/tap razonables

---

## Animación y motion

### Regla
Sutil y rápida.

### Sí usar
- transiciones de color
- expand/collapse del sidebar
- hover suave
- aparición corta en modales, dropdowns y tooltips

### No usar
- animaciones largas
- rebotes innecesarios
- efectos pesados que resten sensación enterprise

---

## Implementación recomendada para el agente

## Stack sugerido
- Next.js o React
- Tailwind CSS
- Radix Primitives
- shadcn/ui
- next-themes o provider equivalente
- tokens CSS variables

## Estructura sugerida
```txt
/src
  /components
    /ui
    /layout
      app-shell.tsx
      sidebar.tsx
      topbar.tsx
      breadcrumbs.tsx
      right-panel.tsx
  /theme
    tokens.css
    professional-clean-light.css
    professional-clean-dark.css
    graphite.css
    midnight.css
    theme-provider.tsx
    use-theme.ts
  /app
    /(dashboard)
```

---

## Entregables que debe producir el agente

1. Sistema de tokens globales
2. Tokens light
3. Tokens dark
4. Theme provider
5. Persistencia de tema
6. Selector de tema en topbar
7. Sidebar expandible/colapsable
8. App shell responsive
9. Página de preview de componentes y temas
10. Documentación corta para crear nuevos temas

---

## Decisión final recomendada

### Lo que sí construir ya
- `professional-clean-light`
- `professional-clean-dark`
- `system`
- sidebar izquierda fija + topbar
- menú agrupado por dominios
- tokens semánticos completos

### Lo que dejar preparado
- `graphite`
- `midnight`
- panel contextual derecho
- rail para pantallas intermedias

---

## Prompt final listo para pasar al agente

```txt
Diseña e implementa un sistema visual enterprise SaaS para la plataforma con enfoque profesional, limpio, moderno y premium.

Objetivo:
Crear una interfaz sólida para CRM, automatizaciones, conversaciones, reportes, integraciones y configuración.

Requerimientos:
- Tema principal: professional-clean
- Soporte para light, dark y system
- Arquitectura completa basada en design tokens
- No usar colores hardcodeados dentro de componentes
- Implementar app shell con sidebar izquierda + topbar superior
- Sidebar expandible y colapsable
- Persistir preferencia de tema del usuario
- Soportar color-scheme
- Excelente accesibilidad y contraste
- Componentes basados en Tailwind + Radix + shadcn/ui
- Tipografía Inter y monoespaciada para logs/código
- Preparar base para temas graphite y midnight

Entregables:
1. tokens.css
2. professional-clean-light.css
3. professional-clean-dark.css
4. theme-provider.tsx
5. use-theme.ts
6. sidebar responsive
7. topbar con theme switcher
8. preview page de temas y componentes
9. documentación para extender temas
```

---

## Referencias base investigadas

Estas referencias sirven como fundamento para implementar el sistema:

- Radix Themes: dark mode, layout y theming
- shadcn/ui: dark mode, theming y sidebar
- Atlassian Design Tokens: modelo semántico de tokens y soporte light/dark
- IBM Carbon: temas claros/oscuros para software enterprise
- Material Design 3: navigation drawer y navigation rail
- Design Tokens Community Group: estandarización del concepto de design tokens

