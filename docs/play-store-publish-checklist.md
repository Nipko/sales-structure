# Play Store — Checklist de publicación (Parallly Mobile)

> Resultado del audit de cumplimiento (jun 2026). Lo legal/técnico está **listo**;
> lo que falta es contenido a llenar en Play Console + decisiones tuyas.

## ✅ Ya cumplido (no requiere acción)

| Requisito | Estado |
|-----------|--------|
| Política de privacidad | ✅ `parallly-chat.cloud/privacy` (1085 líneas, 4 idiomas, cubre datos/Meta/retención/cifrado/derechos) |
| Términos | ✅ `parallly-chat.cloud/terms` |
| Eliminación de cuenta/datos (requisito Google) | ✅ `parallly-chat.cloud/data-deletion` (formulario GDPR/LGPD/CCPA/Ley 1581) |
| Permisos depurados en el AAB | ✅ plugin `withCleanPermissions` quita SYSTEM_ALERT_WINDOW + WRITE_EXTERNAL_STORAGE |
| TLS / sin cleartext | ✅ `network_security_config` |
| Target API level (34+) | ✅ Expo SDK 54 (API 35/36) |
| Formato AAB + signing | ✅ `eas.json` profile `production` (AAB) + EAS upload key + Play App Signing |

## 📋 A llenar en Play Console (contenido)

### 1. App access (⚠️ CRÍTICO — la causa #1 de rechazo)
La app exige login → el revisor de Google NO puede entrar sin credenciales.
- App content → **App access** → "Some functionality restricted"
- Crea un **tenant demo + usuario agente** con datos de ejemplo (1-2 conversaciones)
- Provee: email, contraseña, e instrucciones (ej. "Login con estas credenciales; verás la bandeja de conversaciones").
- ⚠️ Si el agente demo tiene 2FA, **desactívalo** para esa cuenta o el revisor se traba.

### 1.b Qué ve quien instala SIN cuenta (implementado ago 2026)

La app es la **consola del agente**, no el alta: crear la empresa exige el wizard
web (rubro, canales, agente), así que el móvil nunca crea cuentas. El recorrido:

| Situación | Qué ve | Salida |
|---|---|---|
| Primer arranque tras instalar | **Pantalla de bienvenida**: qué es Parallly (3 bullets) + "Ya tengo cuenta" + "Crear cuenta en la web" (abre `/signup` en el navegador). Se muestra una sola vez por dispositivo | Login o navegador |
| Login | Enlace permanente "¿No tenés cuenta? Creála en la web" | Navegador → `/signup` |
| Entra con Google sin tener cuenta | El backend **rechaza** (`no_account`) en vez de crear un usuario huérfano; mensaje: "No hay ninguna cuenta con ese correo…" | Se queda en login |
| Cuenta válida pero sin empresa (abandonó el wizard) | **Pantalla "Falta terminar la configuración"** con botón a `/onboarding` y cerrar sesión | Navegador o logout |

> Antes de esto, tocar "Continuar con Google" sin cuenta creaba un usuario **sin
> tenant** que entraba a una consola permanentemente vacía y sin salida — exactamente
> el escenario que un revisor de Google reporta como app rota / funcionalidad mínima.

⚠️ **Política de pagos**: la app NO vende ni menciona precios; el alta y el pago
ocurren en la web. Mantenerlo así evita Google Play Billing (la suscripción es a un
servicio SaaS usado fuera de la app, pero cualquier CTA de compra dentro del APK
cambiaría esa lectura).

### 2. Data safety (declarar exactamente esto)
| Categoría | ¿Se recopila? | Propósito | ¿Compartida? | Cifrada en tránsito | Eliminable |
|-----------|:---:|---|:---:|:---:|:---:|
| Nombre, email (cuenta de agente) | Sí | Gestión de cuenta / funcionalidad | No | Sí | Sí |
| Mensajes (in-app) | Sí | Funcionalidad de mensajería | No | Sí | Sí |
| Fotos/videos | Sí | El agente adjunta media | No | Sí | Sí |
| Archivos de audio (notas de voz) | Sí | Mensajería | No | Sí | Sí |
| ID de dispositivo / push token | Sí | Notificaciones | No (Expo/FCM como proveedor) | Sí | Sí |
| Crash logs + diagnósticos | Sí | Estabilidad (Sentry) | No | Sí | N/A |
| Ubicación / Datos financieros | **No** | — | — | — | — |
- Método de eliminación: **URL** → `https://parallly-chat.cloud/data-deletion`

### 3. Content rating (cuestionario IARC)
- App de **comunicación / negocios**. Permite que usuarios se comuniquen → responde "Sí" a comunicación de usuarios.
- Sin violencia/sexo/apuestas/drogas. Probable resultado: **Teen / PEGI 3-12** (por mensajería UGC).

### 4. Target audience
- Dirigida a **adultos / profesionales** (herramienta de trabajo). NO dirigida a niños.

### 5. Ficha de tienda (textos sugeridos)
**Nombre:** Parallly
**Descripción corta (≤80):**
> Consola de agentes: responde WhatsApp, Instagram y más, con IA en el bolsillo.

**Descripción completa (es):**
> Parallly es la app del agente para atender y vender por WhatsApp, Instagram, Messenger y Telegram desde un solo lugar.
>
> • Bandeja unificada en tiempo real con notificaciones fiables (incluso con la app cerrada).
> • Responde con texto, imágenes, documentos, video y notas de voz.
> • Copiloto de IA: sugiere respuestas, reescribe en 6 tonos, resume la conversación, traduce y propone la próxima mejor acción de venta.
> • CRM integrado: leads, pipeline, notas, tareas y escáner de tarjetas de visita.
> • Toma el control del bot con un tap, asigna conversaciones y colabora con tu equipo.
> • Agenda citas y gestiona reservas desde el chat.
>
> Diseñada para equipos de ventas y atención en Latinoamérica. Requiere una cuenta de Parallly.

**Gráficos requeridos:** ícono 512×512 PNG · gráfico destacado 1024×500 · ≥2 capturas de teléfono (inbox, chat, CRM).

> ⚠️ No uses logos de WhatsApp/Meta de forma que implique respaldo oficial; describe la integración como "compatible con WhatsApp Business API".

## 🔢 Decisión pendiente: tipo de cuenta
- **Organización (recomendado para SaaS):** exenta del test de 12 testers; necesita **D-U-N-S** (gratis, ~1-2 semanas — tramítalo ya).
- **Personal:** rápida de abrir pero exige **12 testers × 14 días** en closed testing antes de producción.

## 🚀 Flujo de build/submit
```bash
cd apps/mobile
# (1 sola vez) secret FCM para el build en la nube:
npx eas-cli secret:create --scope project --type file --name GOOGLE_SERVICES_JSON --value ./google-services.json
# Build AAB:
npx eas-cli build --platform android --profile production
# Subir: 1ª vez manual en Play Console (Internal testing) para validar; luego:
npx eas-cli submit --platform android --profile production
```

## Verificación post-build (recomendada)
Al generar el primer AAB, confirmar que NO incluye SYSTEM_ALERT_WINDOW:
`unzip -p app.aab base/manifest/AndroidManifest.xml | grep -i SYSTEM_ALERT` → debe estar vacío.
