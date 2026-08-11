# Play Console — estado final y seguimiento de publicación

> Estado al 10-ago-2026. El AAB v7 está construido, validado, instalado desde Google
> Play y publicado en una prueba interna activa. App access, Target audience,
> Data safety y la ficha con cuatro capturas quedaron guardados; App content figura al
> día y la declaración de IA/opinión está completada. La lista de verificadores está
> guardada y seleccionada. El rollout completo de Producción con v7 fue enviado para 176
> países/regiones más `Resto del mundo`; Play confirma **Tus cambios están en proceso de
> revisión** para los 11 cambios. La publicación administrada está desactivada, por lo
> que la aprobación publicará automáticamente. La cuenta demo tiene 2FA desactivado y
> una compensación Pro activa hasta el 7-ago-2036.

## Archivos preparados

El AAB vigente está en `C:\Users\USER\Desktop\parallly-v7-play\` y las capturas
aprobadas permanecen en `apps/mobile/store-assets/play/`:

| Archivo | Uso |
|---|---|
| `parallly-1.0.0-v7.aab` | Release Android; 53.294.348 bytes; versionCode `7` |
| `1-inbox.png` | Captura 1 |
| `2-conversacion.png` | Captura 2 |
| `3-crm.png` | Captura 3 |
| `4-agenda.png` | Captura 4 |

Las capturas son PNG RGB de 24 bits, sin alfa, `1080×2096`, relación `1.941`. El
propietario confirmó que todo el contenido visible es ficticio y autorizó su uso.

Datos para comprobar el AAB después de cargarlo:

- package: `cloud.parallly.mobile`
- versionName: `1.0.0`
- versionCode: `7`
- EAS build: `d42cf4d5-db7c-4f6c-95c9-32e174901d16`
- commit: `8bea2bec1b3b502285633bc7bbf34a79c6ee7d69`
- SHA-256:
  `194859407468ECD77F59D666B8AD8FE8E3BD207AFC04853044774599FD78747B`

## 1. App access — guardado

Ruta: **Política → Contenido de la app → Acceso a la app**.

Quedó seleccionada la opción que indica que todas o algunas funciones tienen acceso
restringido. El detalle `Agent console login` fue agregado y la página quedó guardada
con una cuenta demo que da acceso a todas las funciones.

- **Nombre:** `Agent console login`
- **Usuario:** `architerin@gmail.com`
- **Contraseña:** escribirla directamente en Play Console; no guardarla en el repo ni
  enviarla por chat
- **Acceso:** todas las funciones de la app
- **Instrucciones:**

```text
Sign in with the credentials above. Two-factor authentication is disabled. Open Inbox
to review synthetic conversations, CRM for sample leads, and Deal for appointments.
All records are fictional and no additional setup or payment is required. The app is
an agent console for an existing business account; sign-up and billing happen on the
web dashboard, not inside the app.
```

El guardado de Play está completo. La afirmación incluida en las instrucciones sobre
2FA fue verificada mediante la pantalla de seguridad de la cuenta demo: 2FA está
desactivado y la acción disponible es `Activar autenticación de dos factores`.

## 2. Target audience — guardado

Ruta: **Política → Contenido de la app → Público objetivo y contenido**.

Quedó marcada únicamente la opción **`18 años o más`** y la página fue guardada. No se
seleccionaron edades infantiles.

## 3. Data safety y App content — guardados

Ruta: **Política → Contenido de la app → Seguridad de los datos**.

Se revisó el formulario existente sin cambiar sus respuestas y se guardó. App content
muestra **Ya estás al día**. Las decisiones registradas son:

- la app recopila datos y los cifra en tránsito;
- eliminación mediante `https://parallly-chat.cloud/data-deletion`;
- no se declaran datos compartidos por el uso de Sentry, Expo y FCM como proveedores de
  servicio de Parallly;
- no están seleccionados “Información de pago del usuario” ni “Otros datos de
  rendimiento de la app”;
- sí se declaran los datos que realmente procesa la consola: identidad/contacto,
  mensajes y adjuntos, archivos, actividad, fallas/diagnóstico e identificador push;
- no se declara ubicación.

No hay una acción pendiente en el resumen de App content. La declaración de
IA/opinión también quedó completada con criterio conservador:

- se etiquetaron `play-icon-512.png` y
  `play-feature-graphic-1024x500.png`;
- no se etiquetaron las cuatro capturas de pantalla porque muestran la interfaz real de
  la app y no son recursos generados o alterados por IA.

## 4. Release interno — v7 activo

Ruta: **Prueba → Pruebas internas**.

El AAB v7 fue cargado correctamente y la versión activa muestra `7 (1.0.0)`, API 24+ y
target SDK 36.

Nombre guardado del release:

```text
7 (1.0.0)
```

Notas guardadas:

```text
<es-419>
Primera versión de prueba interna de Parallly para Android.
• Bandeja multicanal, CRM y operaciones por vertical.
• Copiloto de IA y agenda.
• Manejo mejorado de desconexiones, errores y sesiones.
</es-419>
```

El release fue publicado el 10-ago-2026 en el segmento interno y Play lo muestra como
**Disponible para verificadores internos**. El único aviso es que no se adjuntó un
archivo de desofuscación; es opcional para este build.

## 5. Capturas y ficha — guardadas

Ruta: **Crecimiento → Presencia en Play Store → Ficha de Play Store principal**.

Las cuatro imágenes aprobadas fueron cargadas, en orden, en
**Capturas de pantalla de teléfono**. La ficha quedó guardada junto con el ícono y el
gráfico destacado existentes, y fue incluida en los cambios enviados a revisión.

No usar `screen-1-inbox.png`, `screen-2-crm.png`, `screen-3-reserva.png` ni
`diag-inbox.png`: pertenecen a una iteración anterior y no son las capturas aprobadas.

## 6. Testers y lanzamiento interno — completados

En **Pruebas internas → Verificadores** quedó guardada y seleccionada la lista con un
verificador. El segmento interno está activo con la versión `1.0.0 (7)`.

Enlace de participación:

`https://play.google.com/apps/internaltest/4701526887696492046`

La v7 fue instalada/actualizada desde Play en el Samsung SM-S918B. Android identifica
`com.android.vending` como instalador. El arreglo del conflicto de sesión durante el
login fue verificado, y el smoke de desconexión, reconexión y relanzamiento terminó en
**PASS**.

## 7. Producción — en revisión

El panel permite acceder a Producción y no muestra un requisito visible de mantener 12
testers durante 14 días. Este dato describe el estado observado de esta app en la
consola; no debe presentarse como una exención general de las políticas de Google Play.

El rollout completo de v7 fue enviado para 176 países/regiones más `Resto del mundo`.
Play muestra 11 cambios y confirma **Tus cambios están en proceso de revisión**. La app
todavía no está publicada en Producción. La publicación administrada está desactivada,
así que Play publicará automáticamente si aprueba el envío.

## Cuenta demo verificada para Producción

- `architerin@gmail.com`: activa y con 2FA desactivado;
- `Test Business`: plan Pro compensado, estado `active`, vigente hasta el 7-ago-2036;
- motivo auditado: `Cuenta demo Google Play — revisión y QA`;
- la impersonación utilizada para comprobar seguridad fue cerrada inmediatamente.

La prueba física de la entrega de Google Play ya pasó: el login no volvió a presentar
el conflicto de sesión, Inbox mostró `SIN CONEXIÓN`, CRM mostró error y `Reintentar`, y
al restaurar Wi-Fi/datos la acción recargó los leads sin cerrar sesión. El relanzamiento
también fue correcto, sin fatal ni errores de parseo JSON.

Google puede volver a validar las credenciales en futuras actualizaciones. Un trial de
corta duración no es adecuado para la cuenta de revisión.

## Criterio de cierre

La preparación queda completa solo cuando todos estos puntos estén confirmados:

- [x] comportamiento visible de desconexión/reconexión aprobado;
- [x] App access agregado y guardado;
- [x] 2FA desactivado y plan permanente confirmados;
- [x] Target audience guardado como 18+;
- [x] Data safety guardado y App content al día;
- [x] AAB v7 cargado y reconocido como versionCode 7 en el release activo;
- [x] cuatro capturas cargadas y ficha guardada;
- [x] declaración de IA/opinión completada con los dos recursos promocionales
  etiquetados y las cuatro capturas reales sin etiquetar;
- [x] ficha incluida en los cambios enviados a revisión;
- [x] testers configurados;
- [x] rollout interno iniciado;
- [x] versión instalada/actualizada desde Play (`com.android.vending`) y smoke repetido;
- [x] rollout completo de Producción enviado para 176 países/regiones y `Resto del
  mundo`;
- [x] 11 cambios enviados explícitamente a revisión;
- [ ] revisión de Google Play aprobada;
- [ ] publicación automática en Producción confirmada.

La prueba interna v7 está publicada y los 11 cambios del rollout de Producción están en
revisión. La app aún no está publicada; con publicación administrada desactivada, Play
la publicará automáticamente después de aprobar.
