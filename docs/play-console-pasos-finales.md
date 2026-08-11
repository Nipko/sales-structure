# Play Console — pasos finales para la prueba interna

> Estado al 10-ago-2026. El AAB v6 está construido, validado, instalado y publicado en
> una prueba interna activa que contiene únicamente v6. App access, Target audience,
> Data safety y la ficha con cuatro capturas quedaron guardados; App content figura al
> día, la declaración de IA/opinión está completada y la ficha figura **Lista para
> enviar a revisión**. La lista de verificadores está guardada y seleccionada. Faltan
> validar la instalación desde Play y preparar Producción. La cuenta demo ya tiene 2FA
> desactivado y una compensación Pro activa hasta el 7-ago-2036.

## Archivos preparados

Todo está copiado en `C:\Users\USER\Desktop\parallly-v6-play\`:

| Archivo | Uso |
|---|---|
| `parallly-1.0.0-v6.aab` | Release Android; 53.293.577 bytes; versionCode `6` |
| `1-inbox.png` | Captura 1 |
| `2-conversacion.png` | Captura 2 |
| `3-crm.png` | Captura 3 |
| `4-agenda.png` | Captura 4 |

Las capturas son PNG RGB de 24 bits, sin alfa, `1080×2096`, relación `1.941`. El
propietario confirmó que todo el contenido visible es ficticio y autorizó su uso.

Datos para comprobar el AAB después de cargarlo:

- package: `cloud.parallly.mobile`
- versionName: `1.0.0`
- versionCode: `6`
- EAS build: `e8a0b188-d8a9-41c5-a9e0-c30ebb270279`
- commit: `41d58962`
- SHA-256:
  `D9C0DDD82EC0E27F464A7E885087067731E7F8679746C603F68CA64F57B7555F`

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

## 4. Release interno — activo solo con AAB v6

Ruta: **Prueba → Pruebas internas**.

El AAB v6 fue cargado correctamente. El artefacto anterior fue retirado y la versión
activa muestra únicamente `6 (1.0.0)`, API 24+ y target SDK 36.

Nombre guardado del release:

```text
1.0.0 (6) — prueba interna
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

Las cuatro imágenes de la carpeta `parallly-v6-play` fueron cargadas, en orden, en
**Capturas de pantalla de teléfono**. La ficha quedó guardada junto con el ícono y el
gráfico destacado existentes. Play muestra el estado **Lista para enviar a revisión**.

No usar `screen-1-inbox.png`, `screen-2-crm.png`, `screen-3-reserva.png` ni
`diag-inbox.png`: pertenecen a una iteración anterior y no son las capturas aprobadas.

## 6. Testers y lanzamiento interno — completados

En **Pruebas internas → Verificadores** quedó guardada y seleccionada la lista
`Parallly Android v6 testers`, con un verificador. El segmento interno está activo con
la versión `1.0.0 (6) — prueba interna`.

Enlace de participación:

`https://play.google.com/apps/internaltest/4701526887696492046`

Pendiente: abrir ese enlace con la cuenta verificadora, instalar la versión entregada por
Play y repetir el smoke test.

## 7. Producción — habilitada, preparación pendiente

El panel permite acceder a Producción y no muestra un requisito visible de mantener 12
testers durante 14 días. Este dato describe el estado observado de esta app en la
consola; no debe presentarse como una exención general de las políticas de Google Play.

La preparación de Producción está en `0/5` tareas. La selección de países/regiones sigue
pendiente. No iniciar un envío a revisión de Producción hasta completar esas tareas y
validar primero la prueba interna.

## Cuenta demo verificada para Producción

- `architerin@gmail.com`: activa y con 2FA desactivado;
- `Test Business`: plan Pro compensado, estado `active`, vigente hasta el 7-ago-2036;
- motivo auditado: `Cuenta demo Google Play — revisión y QA`;
- la impersonación utilizada para comprobar seguridad fue cerrada inmediatamente.

La prueba física visible ya pasó: Inbox mostró `SIN CONEXIÓN`, CRM mostró error y
`Reintentar`, y al restaurar Wi-Fi/datos la acción recargó los leads sin cerrar sesión,
sin fatal ni errores de parseo JSON.

Google puede volver a validar las credenciales en futuras actualizaciones. Un trial de
corta duración no es adecuado para la cuenta de revisión.

## Criterio de cierre

La preparación queda completa solo cuando todos estos puntos estén confirmados:

- [x] comportamiento visible de desconexión/reconexión aprobado;
- [x] App access agregado y guardado;
- [x] 2FA desactivado y plan permanente confirmados;
- [x] Target audience guardado como 18+;
- [x] Data safety guardado y App content al día;
- [x] AAB v6 cargado y reconocido como versionCode 6, único artefacto del release;
- [x] cuatro capturas cargadas y ficha guardada;
- [x] declaración de IA/opinión completada con los dos recursos promocionales
  etiquetados y las cuatro capturas reales sin etiquetar;
- [x] ficha en estado `Lista para enviar a revisión`;
- [x] testers configurados;
- [x] rollout interno iniciado;
- [ ] versión instalada desde Play y smoke interno repetido;
- [ ] 5 tareas de Producción completadas, incluidos países/regiones.

La prueba interna está publicada. La app aún no fue enviada a revisión ni publicada en
Producción.
