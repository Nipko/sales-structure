# Creación de contenido para marketing — Capacidades y stack (Jul 2026)

> Investigación inicial de la etapa de marketing/contenido: qué puede crear Claude Code directamente, qué servicios de IA externos conviene conectar (imagen, video, voz), y cómo publicar. Precios verificados al 27-jul-2026 — este mercado se reprecia cada 6-10 semanas, re-verificar antes de comprometer presupuesto.

## Objetivo

Producir contenido de ventas para redes (reels/TikTok, creatividades para ads, demos del producto) con un mensaje claro y sencillo de por qué usar Parallly, operado desde Claude Code de forma programática y reproducible.

---

## 1. Lo que Claude Code puede hacer HOY en la máquina local ($0)

| Capacidad | Herramienta | Estado |
|---|---|---|
| Edición/composición de imágenes por código | Python 3.11 + Pillow 12 | ✅ Instalado |
| Capturas y grabación del dashboard real (producción) | Navegador integrado + Chrome real con grabador de GIFs | ✅ Disponible |
| Assets de marca | `apps/landing/public/parallly-logo.svg`, logos de canales, design system (dark + esmeralda) | ✅ En el repo |
| Gráficos vectoriales, mockups, diagramas | SVG/HTML generado directamente | ✅ Nativo |
| Procesamiento de imágenes Node | `sharp` (ya dependencia del API) | ✅ Conocido |
| Edición/render de video | **ffmpeg** — NO instalado | ⬜ `winget install ffmpeg` (minutos) |
| Video programático (React) | **Remotion** — NO instalado | ⬜ `npm i` en un workspace nuevo |
| Grabación scriptada del dashboard | **Playwright** — NO instalado | ⬜ `npm i playwright` |
| Plantillas de imagen a escala | **satori + @resvg/resvg-js + sharp** — NO instalado | ⬜ `npm i` |

**Nota clave**: no hay conectores MCP de diseño/video conectados en la cuenta (Canva, Figma, etc. — el registro devolvió vacío). Todo lo externo entraría por API key o instalando servidores MCP.

### Stack local recomendado (todo gratis, todo código en el repo)

**(a) Imágenes sociales con copy en español a escala — $0**
`satori` (plantillas JSX + flexbox, fuentes TTF propias → ñ/acentos perfectos) → `@resvg/resvg-js`/`sharp` → PNG en 1080x1080 / 1080x1920 / 1200x628. Una plantilla por formato, un JSON de hooks/ofertas, y salen decenas de variantes on-brand. El texto lo ponemos nosotros por código ⇒ nunca hay typos de IA.

**(b) Videos demo del producto 15-60s — $0**
Playwright recorre `admin.parallly-chat.cloud` con guion (viewport fijo, cursor inyectado) → WebM → ffmpeg transcodifica a MP4 (`libx264 -crf 18-23` para que el texto de la UI quede nítido) → Remotion compone: zooms/paneos, captions animados en español, intro con logo, end-card con CTA, música → `npx remotion render` a 9:16.
- **Licencia Remotion**: GRATIS para empresas de ≤3 personas (verificado remotion.pro jul-2026). Aplica hoy; re-verificar al contratar gente (4+ = $25/seat/mes o $0.01/render, mínimo $100/mes).
- Regla de oro: **los demos de dashboard NO se generan con IA de video** — todos los modelos 2026 deforman texto pequeño de UI (peor en español). Se graba la UI real.
- Gotchas Windows: evitar `node-canvas` (prebuilds rotos en Node 20/22); usar `sharp`. Remotion ≥4.0.208 auto-instala Chrome Headless Shell. Subtítulos quemados vía `.ass` con BorderStyle=3 (caja) para legibilidad.

---

## 2. Generación de IMAGEN con IA (API externa)

Jerarquía para **texto en español DENTRO de la imagen** (necesidad core de creatividades LatAm):
**GPT Image 2 (~99% de precisión) ≈ Ideogram 4.0 (especialista tipografía) > Nano Banana Pro > FLUX.2 (typos en copy denso) >> Midjourney (30-40%, inservible y SIN API — descartado)**

| Modelo | Precio/imagen | Fortaleza | Uso para Parallly |
|---|---|---|---|
| **OpenAI GPT Image 2** | ~$0.006 low / ~$0.053 med / ~$0.21 high (token-metered; re-verificar en página oficial) | #1 texto multilingüe legible, layouts publicitarios | Creatividades finales con copy en español; medium para variantes A/B |
| **Google Nano Banana Pro** (Gemini 3 Pro Image) | $0.134 (1K/2K), $0.24 (4K); batch -50% | **Consistencia de marca/referencias**: le das logo + paleta + screenshot real y compone escenas on-brand | Composites del dashboard en contextos LatAm; mascota/personaje recurrente |
| Nano Banana 2 Lite | $0.034 | Volumen barato Google | Opción budget |
| **Ideogram 4.0** | Turbo $0.03 / Default $0.06 / Quality $0.10; estilo custom $40 una vez | Especialista texto-en-imagen (90-95%), fondo transparente, español nativo | Banners con precios ("Desde USD $21/mes"), quote cards, overlays para reels. Entrenar estilo Parallly por $40 |
| **FLUX.2 [pro]** (BFL) | $0.03 t2i / $0.045 edición; klein desde $0.014 | Mejor fotorrealismo/precio para volumen | Escenas fotorreales (comerciantes LatAm con celular) SIN texto; el copy se superpone por código |
| **Recraft V4.1** | raster $0.035; **vector SVG real** $0.08; utilidades (bg-removal $0.01, upscale $0.004) | Único con SVG editable + style ID persistente de marca | Kit de marca: iconos, ilustraciones, plantillas SVG cuyo texto editamos por código (español perfecto garantizado) |

**Agregadores (la vía práctica)**: **Replicate** (MCP OFICIAL, incluso "code mode") y **fal.ai** (MCP oficial hosteado, el más barato en FLUX, catálogo imagen+video). Una sola key/factura da acceso a casi todo. FLUX schnell a $0.003/imagen para explorar.

**Licencias**: OpenAI/Google/Ideogram(pago)/Recraft(pago)/BFL API = uso comercial OK. Trampas: FLUX.2 [dev] open-weights NO comercial sin licencia; Ideogram free hace las imágenes públicas; Midjourney sin API pública (descartado).
**⚠️ Caducidades**: Imagen 4 de Google MUERE el 17-ago-2026 (no construir sobre él); gpt-image-1 depreca oct-2026.

**Presupuesto realista**: un mes de contenido social diario ≈ **$10-40 en APIs de imagen**.

---

## 3. Generación de VIDEO con IA (API externa)

**⚠️ Sora está MUERTO**: OpenAI apaga la Videos API el 24-sep-2026 (verificado en su página de deprecations). No construir nada sobre Sora.

| Modelo | Precio | Audio nativo | Uso para Parallly |
|---|---|---|---|
| **Kling 3.0** (vía fal.ai) | $0.084/s sin audio, **$0.126/s con audio nativo** (~$1.26 el reel de 10s hablado) | ✅ **Español nativo, distingue acento LatAm vs castellano** — único entre los grandes | **Motor por defecto** para reels/TikTok hablados en español; personaje "vendedora" recurrente vía referencias |
| **Veo 3.1** (Google) | Lite $0.05/s, **Fast $0.10/s**, Standard $0.40/s (audio incluido, solo cobra éxitos) | ✅ (español funciona, calidad < inglés) | Ads "hero" pulidos 9:16; "Ingredients" (1-3 imgs de referencia, solo Standard) para consistencia de marca |
| Runway Gen-4 Turbo | $0.05/s | ❌ (integra ElevenLabs) | B-roll barato, image-to-video fuerte de screenshots; "Recipes" = plantillas de ads de producto ($2 el video 4s) |
| Hailuo 02 (MiniMax) | ~$0.28 el clip de 6s | ❌ (pero su TTS es-LA en la misma cuenta, **MCP oficial**) | B-roll dinámico budget |
| Luma Ray 3.2 | 5s desde $0.15 (drafts); **Reframe API** convierte 16:9→9:16→1:1 | ❌ | Iteración barata + derivar formatos de un master |
| Pika 2.2 | ~$0.05/s (vía fal) | ❌ | Efectos llamativos puntuales; no es motor core |

**Backbone recomendado**: **fal.ai como agregador único** (MCP oficial, una key, facturación medida) mezclando Kling 3.0 (reels con voz en español) + Veo 3.1 Fast (hero ads) + Hailuo/Wan (b-roll). Replicate como backup. **Costo bruto de generación de un ad de 30s ≈ $1.50-4.00**.

---

## 4. VOZ y AVATARES (español LatAm)

| Servicio | Precio | Nota clave |
|---|---|---|
| **ElevenLabs** | Starter $6/mes (licencia comercial), Creator $22/mes (~2h audio, clonación) | **Líder en calidad es-LA** (voces latinas/colombianas/mexicanas dedicadas) + **MCP OFICIAL** → Claude genera el MP3 en una llamada. El free tier NO permite uso comercial |
| **Google Chirp 3 HD** | **1M chars/mes GRATIS** (~17-20h de voz) | El caballo de batalla $0 para narración de demos; es-US neutro profesional |
| Azure Neural | 500k chars/mes gratis | Único con acentos por país: es-CO, es-MX, es-AR — útil para variantes colombianas (mensaje DIAN/factura) |
| OpenAI TTS (gpt-4o-mini-tts) | ~$0.015/min (ya tenemos OPENAI_API_KEY) | Barato para borradores; acento anglicado — no para el ad final |
| **HeyGen** (avatares) | **PAYG desde $5**, Avatar IV $3/min | Mejor lip-sync español 2026 (único que viewers de TikTok no detectaron como IA); script→MP4 9:16 por API |
| **Argil** (avatares UGC) | $27-39/mes, 25 min, API en todos los planes | TikTok-nativo: B-roll + captions automáticos incluidos; mejor costo si superamos ~10 min/mes |
| Synthesia | API desde $89/mes | Estética corporativa, no UGC — skip por ahora |
| Captions/Mirage | $10.50/min (caro) pero **captioning API $0.15/min** | Solo para subtitular automático |

**Hay ~1.5M chars/mes de TTS comercial GRATIS** (Google 1M + Azure 500k) — la voz de los demos puede costar $0.

---

## 5. PUBLICACIÓN (distribución del contenido)

**Estrategia de mínima fricción (split)**:
1. **Meta DIRECTO** — ya somos Tech Provider con app aprobada y verificada: agregar permisos `instagram_business_content_publish` + `pages_manage_posts` es UNA app review incremental (~2-4 semanas, gratis, empaquetar ambos juntos). Límite oficial: 100 posts API/cuenta/24h. Reels: video_url público (tenemos VPS), 9:16 H.264. Además dogfooding del mismo stack Meta que vendemos.
2. **TikTok/YouTube/LinkedIn vía scheduler** — sus APIs nativas exigen auditorías propias (TikTok 2-6 semanas y posteo privado hasta pasar; YouTube fuerza videos privados sin compliance audit; LinkedIn vetting enterprise).

**Hub recomendado: Postiz Cloud $29/mes** — API REST + webhooks + CLI + **servidor MCP** en el plan de entrada; usa SUS apps ya auditadas para 20+ redes ⇒ cero auditorías. (Postiz self-hosted es gratis/AGPL y calza con nuestro VPS Docker, pero NO evita las auditorías: habría que registrar apps propias por red — solo conviene para Meta donde ya tenemos app.)
**Alternativa**: Metricool Advanced ~$54/mes (español-first, popular entre agencias LatAm, API REST) si además queremos dashboard humano en español. Buffer = beta frágil, no confiar. Ayrshare $299/mes = solo si algún día vendemos publicación social a los tenants como feature.
**X**: pay-per-use $0.015/post pero $0.20 si lleva link (castiga los CTA) — canal marginal para nuestro público.

**Trampa Canva/Figma**: el Autofill API de Canva (plantillas con copy variable) exige Canva ENTERPRISE por usuario — fuera de presupuesto. Figma REST exporta PNGs pero no puede editar texto headless. Ninguno sirve como motor de plantillas a escala → por eso el pipeline local satori/sharp.

---

## 6. Stack recomendado por fases

**Fase 0 — HOY, $0** (sin comprar nada):
- Instalar ffmpeg (winget) + montar workspace `marketing/` con Remotion + Playwright + satori/sharp.
- Pipeline de imágenes de marca (plantillas código) + pipeline de video demo (grabación real del dashboard + captions + música).
- Narración con Google Chirp 3 HD free tier (o Azure es-CO).
- Producción manual de publicación (subir a mano) mientras se decide el hub.

**Fase 1 — Generación IA, ~$30-70/mes**:
- fal.ai (pay-as-you-go, MCP): Kling 3.0 para reels hablados es-LA + Veo 3.1 Fast para hero ads + FLUX/Ideogram para imágenes.
- ElevenLabs Starter/Creator ($6-22/mes) para la voz "hero".
- HeyGen PAYG ($5 de entrada) para avatares UGC; pasar a Argil ($27-39/mes) si el volumen supera ~10 min/mes.

**Fase 2 — Distribución automatizada, +$29/mes**:
- App review Meta (IG+FB publishing) sobre nuestra app existente — iniciar temprano, tarda 2-4 semanas.
- Postiz Cloud para TikTok/YouTube/LinkedIn + calendario/programación por MCP desde Claude Code.

**Costo total del sistema completo en crucero: ~$60-100/mes + $10-40 de APIs de generación.**

---

## 7. Riesgos y banderas de frescura

- **Mercado volátil**: Veo 3.0 y Sora murieron en los últimos 30 días (jul-2026). Re-verificar precios por segundo antes de fijar presupuesto de campaña.
- Imagen 4 muere 17-ago-2026; gpt-image-1 muere 23-oct-2026; precios de GPT Image 2 no verificados en página oficial de OpenAI (solo trackers).
- Precios de schedulers (Postiz/Metricool/Buffer) vienen de roundups de terceros — confirmar en checkout.
- HeyGen migró a PAYG durante 2026 — re-chequear developers.heygen.com antes de codificar costos.
- Licencia Remotion gratuita solo hasta 3 personas en la empresa.
- Catálogos de fal/Replicate rotan rápido — **pinnear IDs exactos de modelo en los scripts**.
