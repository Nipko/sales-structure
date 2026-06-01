# Rediseño de Onboarding — Investigación + Propuesta (Q2 2026)

> **Objetivo de este documento.** Parallly tiene una premisa de marca: **fácil de configurar y rápido**. Hoy no la cumple en el momento que más importa — el primer valor. Este documento (1) diagnostica con honestidad el onboarding actual, (2) destila cómo lo resuelven 13 competidores + la ciencia UX, y (3) propone **un onboarding único, guiado y obligatorio en lo esencial** que lleve a un usuario nuevo desde el registro hasta **su primer canal conectado y su agente respondiendo**, sin abrumarlo, y **cohesionado con la pantalla de configuración inicial (`/onboarding`)** y con todas las features nuevas que hemos creado.
>
> **Alcance:** investigación + diseño. No incluye código. La Parte 8 entrega un roadmap por fases listo para una sesión de implementación.
>
> **Fecha:** 2026-05-31 · **Relacionado:** `docs/competitive-analysis-2026-q2.md` (dimensión #25 Onboarding 7/10), `docs/platform-audit-2026-05.md`, `docs/vertical-strategy.md`.

---

## 0 — Resumen ejecutivo (TL;DR)

**El problema en una frase:** nuestro onboarding recoge mucha información del negocio pero **nunca pone al usuario a conectar su primer canal dentro del flujo guiado** — la única acción que genera valor real. El "time-to-first-value" (TTFV) queda librado a un banner opcional que se puede descartar.

**Los 3 síntomas:**
1. **Fragmentación.** Tenemos 3 piezas de onboarding desconectadas: el wizard de registro `/onboarding` (5 pasos), el wizard post-registro `/admin/setup-wizard` ("Configura tu agente IA", 3 pasos), y el `OnboardingChecklist` lateral. Se solapan y ninguna cierra el loop.
2. **El primer canal no es obligatorio ni guiado.** `/onboarding` termina en "Plan"; `setup-wizard` solo deja *seleccionar* qué canal quieres (no lo conecta). Conectar WhatsApp — el cuello de botella real — queda fuera del camino crítico.
3. **~13 features nuevas sin hogar.** Procedimientos (T2.12), Simulación (T2.13), dual-skillset/ecommerce (T2.17), integraciones verticales (T3.19), MCP, reviews, atribución, B2B orgs, managed… ninguna está reflejada ni jerarquizada en el onboarding. Eso es lo que hay que **normalizar**.

**La propuesta en una frase:** **una sola ruta crítica obligatoria y corta** — *Tu negocio → Tu agente (auto) → Pruébalo → Conéctalo → Descúbrelo* — donde `/onboarding` es la primera fase, **conectar al menos un canal** es el clímax obligatorio (**WhatsApp es el principal/recomendado, pero Instagram, Messenger, Telegram, Email o el web-chat también completan el paso**; Coexistence/QR como estrella + sandbox para probar sin compromiso), seguido de un **tour guiado vertical-aware** que presenta las demás herramientas (qué son y para qué sirven) e incluye el **copilot**, y **todo lo demás se difiere** a un hub con checklist de divulgación progresiva, jerarquizado por plan y por vertical.

**Impacto esperado (basado en benchmarks de la Parte 2):** activación (= primer canal conectado y respondiendo) es el evento que separa el ~36% que retiene del ~64% que no. Mover la conexión al camino crítico + reducir su fricción es la palanca de mayor ROI de todo el producto.

> **✅ La buena noticia — esto es 100% trabajo de flujo/UX, no de infraestructura.** Parallly ya es **Meta Tech Provider** y tiene **implementados** el **Embedded Signup** (propio/hosted), la **Coexistencia** (conectar el número existente vía QR) y la **migración de los 6 meses de historial de chats** (`apps/whatsapp`, `apps/dashboard/src/app/admin/channels/whatsapp/`, `docs/coexistence-manual.md`). El stack de conexión existe y funciona — lo que falta es **exponerlo dentro del flujo guiado obligatorio** en vez de dejarlo detrás de un menú opcional. Eso reduce drásticamente el riesgo y el esfuerzo del rediseño: la Fase 1 es **cablear**, no construir.

```
ANTES (fragmentado, el valor queda fuera del flujo):
  signup → /onboarding (5 pasos: empresa, audiencia, objetivos, referido, plan)
         → /admin (¡ya estás dentro, sin canal!) → setup-wizard opcional (elige canal, no conecta)
         → banner descartable "conecta un canal" → … la mayoría nunca conecta

DESPUÉS (un solo hilo guiado que termina en valor real):
  signup → Tu negocio (vertical → auto-bootstrap) → Tu agente (ya creado, ajusta nombre/tono)
         → Pruébalo (chat de prueba = "aha") → CONÉCTALO (≥1 canal: WhatsApp⭐/IG/Messenger/Telegram/Email — OBLIGATORIO)
         → Descúbrelo (tour guiado por vertical: qué herramientas hay y para qué + copilot)
         → ¡Listo! Dashboard + checklist progresivo (lo demás, a tu ritmo)
```

---

## PARTE 1 — Diagnóstico: el onboarding actual de Parallly

### 1.1 — Las 3 piezas que tenemos hoy (y por qué no encajan)

| Pieza | Ruta | Pasos | ¿Obligatorio? | Qué hace bien | El problema |
|---|---|---|---|---|---|
| **Wizard de registro** ("configuración inicial") | `/onboarding` | 5: empresa+vertical → audiencia → objetivos → referido → plan | **Sí, sin skip** | Captura el vertical y dispara `bootstrapVertical()` (persona, pipeline, FAQs, servicios, horarios) | Termina en "Plan". **Nunca toca canales.** Pasos 2-4 (audiencia/objetivos/referido) son recolección de inteligencia, no valor para el usuario |
| **Wizard del agente** | `/admin/setup-wizard` ("Configura tu agente IA") | 3: plantilla → personaliza → canales | Soft-gate (se puede "Omitir por ahora") | Deja nombrar/tonar el agente | **Redundante** con el auto-bootstrap del vertical. El paso "Canales" solo **selecciona**, no conecta. Es saltable |
| **Checklist lateral** | `OnboardingChecklist.tsx` (rail derecho) | 4 esenciales + 5 recomendados | No (descartable) | Ya tiene el modelo correcto: *agente → canal → mensaje de prueba* | Es un widget pasivo y descartable. **Nada empuja** al usuario. El canal queda como un ítem más entre nueve |

> **El hallazgo central:** el `OnboardingChecklist` **ya define los esenciales correctos** (`configureAgent` → `connectChannel` → `sendTestMessage`). El problema no es conceptual, es de **fuerza y secuencia**: esos pasos viven en un panel descartable en lugar de ser un flujo guiado obligatorio.

### 1.2 — El camino real de un usuario nuevo hoy

```
/signup → /verify-email → (/setup-password si Google) → /onboarding (5 pasos, obligatorio)
        → backend: crea tenant + bootstrap del vertical + agente por defecto + business_info
        → /admin  ← AQUÍ YA ESTÁ "DENTRO", PERO SIN NINGÚN CANAL CONECTADO
        → (primera visita) bounce a /admin/setup-wizard  ← se puede omitir
        → checklist lateral con "Conectar un canal"  ← se puede descartar
```

**Consecuencia:** un usuario puede llegar al dashboard, "completar" el setup-wizard, y **no tener ningún canal conectado** — es decir, un producto que no puede recibir ni un solo mensaje de cliente. El momento de valor nunca llega.

### 1.3 — Lo que el mínimo técnico realmente exige (para calibrar qué forzar)

Del análisis del pipeline de conversación:

| Requisito | ¿Bloquea que la IA funcione? | Estado |
|---|---|---|
| **≥1 canal conectado** | **SÍ** (sin canal no entra ni sale ningún mensaje) | ❌ Hoy no se fuerza |
| **Una persona/agente** | Sí, pero con **fallback automático** (`buildDefaultPersona`) | ✅ Auto-resuelto por el bootstrap del vertical |
| Business info | No (mejora el contexto) | ✅ Capturado en `/onboarding` paso 1 |
| Vertical | No, pero dispara todo el bootstrap | ✅ Capturado en `/onboarding` paso 1 |
| KB, citas, CRM, procedimientos, etc. | No | Diferibles |

> **Implicación de diseño:** la **única cosa estrictamente indispensable que hoy NO forzamos es la conexión del canal.** El agente ya se auto-crea. Por tanto, la ruta crítica obligatoria se reduce casi por completo a **"conecta tu primer canal"** — todo lo demás puede ser auto-bootstrap o diferido.

### 1.4 — Las features nuevas sin lugar en el onboarding

Creadas en mayo 2026, ninguna está jerarquizada ni introducida en el onboarding:

`Procedimientos (T2.12)` · `Simulación de agente (T2.13)` · `Dual-skillset / ecommerce (T2.17)` · `Integraciones verticales Toast/Mindbody/Cliniko (T3.19)` · `MCP (T3.20)` · `B2B Organizations (T3.21)` · `Atribución Click-to-WA (T3.22)` · `Reviews / Google Business (T3.23)` · `Managed / done-for-you (T3.24)` · más KB avanzado, multi-agente, multi-calendario, plantillas WA, web chat widget…

Sin una jerarquía explícita, cada feature nueva que agregamos **aumenta la sensación de abrumamiento**. La Parte 5 las normaliza en niveles.

### 1.5 — Autoevaluación competitiva (de `competitive-analysis-2026-q2.md`)

> Dimensión **#25 Onboarding: 7/10** — *"Wizard ✅. Falta time-to-first-value medido (conexión WA)"*. Tidio/Leadsales puntúan 8/10 con setup <5 min.
> Parte 7 del mismo doc: *"El cuello de botella real es la conexión de WhatsApp (Embedded Signup de Meta) — ganar ahí (<15 min) es un diferenciador concreto."*

Este rediseño es la ejecución de ese hallazgo.

---

## PARTE 2 — Cómo lo hacen los competidores (teardown de 13 rivales)

Investigación web fresca (2024-2026) sobre 4 clusters. Teardowns completos en el **Anexo A**; aquí va la síntesis accionable.

### 2.1 — Matriz comparativa

| Competidor | Cluster | Pasos a primer valor | Qué obligan | Conexión 1er canal | Anti-abrumamiento estrella |
|---|---|---|---|---|---|
| **Leadsales** | LatAm | ~15 min ("Vibe Selling") | Conectar WA (QR) + describir negocio | **QR** + autogenera agente desde la **URL del sitio** | Setup declarativo + sandbox de prueba |
| **Whaticket** | LatAm | "5 min" (marketing) | Conectar número (QR) | **QR** (1ª línea gratis) | "Starter kit" de 3 pasos operativos |
| **Cliengo** | LatAm | Widget ~1 min | Crear bot → conectar canal | Web snippet / **WA Lite QR** (API = asistida) | Estado verde + confirmación al WhatsApp del dueño |
| **Yalo** | LatAm (ent.) | Semanas (gestionado) | WA **API** + plantillas + integración | Embedded Signup (BSP) | "Done-for-you" — absorbe la complejidad de Meta |
| **Wati** | WA-first | <2 h (reviews) | Suscripción + Embedded Signup | **Embedded Signup (9 pasos)** + nº 555 sandbox | "No tengo web" + sandbox sin OTP |
| **Respond.io** | WA-first | Checklist 4 pasos | Conectar ≥1 canal | **Embedded Signup** + **Coexistence (QR, ~2 min)** | Checklist con divulgación progresiva en cascada |
| **360dialog** | WA-first (BSP) | Varios min | Embedded Signup | **Embedded Signup (10 pasos)** + Coexistence | Hostear tu propio ESU + pre-fill + aviso de expiración |
| **Manychat** | SMB-simple | Minutos | OAuth IG/FB + 1 trigger + 1 msg | IG/Messenger **OAuth inline** | Preview dual-pane sin canal real + plantillas 3-clics |
| **Tidio** | SMB-simple | **~20 min** (promesa) | Sitio web + info negocio | Web widget (snippet/app) | **Scraping de URL** para poblar el KB de Lyro |
| **Landbot** | SMB-simple | Minutos | Starting Point block | Web (sin OAuth) / WA | 3 puertas: "hazlo por mí (IA)" / plantilla / desde cero |
| **Intercom Fin** | AI-native | <1 h | **≥10 artículos KB** | Messenger + canales después | Train→Test→Deploy; "Simple deploy" vs avanzado |
| **Ada** | AI-native | 8-16 sem (gestionado) | KB limpio | Por canal, con sandbox | Onboarding por canal + "lo configuramos por ti" |
| **Sierra / Decagon** | AI-native (ent.) | 3-10 sem | **Pasar simulaciones** | Gestionado | **Simulación auto-generada como gate de go-live** |

### 2.2 — Síntesis por cluster

**🌎 LatAm (Leadsales, Whaticket, Cliengo, Yalo) — nuestro mercado directo:**
1. **QR primero, API después.** El on-ramp dominante para PYMEs es **escanear un QR y reutilizar el número existente** — fricción casi nula. La WhatsApp API/Embedded Signup se difiere o se reserva para enterprise.
2. **Time-to-value en minutos, con bootstrap automático.** "5 min / 15 min / mismo día". Leadsales autogenera el agente desde la **URL del sitio**; Cliengo instala en ~1 min.
3. **Setup declarativo, no constructivo ("Vibe Selling").** Describir el negocio en lenguaje natural en vez de armar árboles de decisión. **Es exactamente la narrativa que Parallly debe ganar con su auto-bootstrap de 12 verticales.**
4. **Feedback de éxito explícito** (estado verde, confirmación al propio WhatsApp del dueño) + **red de seguridad humana** (onboarding 1:1).

**📱 WhatsApp-first (Wati, Respond.io, 360dialog) — cómo minimizan la fricción de conectar WA:** ver Parte 2.3.

**⚡ SMB-simplicity (Manychat, Tidio, Landbot) — las 6 tácticas anti-abrumamiento:**
1. **Plantilla en vez de lienzo en blanco** (templates-first como pantalla de entrada).
2. **"Hazlo por mí": auto-bootstrap** del contenido (Tidio scrapea tu URL; Landbot "Build it for me").
3. **Preview/sandbox antes de tocar un canal real** (Manychat: chat de prueba dual-pane).
4. **Diferir la fricción dura** (OAuth, integraciones, lógica avanzada) hasta después del primer valor.
5. **Un caso concreto y único primero** (un trigger + un mensaje), no la configuración completa.
6. **Discovery breve → defaults inteligentes + checklist con progreso visible.**

**🤖 AI-native (Intercom Fin, Ada, Sierra, Decagon) — "configura → prueba → despliega":**
1. **El conocimiento es el primer paso y el gate**, no un extra (Intercom: ≥10 artículos; Sierra: detecta knowledge gaps).
2. **"Plain English" para la lógica; código/integraciones diferidos** — Parallly ya lo tiene con su motor de procedimientos.
3. **La simulación es el diferenciador de confianza y se auto-genera** desde tus SOPs/KB/históricos; un "juez" devuelve pass/fail. Parallly **ya tiene simulación (T2.13)** — el salto es convertir "pasar simulación" en gate de go-live para planes Pro+.
4. **Despliegue progresivo, no big-bang** (por segmento / A-B / fases).
5. **Dos rutas: "simple/guiado" por defecto, "avanzado" opt-in.**
6. **El "aha" = primer outcome resuelto** (en simulación primero, en vivo después), no "completaste el formulario".

### 2.3 — El cuello de botella #1: WhatsApp Embedded Signup (deep-dive)

El abandono real no está en *nuestro* producto: está en el **popup de Meta**, donde el usuario debe loguearse en Facebook, crear/seleccionar un Business Portfolio, crear/seleccionar una WABA, registrar y **verificar un número por OTP**, y conceder permisos. Cómo lo bajan los líderes a <15 min:

1. **Embedded Signup nativo de Meta es obligatorio** (no construir flujo manual de Business Manager). Wati (9 pasos), respond.io y 360dialog (10) lo usan todos.
2. **Sandbox con el número gratis +1 555 de Meta ("display name only")** — la palanca #1 de TTFV: **no requiere OTP**, permite ver el agente respondiendo en minutos. El "aha" ocurre **antes** de la verificación. (Limitación honesta: sin campañas/templates/green tick hasta verificar.)
3. **Coexistence (escanear QR desde la WhatsApp Business App)** es el atajo de mínima fricción para PYMEs que ya usan WhatsApp: **conserva número e historial (hasta 6 meses), no exige migración, conecta en ~2 min.** Disponible desde mayo 2025. → **Es probablemente la ruta de menor abandono para LatAm.**
4. **Diferir la business verification de Meta** (la que tarda 3-14 días y exige web + documentos). Nunca ponerla en la ruta crítica del primer valor. Permitir "no tengo sitio web".
5. **Pre-rellenar el ESU** (nombre, categoría, timezone que ya capturamos en `/onboarding`) + `config_id` afinado para mostrar el mínimo de pantallas. **Ya somos Tech Provider y hospedamos nuestro propio ESU**, así que la palanca de pre-fill ya está a nuestro alcance — falta inyectarle los datos del vertical capturados en la Fase 1.
6. **Gestionar la expiración de 60 min del popup** y persistir estado (no reiniciar desde cero si se traba).
7. **Pre-check de prerrequisitos ANTES de abrir el popup** + **mapear cada error de Meta a un mensaje en español accionable** (tabla completa en Anexo B).

> **✅ Estado en Parallly (mayo 2026):** los puntos **1, 3 y 5 ya están construidos** — somos **Meta Tech Provider**, el **Embedded Signup** está implementado, y tenemos **Coexistencia + migración de 6 meses de chats** (`apps/whatsapp/src/modules/webhooks/webhooks.service.ts`, `apps/dashboard/src/app/admin/channels/whatsapp/`, `docs/coexistence-manual.md`). Lo que falta es **UX**: el **sandbox 555** como ruta de prueba (punto 2), el **pre-check** de prerrequisitos, el **mapa de errores en español** (punto 7) y, sobre todo, **mover toda esta conexión al flujo guiado obligatorio** (Parte 4).

### 2.4 — Ciencia UX: los números que fijan las reglas

| Pregunta | Respuesta basada en evidencia | Fuente |
|---|---|---|
| ¿Qué es "primer valor" aquí? | El **primer canal conectado y respondiendo un mensaje real** — no "cuenta creada" | Userpilot |
| Ventana crítica de retención | Primer valor **<14 días → ≥80%** retención M12; sin valor en 30 días → 35-50% | SaaSMag |
| Activación promedio SaaS | **36%** (≈2 de cada 3 signups **nunca activan**) | Userpilot |
| ¿Cuántos pasos es demasiado? | **>5 pasos → ~80% abandona**. Ruta crítica en **≤3** | Userpilot |
| ¿Cuántas opciones simultáneas? | >3-4 → fatiga; completion cae hasta 60% | SaaSFactor |
| Costo de cada campo extra | **−3 a −7%** completion por campo | Baymard |
| Caso real de simplificar | completion **23% → 67%** (+191%) solo acortando el flujo | SaaSFactor |
| Impacto de checklists (endowed progress) | **+21%** activación (MYOB); regalar progreso temprano motiva | Appcues |
| Templates en empty state | **75% vs 40%** de conversión de primera sesión (Canva) | Userpilot |
| Personalización por segmento/rol | **3× activación**; +10-20% completion | Userpilot/Appcues |
| Tooltips contextuales | −28% drop-off por paso, **pero después** de la 1ª sesión | Userpilot |

---

## PARTE 3 — Principios de diseño que adoptamos

Las **10 reglas de oro** destiladas de la investigación, adaptadas a Parallly:

1. **Activación = "primer canal conectado + agente respondió un mensaje".** Instrumentar ese evento y optimizar el TTFV hacia él.
2. **Una sola ruta crítica obligatoria: conectar el primer canal.** Todo lo demás → skippable y diferido.
3. **Wizard lineal de ≤ pocos pasos, una acción primaria por pantalla.** Nada de pedir audiencia/objetivos/referido antes del valor.
4. **Auto-bootstrap agresivo: el agente ya existe.** El vertical lo crea; el usuario solo ajusta nombre/tono y, opcionalmente, pega su web/IG para enriquecer el KB.
5. **Prueba antes de conectar (el "aha" sin fricción):** chat de prueba dual-pane disponible **antes** del Embedded Signup.
6. **Coexistence/QR como ruta estrella** del canal real: "conecta tu número actual sin perder tus chats". Sandbox 555 para "pruébalo sin compromiso".
7. **Pre-fill + pre-check del Embedded Signup**; difiere business verification y green tick; mapea errores de Meta a español accionable.
8. **Checklist post-conexión con progreso "regalado"** (cuenta ✓, agente ✓, canal ✓ ya marcados) y **divulgación progresiva** del resto.
9. **Mata el empty state con templates y defaults por vertical.** El sistema de 12 verticales es nuestro moat de onboarding — es la respuesta al "Vibe Selling" de Leadsales.
10. **Jerarquiza TODA feature** en niveles (crítico / día-1 / progresivo / avanzado / condicional por vertical). Ninguna feature nueva entra nunca a la ruta crítica.

### El marco "obligatorio vs opcional"

```
            RUTA CRÍTICA (lineal, obligatoria, ≤ pocos pasos):
  signup → Tu negocio+vertical → Tu agente(auto) → Pruébalo → CONÉCTALO (≥1 canal) → Descúbrelo (tour) → ¡Listo!
                                                                              ↓
            ┌─ HUB: divulgación progresiva (a tu ritmo, jerarquizado) ───────┐
            │  Día-1 esenciales · Recomendado contextual · Avanzado opt-in   │
            │  · Condicional por vertical                                     │
            └────────────────────────────────────────────────────────────────┘
```

---

## PARTE 4 — La propuesta: onboarding único, guiado y cohesionado

### 4.1 — El hilo guiado de extremo a extremo

Un **solo flujo continuo** que fusiona `/onboarding` + `/admin/setup-wizard` en una espina coherente y **pone la conexión del canal dentro del camino obligatorio**:

| Fase | Pantalla(s) | Acción del usuario | Qué pasa por detrás | ¿Obligatorio? |
|---|---|---|---|---|
| **0. Cuenta** | `/signup` + `/verify-email` | Email/Google + OTP | Crea user | Sí (mínimo) |
| **1. Tu negocio** *(= "configuración inicial" `/onboarding`)* | Paso A | **Nombre del negocio + Vertical (+ subtipo)** | `bootstrapVertical()`: persona, pipeline, FAQs, servicios, horarios | **Sí** |
| | Paso B | **Objetivo principal** (1-2 chips) + opcional **"pega tu sitio web / IG"** | Afina la persona; **scrapea la URL → enriquece el KB/RAG** (patrón Tidio/Leadsales) | Sí (chips) / opcional (URL) |
| **2. Tu agente** *(absorbe setup-wizard 1-2)* | Paso C | Ve el agente **ya creado**; ajusta **nombre + tono + saludo** (3 campos) | Plantilla pre-seleccionada por vertical (sin lienzo en blanco) | Mínimo (defaults válidos) |
| **3. Pruébalo** *(el "aha")* | Paso D | **Chatea con tu agente** en un panel de prueba dual-pane | Usa el contexto real del negocio; **no requiere canal** | Recomendado, no bloquea |
| **4. Conéctalo** ⭐ *(el clímax obligatorio — hoy ausente)* | Paso E | **Conecta al menos 1 canal** (WhatsApp⭐ / IG / Messenger / Telegram / Email) | Ver 4.3 | **SÍ — es la activación** |
| **5. Descúbrelo** 🧭 *(tour guiado, vertical-aware)* | Paso F | **Mini-tour de las herramientas clave** de tu vertical (qué son y para qué) + presentación del **copilot** | Ver 4.6; tarjetas educativas, no fuerza configurar | Recomendado, saltable |
| **6. ¡Listo!** | `/admin` | Aterriza en el dashboard | Checklist con progreso regalado (4/N ✓) | — |
| **(Plan/Trial)** | Inline o diferido | Trial-first: arranca solo; tarjeta diferida | Billing ya soporta trial | Diferible |

> **Decisión clave sobre el plan:** hoy `/onboarding` paso 5 pide el plan (con tarjeta para pagos) **antes** de que el usuario vea valor. Recomendación: **trial-first** — arrancar el trial automáticamente y **diferir la selección de plan/tarjeta a después de la activación** (reduce fricción; cada campo extra cuesta −3-7% completion). El billing ya soporta `trialing`.

### 4.2 — Qué cambia en `/onboarding` (la cohesión con "configuración inicial")

`/onboarding` **no se elimina — se convierte en la Fase 1 del hilo**, más corto y conectado al clímax:

| Paso actual | Decisión | Razón |
|---|---|---|
| 1. Empresa + vertical + subtipo + tamaño + zona horaria | **Conservar** (es el motor del auto-bootstrap) | Alto valor; dispara todo |
| 2. Audiencia (≥1) | **Comprimir** a 1 chip o fusionar con objetivo | Recolección de inteligencia, no valor; añade fricción |
| 3. Objetivos (≥1) | **Conservar comprimido** (afina la persona) | Útil para defaults; mantener 1 pantalla rápida |
| 4. Referido | **Mover** a micro-encuesta opcional post-activación | Es para nuestra analítica, no para el usuario; no debe bloquear |
| 5. Plan | **Trial-first**, tarjeta diferida | Quita el muro de pago antes del valor |
| — | **AÑADIR: enlace a Fase 4 "Conéctalo"** | El cambio estructural: el flujo ya no termina sin canal |
| — | **AÑADIR opcional: "pega tu sitio/IG"** | Bootstrap del KB en segundos (mayor impacto en TTFV) |

**Continuidad de datos (cohesión real, no solo visual):** el vertical y el business info capturados en Fase 1 **pre-rellenan** el Embedded Signup de la Fase 4 (nombre, categoría, timezone) y **pre-cargan** las plantillas/persona — de modo que cada fase alimenta a la siguiente en lugar de pedir lo mismo dos veces (hoy `/onboarding` y `setup-wizard` se solapan).

### 4.3 — La Fase 4 "Conéctalo" en detalle (el corazón del rediseño)

**El gate obligatorio es conectar ≥1 canal, no WhatsApp específicamente.** WhatsApp es el principal (mayor TTFV y el más pedido en LatAm) y se muestra **destacado** abajo; pero **Instagram, Messenger, Telegram, Email o el web-chat también completan el paso** vía sus flujos ya existentes (`/admin/channels/*`), presentados como opciones secundarias en la misma pantalla. El usuario elige; con **cualquiera**, la activación se cumple y el hilo continúa al tour. (Por eso el `OnboardingChecklist` ya usa el ítem genérico "Conectar un canal", no "Conectar WhatsApp".)

```
┌─ Conecta tu primer canal · WhatsApp (recomendado) ──────────────────┐
│                                                                      │
│  Pre-check (antes de abrir Meta):                                    │
│   ✓ ¿Tu número ya tiene WhatsApp?   ✓ ¿Acceso al SMS/OTP?            │
│   ✓ ¿2FA en tu cuenta Meta?         ✓ ¿Business Manager?            │
│                                                                      │
│  Elige cómo conectar (ordenado por fricción):                        │
│  ┌────────────────────────────────────────────────────────────┐     │
│  │ ⭐ Conecta tu número actual (Coexistence/QR)  ~2 min        │     │
│  │    "Sin perder tus chats ni desinstalar la app"            │     │
│  ├────────────────────────────────────────────────────────────┤     │
│  │ 🆕 Usa un número nuevo (Embedded Signup oficial)            │     │
│  │    Pre-rellenado con los datos de tu negocio               │     │
│  ├────────────────────────────────────────────────────────────┤     │
│  │ 🧪 Pruébalo con un número de prueba (sandbox 555, sin OTP)  │     │
│  │    "Explóralo sin compromiso, conéctalo después"           │     │
│  └────────────────────────────────────────────────────────────┘     │
│                                                                      │
│  Al conectar: ✅ estado verde + mensaje de confirmación al           │
│  WhatsApp del dueño (patrón Cliengo) → "¡Tu agente está en vivo!"    │
│                                                                      │
│  Diferido (NO bloquea): business verification, green tick,          │
│  método de pago para templates.                                      │
└──────────────────────────────────────────────────────────────────────┘
```

Cada error de Meta se traduce a un mensaje en español accionable con auto-fix (tabla completa en **Anexo B**). Se gestiona la **expiración de 60 min** del popup persistiendo el estado.

> **Estado:** la **Coexistencia (QR)** y la **migración de los 6 meses de historial** ya están **construidas** en Parallly (`apps/whatsapp` + `docs/coexistence-manual.md`); esta fase **reutiliza** ese flujo, no lo construye. El sandbox 555 y el pre-check de prerrequisitos sí son UI nueva a añadir. El único punto a confirmar es la **disponibilidad de Coexistence país por país en LatAm** (restricción de Meta, no nuestra): donde un país no la soporte, degradar a Embedded Signup con número nuevo + sandbox 555.

### 4.4 — El hub post-onboarding (qué hacer con el `OnboardingChecklist`)

El `OnboardingChecklist` actual **se conserva y se promueve** de "widget descartable" a **hub de activación con divulgación progresiva**:

- **Progreso regalado:** al aterrizar, ya hay 3/N ✓ (cuenta, agente, canal) → efecto "endowed progress".
- **Esenciales día-1** (los que faltan): probar en vivo, KB (pega tu web), horarios.
- **Recomendado contextual:** se revela según el vertical y el uso (no todo de golpe).
- **Vertical-aware:** los ítems cambian por industria (salud → "configura servicios y agenda"; retail → "conecta tu catálogo").
- **Más difícil de descartar accidentalmente** hasta alcanzar la activación; luego sí colapsa a píldora.

### 4.5 — "Prueba → Despliega" para planes Pro+ (reusar T2.13)

Para la PYME estándar, la Fase 3 "Pruébalo" es un chat de prueba ligero. Para **planes Pro+**, ofrecer (opt-in, no en la ruta crítica) la **Simulación de agente (T2.13)** como **gate de go-live** estilo Sierra/Decagon: auto-generar escenarios desde los procedimientos/KB del tenant, un "juez" devuelve pass/fail, y "pasar la simulación" habilita el despliegue. Esto convierte una feature que ya existe en un diferenciador de confianza que **ningún competidor LatAm tiene**.

### 4.6 — El tour guiado de herramientas (vertical-aware + copilot)

Tras conectar el canal, un **tour guiado** (saltable) le muestra al usuario, **según su vertical**, el mapa de herramientas con un mensaje central: *"esto es lo que hay, y así tu agente responde cada vez mejor."* Muestra **todas las relevantes** (no solo 3-5), de forma clara y explicada en una línea, dejando ver **qué existe** y **cómo seguir mejorando los resultados** del agente.

> **Objetivo principal del tour:** *personalizar el negocio para que el agente tenga las herramientas que necesita para responder bien.* Por eso el tour se organiza en **dos bloques con énfasis distinto:**

- **Bloque A — "Dale a tu agente con qué responder" (ÉNFASIS PRINCIPAL).** Las herramientas que **alimentan al agente y mejoran directamente la calidad de sus respuestas**. Se muestran **todas las relevantes** del vertical, explicadas en una línea, con un indicador de **"qué tan completo está tu agente"** y qué añadir para mejorar:
  - **Transversal (todas):** Base de conocimiento / FAQs (*pega tu web*) · Info del negocio (horarios, políticas, contacto) · Tono y reglas del agente · Procedimientos (cómo actuar ante reembolsos, reclamos…).
  - **Salud / belleza / gimnasio:** Servicios + agenda/disponibilidad (para responder "qué ofrecen / cuándo" y agendar).
  - **Retail / ecommerce:** Catálogo de productos · Sincronización Shopify/WooCommerce.
  - **Restaurantes:** Menú (· Toast si aplica).
  - **Inmobiliaria:** Listados / propiedades.
  - **Con integración vertical:** Mindbody / Cliniko / Toast (datos en vivo para responder con precisión).
- **Bloque B — "Herramientas de gestión" (RECORRIDO LIGERO, menos énfasis).** Ayudan a **operar** el negocio pero no cambian directamente *cómo responde* el agente; se mencionan al pasar, compactas:
  - CRM / pipeline · Analíticas / reportes · Broadcast / campañas · Automatizaciones · Inbox y handoff a humano · Equipo.
- **Narrativa de mejora:** cada herramienta del Bloque A se enmarca como *"súbele el nivel a tu agente"* — qué tiene, qué le falta y el impacto en sus respuestas. Es la versión activa de "cómo seguir mejorando para los mejores resultados".
- **Formato:** lista/tarjetas con icono + nombre + 1 frase de "para qué sirve" + enlace. **Bloque A primero y con peso visual; Bloque B compacto al final** — muestra más herramientas pero **agrupadas y escaneables** para no abrumar. **No bloquea**; "Saltar tour" siempre visible.
- **Pasa por el copilot:** una tarjeta final presenta el **Copilot de Parallly** (`HelpAssistant` / `POST /copilot/chat`): *"¿Dudas sobre cómo configurar algo? Pregúntale a tu copiloto — está en la esquina y te ayuda con canales, CRM, citas, automatizaciones y más."* Así el usuario sabe que tiene **ayuda contextual siempre disponible** y no se siente solo ante tantas herramientas.
- **Continuidad con el hub (4.4):** lo que no se configure en el tour queda como ítems del checklist progresivo, sin presión. El **tour** es la versión *activa/educativa* (una vez, al activar); el **hub** es la versión *persistente/a-tu-ritmo*.
- **Reuso:** el tour reaprovecha `HelpAssistant.tsx` (ya tiene tab de "guías" por página + el chat del copilot) y la visibilidad por vertical del sidebar/checklist. Es UI ligera y educativa, **sin lógica de negocio nueva**.

---

## PARTE 5 — Normalización: dónde encaja CADA feature (el mapa)

El núcleo de "cuadrar todo lo nuevo". Cada área configurable se asigna a **un nivel**. **Regla dura: nada fuera del nivel "Crítico" puede bloquear la activación.**

### 5.1 — Los 5 niveles

| Nivel | Definición | Cuándo aparece | Cómo se presenta |
|---|---|---|---|
| **0 · Crítico** | Indispensable para el primer valor | En el hilo guiado obligatorio | Wizard lineal |
| **1 · Día-1 esencial** | Hace que el producto "se sienta listo" | Checklist hub, arriba | Checklist con % |
| **2 · Recomendado contextual** | Sube el valor; depende del uso/vertical | Hub, revelado progresivamente | Tooltips + tarjetas |
| **3 · Avanzado opt-in** | Potencia; mayormente plan-gated | Solo si el usuario lo busca | En su sección, con badge de plan |
| **V · Condicional por vertical** | Solo relevante para ciertas industrias | Si `verticalConfig` lo activa | Sidebar/checklist vertical-aware |

### 5.2 — El mapa completo

| Feature / área | Nivel | Razón | Notas de presentación |
|---|---|---|---|
| Negocio + **Vertical** (+subtipo) | **0 Crítico** | Motor del auto-bootstrap | `/onboarding` Fase 1 |
| **Persona / agente** | **0 Crítico** (auto) | Auto-creado por el vertical; fallback garantizado | Solo ajustar nombre/tono/saludo |
| **Conectar 1er canal (WhatsApp)** | **0 Crítico** | **La activación**. Hoy es el gap | Fase 4, Coexistence/QR estrella |
| **Probar el agente** | **0 Crítico** (recom.) | El "aha" antes del canal | Chat dual-pane |
| **KB / RAG** (pega tu web/IG, FAQs) | **1 Día-1** | El conocimiento es el combustible (patrón AI-native) | Bootstrap por scraping; FAQs ya sembradas por vertical |
| **Horarios de atención** | **1 Día-1** | Afecta respuestas y booking | Ya sembrado por vertical; confirmar |
| **Mensaje de prueba en vivo** | **1 Día-1** | Cierra el loop de valor real | Checklist |
| **Canales adicionales** (IG, Messenger, Telegram, Email) | **2 Recom.** | Multiplica alcance tras el 1º | Tarjetas en hub |
| **Pipeline / CRM** | **2 Recom.** | Stages ya sembrados por vertical | Revelar al primer lead |
| **Citas / calendario / booking** | **V Vertical** | Solo salud/turismo/gym/belleza… | Servicios ya sembrados; conectar Google Calendar |
| **Catálogo / órdenes / inventario** | **V Vertical** | Retail/ecommerce/restaurantes | Surface si vertical lo activa |
| **Propiedades / listings** | **V Vertical** | Inmobiliaria/turismo | Sidebar condicional (ya existe) |
| **Plantillas WhatsApp** | **2 Recom.** | Solo tras conectar WA; para broadcast | En sección WA |
| **Equipo / usuarios / roles** | **2 Recom.** | El creador puede solo; plan-gated (seats) | "Invita a tu equipo" en hub |
| **Procedimientos SOP/AOP (T2.12)** | **3 Avanzado** | Potente pero pesado (NL→grafo) | Tras dominar lo básico; "describe tu proceso" |
| **Simulación de agente (T2.13)** | **3 Avanzado** (Pro+) | Gate de go-live opcional; CI/CD del agente | Reusar como "Prueba→Despliega" Pro+ |
| **Dual-skillset / ecommerce (T2.17)** | **3 Avanzado** + **V** | Requiere Shopify/WooCommerce OAuth | Solo retail/ecommerce |
| **Integraciones verticales Toast/Mindbody/Cliniko (T3.19)** | **3 Avanzado** + **V** | Heavy, vendor-específico, Ent.+ | Solo si el vertical y plan aplican |
| **MCP (T3.20)** | **3 Avanzado** | Para usuarios técnicos | Settings/integraciones |
| **B2B Organizations (T3.21)** | **3 Avanzado** + **V** | Solo ventas B2B | Si audiencia = b2b |
| **Atribución Click-to-WA (T3.22)** | **3 Avanzado** | Requiere ads activos | Cuando haya tráfico de ads |
| **Reviews / Google Business (T3.23)** | **3 Avanzado** + **V** | Negocios locales con reseñas | Opt-in |
| **Managed / done-for-you (T3.24)** | **3 Avanzado** (super-admin) | Tier gestionado | No es self-serve |
| **2FA / seguridad** | **2 Recom.** | Buenas prácticas, no bloquea | Recordatorio en hub |
| **Plan / billing** | **1 Día-1** (trial-first) | Diferir tarjeta hasta tras activación | Countdown de trial |

> **Lectura del mapa:** la ruta crítica obligatoria tiene **solo 4 ítems** (negocio, agente-auto, probar, conectar). Las ~13 features nuevas caen **todas** en Nivel 3 (Avanzado opt-in) o V (Vertical) — es decir, **nunca abruman al usuario nuevo** porque no aparecen hasta que las busca o su vertical/plan las amerita. Eso es exactamente lo que pediste: que lo nuevo "se ajuste si toca" sin romper la simplicidad.

---

## PARTE 6 — Métricas y validación

**Instrumentar el embudo** (hoy no medimos TTFV — la dimensión #25 lo marca como gap):

| Métrica | Definición | Meta inicial |
|---|---|---|
| **Activación** | % de signups que **conectan ≥1 canal y reciben/responden ≥1 mensaje** | Subir hacia 50%+ (vs ~36% promedio) |
| **TTFV** | Tiempo signup → canal conectado | <15 min (alineado con la tesis competitiva) |
| **Completion del hilo crítico** | % que termina la Fase 4 | B2B objetivo 60-70% |
| **Drop-off por paso** | Abandono en cada pantalla del wizard | Identificar el peor paso |
| **Drop-off en el popup de Meta** | Abandono dentro del Embedded Signup | El KPI más accionable |
| **Uso de Coexistence vs ESU vs sandbox** | Distribución de rutas de conexión | Validar que Coexistence reduce abandono |

**Validación:** A/B del hilo nuevo vs el actual; medir activación y retención M1. Caso de referencia: simplificar el flujo llevó completion de 23%→67% en un SaaS comparable.

---

## PARTE 7 — Riesgos y decisiones abiertas

| Riesgo / decisión | Detalle | Recomendación |
|---|---|---|
| **Coexistence en LatAm** | No confirmado país por país | Verificar con Meta/BSP antes de hacerlo default; Plan B = ESU + sandbox |
| **Campos pre-fillables del ESU** | La doc de Meta renderiza por JS; lista exacta sin confirmar | Confirmar en vivo / con el BSP qué se puede pre-rellenar |
| **Tech Provider / ESU / Coexistencia / migración 6 meses** | ✅ **Ya implementados** (Tech Provider aprobado, Embedded Signup propio, Coexistencia con migración de historial) | No hay infra que construir — solo **exponerlos** en el flujo guiado |
| **Fusionar vs secuenciar los 2 wizards** | `/onboarding` + `setup-wizard` se solapan | Fusionar en un hilo; `setup-wizard` se reduce a "ajusta + prueba + conecta" |
| **Trial-first vs plan-upfront** | Quitar el muro de pago vs calificar intención | Trial-first; tarjeta diferida (billing ya lo soporta) |
| **Forzar el canal: ¿hard gate o fuerte nudge?** | Demasiado forzado puede frustrar a quien "solo explora" | Hard nudge con escape "explorar el dashboard", pero el hilo siempre vuelve a "Conéctalo" |

---

## PARTE 8 — Roadmap de implementación por fases (para la sesión de build)

> No se escribió código en esta sesión. Esto es el plan para ejecutarlo. Recordar: **toda página tocada actualiza i18n en los 4 idiomas (es/en/pt/fr)**, y verificar con `tsc --noEmit` + `test:bootstrap`.

**Fase 0 — Quick wins (sin reestructurar):**
- Reordenar el `OnboardingChecklist` a "progreso regalado" y hacerlo más prominente hasta activación.
- Instrumentar el evento de **activación** y **TTFV** (analítica).
- Mover "referido" fuera de `/onboarding`; trial-first (diferir tarjeta).

**Fase 1 — El camino crítico (el rediseño central):**
- Añadir la **Fase 4 "Conéctalo"** como paso obligatorio tras `/onboarding`/setup-wizard.
- **Exponer** en el flujo el **Embedded Signup + Coexistencia (con migración de 6 meses) ya construidos**; **añadir** el sandbox 555 como ruta de prueba; pre-fill del ESU con los datos del vertical.
- Pre-check de prerrequisitos + **mapa de errores de Meta → español** (Anexo B).
- Fusionar la espina `/onboarding` ↔ `setup-wizard` (continuidad de datos).

**Fase 2 — El hub progresivo:**
- Hub de checklist vertical-aware con divulgación progresiva (Niveles 1-2).
- "Pega tu web/IG" → scraping al KB en Fase 1.
- Chat de prueba dual-pane (Fase 3 "Pruébalo").

**Fase 3 — Normalización de lo avanzado:**
- Gating por nivel (3/V) de las ~13 features nuevas; badges de plan/vertical; tooltips contextuales.
- "Prueba→Despliega" con Simulación (T2.13) como gate opt-in para Pro+.

---

## Anexo A — Teardowns completos por competidor

*(Resumen de la investigación web 2024-2026; conteos de pasos de help centers oficiales salvo donde se indica "según X". Detalle por dimensión disponible en los registros de investigación de esta sesión.)*

**LatAm:** Leadsales (QR + autogenera agente desde URL + sandbox; "Vibe Selling"; ~$84/mes) · Whaticket (QR, 1ª línea gratis, starter-kit de 3 pasos; ~$49/mes) · Cliengo (crear bot → conectar; widget ~1 min; estado verde + confirmación al WhatsApp; WA Lite QR self-serve, API asistida) · Yalo (enterprise gestionado; WA API + plantillas; done-for-you).

**WhatsApp-first:** Wati (Embedded Signup 9 pasos + nº 555 sandbox + "no tengo web"; ~$39-59/mes) · Respond.io (checklist 4 pasos con divulgación progresiva: conectar canal → lifecycle → AI agent → equipo; **Coexistence ~2 min**; app móvil nativa) · 360dialog (BSP; ESU 10 pasos; hostear tu propio ESU + pre-fill; aviso de expiración 60 min).

**SMB-simplicity:** Manychat (OAuth IG inline; plantilla en 3 clics; **preview dual-pane sin canal real**; 1 trigger + 1 mensaje) · Tidio (cuestionario corto → defaults; **scraping de URL** para el KB de Lyro; ~20 min; checklist por etapas) · Landbot (3 puertas: "hazlo por mí con IA" / plantilla / desde cero; plantillas con notas-guía; test antes de publicar).

**AI-native:** Intercom Fin (Train→Test→Deploy; **gate de ≥10 artículos KB**; "Simple deploy"; trial no corre hasta ir en vivo; $0.99/resolución) · Ada (onboarding por canal; "lo configuramos por ti"; sandbox provisionado; coaching loop) · Sierra/Decagon (**simulación auto-generada desde SOPs/KB/históricos como gate de go-live**; juez automático pass/fail; AOPs en lenguaje natural; rollout A-B gradual).

## Anexo B — Mapa de errores de Embedded Signup → mensaje en español accionable

| Error de Meta | Causa | Mensaje/auto-fix en la UI |
|---|---|---|
| Número ya vinculado a WhatsApp personal/otra WABA | Número en uso | "Tu número ya tiene WhatsApp. Bórralo de la app personal **o** usa Coexistence para conservar tus chats." (esperar ~3 min tras desvincular) |
| Phone number blocked | Bloqueado por Meta | Enlazar a WhatsApp Manager / soporte |
| Formato de número inválido | Falta código país | Selector de país + máscara que normaliza |
| OTP no llega | Carrier/VOIP/SMS | Ofrecer verificación **por llamada**; exigir móvil (no VOIP); reintentar en 15 min |
| Código expirado | Pasaron >3 min | Countdown visible; reenviar |
| Demasiados intentos | Muchos reintentos | Esperar 24 h / cambiar red |
| Display name viola guías | Nombre no cumple | Mostrar **las reglas antes** de pedirlo + validación inline |
| Business Manager verification required | Falta verificación | Linkear al Security Center; explicar que tarda; **no bloquear la conexión** |
| Business Manager not found | Sin BM | Guiar a crear/seleccionar uno en el flujo |
| 2FA no habilitado | Falta 2FA | Pre-check antes de abrir el popup |
| Templates fallan al enviar | Sin método de pago | Avisar: "conectar ≠ poder enviar templates"; pedir pago como paso **diferido** |

## Anexo C — Fuentes principales

**Competidores:** leadsales.io · whaticket.com · cliengo.com (+ help.cliengo.com) · yalo.ai · support.wati.io · respond.io/help · docs.360dialog.com · help.manychat.com · tidio.com · help.landbot.io · intercom.com/help · ada.cx · sierra.ai · decagon.ai.

**Ciencia UX:** Userpilot (TTV Benchmark 2024/25; Progressive Disclosure; Empty State; Onboarding Wizard) · SaaSMag (TTV & retention 2026) · SaaSFactor (science of SaaS onboarding) · Appcues (Checklists; MYOB +21%) · Pendo (progressive disclosure & the brain) · Baymard (form fields).

**WhatsApp Embedded Signup:** developers.facebook.com (ESU overview; pre-filling) · CM.com · Twilio Tech Provider guide · Chakra (ESU errors) · Wati troubleshooting · Bytepaper (Coexistence 2025) · Frejun · Brevo.

> **Honestidad sobre incertidumbre:** las cifras de impacto (MYOB +21%, Canva 75%, 23%→67%) provienen de fuentes vendor/blog — son direccionales, no estudios independientes. Las páginas oficiales de Meta renderizan por JS; los hechos de ESU están corroborados por múltiples BSPs. Como **Parallly ya es Tech Provider con ESU + Coexistencia + migración de 6 meses implementados**, lo único a confirmar es la **disponibilidad de Coexistence país por país en LatAm** (restricción de Meta) y afinar el pre-fill del `config_id`; el resto del stack de conexión ya está construido y probado.
