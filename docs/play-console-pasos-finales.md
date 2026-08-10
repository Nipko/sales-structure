# Play Console — los pasos que faltan, uno por uno

> Guía de ejecución para terminar la publicación. Todo lo técnico ya está hecho: el AAB
> v5 está construido, validado y probado en dispositivo, y las capturas están listas.
> Lo que queda es trabajo de consola web.
>
> **Por qué esta guía existe:** Play Console **no carga bajo automatización de navegador**.
> Se intentó cinco veces y falló siempre en el mismo punto, con un código de error
> distinto cada vez (`43CCEA1F`, `4970C2D2`, `66B0ECAE`, `526DDD72`). La sesión y la
> cuenta de desarrollador eran correctas — llegaba a "Choose developer account → Parallext"
> y moría después. Es una defensa del propio Google contra contextos automatizados.

## Los archivos, ya listos

Todo copiado a **`C:\Users\USER\Desktop\parallly-v5-play\`**:

| Archivo | Qué es |
|---|---|
| `parallly-1.0.0-v5.aab` | El artefacto. 53.289.549 bytes, versionCode **5** |
| `1-inbox.png` | Captura 1 |
| `2-conversacion.png` | Captura 2 |
| `3-crm.png` | Captura 3 |
| `4-agenda.png` | Captura 4 |

Las capturas son 1080×2096, ratio 1.941 (bajo el máximo 2:1), 24 bits sin alfa.

---

## 1. Target audience — hacerlo PRIMERO

`Política > Contenido de la app > Público objetivo y contenido`

Marcar **únicamente `18 años o más`**. Nada más.

Va primero porque **Play no deja enviar Data safety mientras este bloque siga incompleto**.
Si se hace al revés, el botón de envío aparece deshabilitado sin explicar por qué.

## 2. App access

`Política > Contenido de la app > Acceso a la app`

Elegir **"Todas o algunas funciones tienen acceso restringido"** y agregar una instrucción:

- **Nombre**: `Agent console login`
- **Usuario**: `architerin@gmail.com`
- **Contraseña**: la de la cuenta demo *(pegala vos)*
- **Instrucciones** — copiar tal cual:

```
Sign in with the credentials above. The account does not require two-factor
authentication. Open Inbox to review synthetic conversations, CRM for sample leads,
and Deal for appointments. All records are fictional and no additional setup or
payment is required. The app is an agent console for an existing business account;
sign-up and billing happen on the web dashboard, not inside the app.
```

## 3. Data safety

`Política > Contenido de la app > Seguridad de los datos`

Los 5 pasos ya están guardados como borrador con las decisiones correctas. Sólo queda
**enviar**. Repasar antes que sigan así:

- la app recopila datos · se cifran en tránsito
- eliminación de cuenta vía `https://parallly-chat.cloud/data-deletion`
- **no** se declaran datos compartidos (Sentry, Expo y FCM son proveedores que procesan
  por cuenta de Parallly)
- ya se quitaron "Información de pago del usuario" y "Otros datos de rendimiento"

## 4. Subir el AAB v5

`Prueba > Pruebas internas > Crear nueva versión`

- **Eliminar el AAB v2** que está en el borrador. Es anterior a todos los arreglos.
- Subir `parallly-1.0.0-v5.aab`.
- Verificar que la consola muestre **versionCode 5**.

Notas de la versión (español):

```
Primera versión de prueba interna.
Consola de agentes: bandeja unificada, CRM, agenda y copiloto de IA.
```

## 5. Capturas en la ficha

`Crecimiento > Presencia en Play Store > Ficha de Play Store principal`

Subir las 4 en `Capturas de pantalla de teléfono`. El ícono y el gráfico destacado ya
están cargados.

> Las capturas viejas (`screen-1-inbox.png`, `screen-2-crm.png`, `screen-3-reserva.png`,
> `diag-inbox.png`) siguen en `apps/mobile/store-assets/` y **no deben subirse**: tienen
> nombres y teléfonos reales, pantallas vacías y formato fuera de norma. Conviene borrarlas.

## 6. Testers y lanzamiento

En Pruebas internas → pestaña `Testers`: crear una lista y agregar los correos.
Después **Revisar versión** → repasar TODOS los avisos → **Iniciar lanzamiento**.

---

## Lo que sigue pendiente y no es de la consola

Dos cosas de la cuenta de revisión que **no fallan hoy, fallan en tres meses**:

- **2FA desactivado** en `architerin@gmail.com`
- **Plan o trial que no expire**

Google revalida esa cuenta en **cada actualización futura**. Si el trial vence, un día se
sube la 1.0.1 y la rechazan porque el revisor no puede entrar, sin relación aparente con
el cambio que se subió.

## Salvedad sobre la captura del Inbox

`1-inbox.png` cumple la norma pero es **débil como pieza de marketing**: una sola
conversación y mucho espacio vacío. Para que venda hacen falta 3-5 conversaciones en el
tenant demo — se cargan desde el dashboard o escribiéndole al bot de Telegram desde un
par de cuentas. No bloquea la revisión.
