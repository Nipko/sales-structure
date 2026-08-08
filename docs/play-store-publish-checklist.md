# Play Store — Estado y checklist de publicación (Parallly Mobile)

> **Estado al 8-ago-2026.** Cuenta de desarrollador **Organización con D-U-N-S ✅ configurada**
> → exenta del test cerrado de 12 testers × 14 días. Falta crear la app en Play Console,
> subir el primer AAB y llenar las declaraciones.
> Todo lo marcado ✅ está **verificado contra el código o la URL real**, no de memoria.

---

## 🚦 Resumen: qué falta para publicar

| # | Bloqueante | Quién | Estado |
|---|---|---|---|
| 1 | **Generar el AAB con EAS** y verificar sus permisos | Comando abajo | ⏳ nunca se ha generado |
| 2 | **Smoke test del APK nuevo por vertical** (matriz abajo) | Dispositivo real | ◐ APK instalado y arranque OK; recorrido por vertical pendiente |
| 3 | **Tenant + agente DEMO** con datos de ejemplo (App access) | Tú (en la web) | ⏳ pendiente |
| 4 | **Capturas de pantalla** del tenant demo (mín. 2) | Regenerar con el demo | ◐ hay borradores inseguros |
| 5 | Declaración **Data safety** | Play Console | ⏳ tabla lista abajo |
| 6 | Cuestionario **Content rating** (IARC) | Play Console | ⏳ respuestas abajo |
| 7 | **Target audience** + resto de "App content" | Play Console | ⏳ |
| 8 | Ficha de tienda (textos + gráficos) | Textos y gráficos listos | ◐ solo pegar |

---

## ✅ Verificado hoy (no requiere acción)

| Requisito | Evidencia |
|-----------|-----------|
| Política de privacidad | `parallly-chat.cloud/privacy` → **HTTP 200** (4 idiomas) |
| Términos | `parallly-chat.cloud/terms` → **HTTP 200** |
| Eliminación de cuenta y datos (exigido por Google) | `parallly-chat.cloud/data-deletion` → **HTTP 200** |
| Alta de cuenta accesible | `admin.parallly-chat.cloud/signup` → **HTTP 200** |
| Target API level | `targetSdkVersion 36` (Android 16) — supera el mínimo 35 |
| Package name | `cloud.parallly.mobile` · versionCode `1` · versionName `1.0.0` |
| TLS / sin tráfico en claro | plugin `withAndroidNetworkSecurity` |
| Ícono adaptativo y splash | `assets/` 1024×1024 y 1242×2436 |
| Secretos de build en EAS | `GOOGLE_SERVICES_JSON`, `SENTRY_ORG/PROJECT/AUTH_TOKEN` (verificado con `eas secret:list`) |
| Recorrido de quien instala **sin cuenta** | Implementado — ver §5 |
| Gráficos de la ficha | **Generados hoy** en `apps/mobile/store-assets/` (ícono 512×512 y destacado 1024×500) |

---

## 1. Generar el AAB y verificar permisos ⚠️

Nunca se ha construido el AAB de producción, así que la afirmación "permisos depurados"
**no estaba verificada**. Hoy se comprobó el APK local: trae `SYSTEM_ALERT_WINDOW`,
`WRITE_EXTERNAL_STORAGE` y `READ_EXTERNAL_STORAGE` sin tope.

**No es un problema del AAB**: los builds locales con `gradlew` NO ejecutan los config
plugins de Expo; EAS sí (corre `prebuild`, y `android/` no está en git). El plugin
`withCleanPermissions` elimina los dos primeros y —**mejorado hoy**— acota
`READ_EXTERNAL_STORAGE` a `maxSdkVersion="32"`, que es lo que evita que Play lo lea como
*acceso amplio a fotos y vídeos* (esa política exige justificación aparte).

```bash
cd apps/mobile && npx eas-cli build --platform android --profile production
```

**Verificación obligatoria del AAB descargado** (debe imprimir solo `CAMERA`,
`POST_NOTIFICATIONS`, `INTERNET`, `VIBRATE`, `USE_BIOMETRIC`… y `READ_EXTERNAL_STORAGE`
**con maxSdkVersion 32**):

```bash
aapt2 dump xmltree --file AndroidManifest.xml app-release.aab | grep -A2 permission
```

Si `SYSTEM_ALERT_WINDOW` aparece en el AAB → **no subir**, el plugin no se aplicó.

Antes del AAB, instalar el APK local nuevo por ADB inalámbrico y probar al menos un
tenant representativo de cada modo operativo: agenda, estadías, tours, restaurante,
pedidos, clases, matrículas, seguros, solicitudes de servicio, fotografía y pruebas de
manejo, alquiler vehicular y hospedaje de mascotas. Son **13 modos operativos** y deben
recorrerse con datos reales; ninguna vertical debe caer en una cita ficticia.

**Avance 8-ago-2026:** `assembleRelease` completó, el APK se instaló por ADB inalámbrico
en un Samsung SM-S938B y `cloud.parallly.mobile/.MainActivity` inició sin errores fatales
Android/React Native. Falta el recorrido manual con tenants representativos; no marcar
este bloqueante como cerrado solo por haber validado el arranque.

## 2. App access — la causa #1 de rechazo

La app exige login: sin credenciales el revisor no ve nada y rechaza.

- App content → **App access** → "Some functionality restricted".
- Crear un **tenant demo + usuario agente** con 2-3 conversaciones de ejemplo.
- Entregar email, contraseña e instrucciones: *"Inicia sesión con estas credenciales; verás la bandeja de conversaciones. Las pestañas CRM, Reserva y Más no requieren pasos extra."*
- ⚠️ **Desactiva el 2FA** de esa cuenta o el revisor se traba en el código.
- ⚠️ La cuenta demo **debe seguir viva** después de publicar (Google revalida en cada actualización).

## 3. Capturas de pantalla

Requisito: mínimo 2, máximo 8, lado entre 320 y 3840 px, ratio máx. 2:1.
Las del teléfono (1080×2340) cumplen.

Hay borradores en `apps/mobile/store-assets/` tomados del dispositivo real.

> 🔒 **No subir capturas con datos de clientes reales** (nombres, teléfonos, mensajes):
> es PII de terceros y contraviene la política de datos sensibles. **Regenerarlas
> logueado en el tenant DEMO.**

Sugeridas: Inbox · Conversación con copiloto de IA · CRM/lead · Operación vertical
(por ejemplo pedidos, estadías o agenda).

Para capturar con el teléfono conectado por ADB:
```bash
adb exec-out screencap -p > screen-1-inbox.png
```

## 4. Data safety (declarar exactamente esto)

| Categoría | ¿Se recopila? | Propósito | ¿Compartida? | Cifrada en tránsito | Eliminable |
|-----------|:---:|---|:---:|:---:|:---:|
| Nombre y email (agentes, leads y huéspedes) | Sí | Gestión de cuenta, CRM y funcionalidad | No | Sí | Sí |
| Número de teléfono | Sí | CRM, contacto con clientes y reservas | No | Sí | Sí |
| Otra información personal (empresa/cargo de tarjeta escaneada) | Sí | CRM | No | Sí | Sí |
| Mensajes (in-app) | Sí | Funcionalidad de mensajería | No | Sí | Sí |
| Fotos y vídeos | Sí | El agente adjunta media | No | Sí | Sí |
| Archivos de audio (notas de voz) | Sí | Mensajería | No | Sí | Sí |
| Archivos y documentos | Sí | Adjuntos de conversaciones | No | Sí | Sí |
| ID de dispositivo / push token | Sí | Notificaciones | No (Expo/FCM como proveedor) | Sí | Sí |
| Crash logs + diagnósticos | Sí | Estabilidad (Sentry) | No | Sí | N/A |
| Ubicación precisa o aproximada | **No** | — | — | — | — |
| Datos de pago (tarjetas/cuentas bancarias) | **No** | — | — | — | — |

- Método de eliminación: **URL** → `https://parallly-chat.cloud/data-deletion`
- Cámara: se usa para adjuntar fotos y escanear tarjetas de visita → declarar como Fotos/Vídeos.

## 5. Qué ve quien instala SIN cuenta (implementado ago-2026)

La app es la **consola del agente**, no el alta: crear la empresa exige el wizard web
(rubro, canales, agente). El móvil **nunca** crea cuentas ni menciona precios.

| Situación | Qué ve | Salida |
|---|---|---|
| Primer arranque tras instalar | **Bienvenida**: qué es Parallly (3 puntos) + "Ya tengo cuenta" + "Crear cuenta en la web" (abre `/signup`). Una sola vez por dispositivo | Login o navegador |
| En el login | Enlace permanente "¿No tenés cuenta? Creála en la web" | Navegador |
| Entra con Google sin tener cuenta | El backend **rechaza** (`no_account`) en vez de crear un usuario huérfano | Se queda en login |
| Cuenta válida sin empresa (abandonó el wizard) | Pantalla **"Falta terminar la configuración"** + botón a `/onboarding` | Navegador o logout |

> Antes de esto, "Continuar con Google" sin cuenta creaba un usuario **sin tenant** que
> entraba a una consola vacía y sin salida: el escenario clásico de rechazo por
> *funcionalidad mínima / app rota*.

⚠️ **Google Play Billing**: mientras el alta y el pago ocurran fuera del APK y la app no
muestre precios ni CTAs de compra, la suscripción se considera un servicio SaaS externo.
Cualquier botón de compra dentro de la app cambiaría esa lectura y obligaría a usar
Play Billing (15-30 % de comisión).

## 6. Content rating (IARC) y Target audience

- App de **comunicación / negocios**. Permite comunicación entre usuarios → responder **Sí**.
- Sin violencia, sexo, apuestas ni drogas. Resultado probable: **Teen / PEGI 3-12** por UGC.
- Target audience: **adultos / profesionales** (herramienta de trabajo). **No** dirigida a niños.
- Ads: **No** contiene anuncios.

## 7. Ficha de tienda

**Nombre:** Parallly
**Descripción corta (≤80):**
> Consola de agentes: responde WhatsApp, Instagram y más, con IA en el bolsillo.

**Descripción completa (es):**
> Parallly es la app del agente para atender y vender por WhatsApp, Instagram, Messenger y Telegram desde un solo lugar.
>
> • Bandeja unificada en tiempo real con alertas para el equipo.
> • Responde con texto, imágenes, documentos, video y notas de voz.
> • Copiloto de IA: sugiere respuestas, reescribe en 6 tonos, resume la conversación, traduce y propone la próxima mejor acción de venta.
> • CRM integrado: leads, pipeline, notas, tareas y escáner de tarjetas de visita.
> • Toma el control del bot con un tap, asigna conversaciones y colabora con tu equipo.
> • Gestiona la operación real de cada negocio: agenda, reservas, pedidos, clases, matrículas, solicitudes de servicio, alquileres y hospedajes.
>
> Diseñada para equipos de ventas y atención en Latinoamérica. Requiere una cuenta de Parallly.

**Gráficos** (generados, en `apps/mobile/store-assets/`):
- `play-icon-512.png` — 512×512, el tamaño exacto que exige Play
- `play-feature-graphic-1024x500.png` — gráfico destacado
- Capturas: regenerar con el tenant demo (ver §3)

> ⚠️ No usar logos de WhatsApp/Meta de forma que impliquen respaldo oficial; describir la
> integración como "compatible con WhatsApp Business API".

## 8. Flujo de build y envío

```bash
cd apps/mobile
npx eas-cli build --platform android --profile production   # genera el AAB
```
Primera vez: subir el AAB **a mano** en Play Console (Internal testing) para validar.
Después, los envíos pueden automatizarse:
```bash
npx eas-cli submit --platform android --profile production
```

## 9. Notas de despliegue

- **Operaciones verticales (ago-2026):** antes del smoke de los 13 modos hay que
  desplegar la API del mismo commit y ejecutar la reconciliación del schema por tenant.
  En particular, los tenants existentes necesitan la tabla `resource_rentals`; instalar
  un APK nuevo no crea rutas ni tablas en el servidor.
- **Sesiones (ago-2026):** al pasar a sesiones por dispositivo, los tokens emitidos antes
  del cambio no llevan el marcador de plataforma y se tratan como web (TTL 6 min). Quien
  ya tenía la app abierta debe **iniciar sesión una vez**; a partir de ahí su sesión
  móvil dura 14 días y convive con el dashboard.
- Los builds locales (`gradlew assembleRelease`) sirven para probar en dispositivo, pero
  **no** representan el manifest final: no ejecutan los config plugins de Expo.
