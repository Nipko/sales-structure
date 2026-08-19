# Login con Google en la app móvil — diagnóstico (19-ago-2026)

## Síntoma

Tocar **Continuar con Google** muestra *"Error con Google Sign-In"*. No aparece el
selector de cuenta de Google en ningún momento.

## Qué se observó, reproducido en dispositivo

Samsung SM-S918B por cable, app `versionCode 7` instalada **desde Google Play**
(`installerPackageName=com.android.vending`).

Al tocar el botón, `logcat` muestra que el flujo nativo **arranca y muere en menos de
un segundo**, sin llegar a dibujar la pantalla de elección de cuenta:

```
START ... cloud.parallly.mobile/com.google.android.gms.auth.api.signin.internal.SignInHubActivity
START ... com.google.android.gms/.auth.api.signin.ui.SignInActivity
START ... com.google.android.gms/.signin.activity.SignInActivity
VRI[SignInHubActivity]: Not drawing due to not visible
... Destroyed  (todas, ~1s despues)
```

Esa firma — abre, no dibuja, se destruye — es la de **`DEVELOPER_ERROR`** (código 10):
Google Play Services rechaza la petición porque **la app que la hace no coincide con
ningún cliente OAuth de Android registrado**.

## Causa

Para que Google Sign-In funcione en Android tienen que cumplirse **las dos** cosas:

1. la app pide el `idToken` con un **webClientId**, y
2. existe un **cliente OAuth de tipo Android** con el `package_name` y el **SHA-1 de la
   clave con la que la app está firmada**, **en el mismo proyecto de Google Cloud que
   ese webClientId**.

Lo que hay hoy:

| Dato | Valor |
|---|---|
| webClientId que usa la app | `950001098107-4ctk2jm3876afqktip7r4f04120kt0ou...` → proyecto **950001098107** |
| Proyecto del `google-services.json` (FCM) | **432497155653** (`parallly-mobile`) |
| `oauth_client` en ese `google-services.json` | **`[]` — vacío** |
| Firma de la app instalada | `CN=Android, O=Google Inc.` → **clave de firma de Play** |
| SHA-1 de esa firma | `F7:46:78:C3:88:FB:E5:91:EC:69:9E:E1:1E:88:B1:E2:BB:14:69:DC` |

Que el proyecto de FCM sea otro **no es el problema** — `google-services.json` sólo
sirve para Firebase/FCM. El problema es que en el proyecto **950001098107**, que es el
dueño del webClientId, falta (o no coincide) el cliente OAuth de Android para
`cloud.parallly.mobile` con el SHA-1 de arriba.

Detalle que lo hace fácil de pasar por alto: **el SHA-1 cambió al publicar en Play**. Si
el cliente Android se registró con la huella de la clave de *subida* de EAS, la app
funcionaba al instalarla desde EAS y dejó de funcionar al instalarla desde Play, porque
Play la re-firma con su propia clave.

## Cómo se arregla

En **Google Cloud Console**, en el proyecto dueño del webClientId (`950001098107`) →
**APIs y servicios → Credenciales → Crear credenciales → ID de cliente de OAuth →
Android**:

- Nombre del paquete: `cloud.parallly.mobile`
- Huella SHA-1: `F7:46:78:C3:88:FB:E5:91:EC:69:9E:E1:1E:88:B1:E2:BB:14:69:DC`

Conviene registrar **dos** clientes Android con el mismo package y distinta huella:

1. la **clave de firma de Play** (la de arriba) → para todo lo que se instale desde Play,
   incluida la prueba interna;
2. la **clave de subida** de EAS → para instalar artefactos de EAS directamente.

Ambas huellas están en **Play Console → Versiones → Configuración → Firma de apps**.

No hace falta recompilar la app: el cambio es de configuración en Google Cloud y tarda
unos minutos en propagarse.

## Lo que sí se corrigió en el código

El `catch` del login colapsaba **todos** los errores en el mismo mensaje genérico y no
registraba el código, así que un `DEVELOPER_ERROR` era indistinguible de un fallo de red
y no dejaba rastro en producción. Ahora:

- el mensaje incluye el código: *"Error con Google Sign-In (DEVELOPER_ERROR)"*;
- el error se reporta a Sentry con `flow: google_signin` y el código como etiqueta.

Es el mismo patrón de falla silenciosa que se documentó en
`docs/mobile-functional-test-2026-08.md`: la app muestra una pantalla plausible y el
error real no llega a ninguna parte.

## Verificación

Después de crear el cliente OAuth, tocar **Continuar con Google** debe abrir el selector
de cuentas. Si vuelve a fallar, el mensaje ahora dirá el código, que distingue el caso:

| Código | Significa |
|---|---|
| `DEVELOPER_ERROR` (10) | Sigue sin coincidir package + SHA-1 + proyecto |
| `SIGN_IN_REQUIRED` (4) | Sin cuenta de Google en el dispositivo |
| `NETWORK_ERROR` (7) | Conectividad |
| `SIGN_IN_CANCELLED` (12501) | El usuario cerró el selector (no es error) |
