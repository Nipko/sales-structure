---
id: cuenta-seguridad
title: "Tu cuenta, equipo y seguridad"
routes: ["/admin/users", "/admin/settings/security", "/admin/settings/change-password"]
roles: ["tenant_admin"]
keywords: ["cuenta", "seguridad", "equipo", "usuarios", "invitar usuario", "agregar usuario", "roles", "permisos", "administrador", "supervisor", "agente", "verificacion en dos pasos", "2fa", "autenticacion", "codigo", "contrasena", "cambiar contrasena", "dispositivos de confianza", "sso", "inicio de sesion unico", "saml", "idioma", "tema", "modo oscuro", "cerrar sesion", "inactividad", "sesion"]
---

En esta sección administras quién de tu equipo entra a la plataforma, con qué permisos, y cómo proteges el acceso a tu cuenta. La mayoría de estas opciones las gestiona el rol **administrador**.

## Tu equipo y los roles

Puedes invitar a las personas de tu equipo para que trabajen contigo en la plataforma. Cada persona tiene un **rol** que define qué puede ver y hacer:

| Rol | Para quién | Qué puede hacer |
|-----|-----------|-----------------|
| **Administrador** | Dueño / responsable de la cuenta | Todo: configuración, canales, agentes de IA, facturación, usuarios y datos. |
| **Supervisor** | Jefe de equipo | Ver y auditar conversaciones, CRM y reportes; gestionar la operación, sin tocar facturación ni ajustes sensibles. |
| **Agente** | Persona de atención | Atender conversaciones en la bandeja de entrada y trabajar con los contactos asignados. |

### Cómo invitar a alguien

1. En la barra lateral, entra a **Usuarios**.
2. Haz clic en **Invitar usuario** (o **Agregar usuario**).
3. Escribe su **correo**, elige su **rol** y envía la invitación.
4. La persona recibe un correo con un enlace para aceptar la invitación y crear su contraseña.

Desde la misma pantalla puedes cambiar el rol de un usuario o desactivar su acceso cuando alguien deja el equipo.

> **Cuántos usuarios puedo tener**: depende de tu plan. Si necesitas más, mejora tu plan en **Configuración** → **Facturación**.

---

## Verificación en dos pasos (2FA)

La verificación en dos pasos agrega una segunda capa de seguridad: además de tu contraseña, se pide un código temporal al iniciar sesión. Muy recomendada, sobre todo para administradores.

1. Entra a **Configuración** → **Seguridad**.
2. Activa la **Verificación en dos pasos** y elige el método:
   - **App de autenticación** (recomendado): escanea el código QR con Google Authenticator, Authy o similar, e ingresa el código de 6 dígitos para confirmar.
   - **Correo electrónico**: recibes el código en tu email cada vez que inicias sesión.
3. Al activarla, se generan unos **códigos de respaldo**. Guárdalos en un lugar seguro: te permiten entrar si pierdes el acceso a tu app o tu correo.

### Dispositivos de confianza

Cuando inicias sesión desde tu computadora o teléfono habitual, puedes marcarlo como **dispositivo de confianza**. Así no te pedirá el código de dos pasos en ese dispositivo durante 30 días. Desde **Configuración** → **Seguridad** ves la lista de tus dispositivos de confianza y puedes quitar cualquiera que ya no uses (por ejemplo, un equipo prestado).

---

## Cambiar tu contraseña

1. Entra a **Configuración** → **Cambiar contraseña**.
2. Ingresa tu contraseña actual y luego la nueva (dos veces).
3. Guarda. Usa una contraseña larga y única, que no repitas en otros servicios.

> Si **olvidaste** tu contraseña y no puedes entrar, usa la opción **¿Olvidaste tu contraseña?** en la pantalla de inicio de sesión: recibirás un código en tu correo para crear una nueva.

---

## Inicio de sesión único (SSO)

Si tu empresa usa un sistema corporativo de identidad (por ejemplo el de tu proveedor de correo empresarial), puedes configurar el **inicio de sesión único (SSO)** para que tu equipo entre con las credenciales de la empresa, sin manejar contraseñas aparte.

1. Entra a **Configuración** → **Seguridad**.
2. En la sección de **SSO / SAML**, completa los datos que te da tu proveedor de identidad y descarga los datos que este te pide de Parallly.
3. Opcionalmente, puedes **forzar el SSO** para que todos los usuarios de tu empresa deban entrar por esta vía.

> El SSO es una función de los planes superiores. Si no ves la opción o quieres ayuda para configurarla, escríbenos a soporte.

---

## Idioma, tema e inicio de sesión

- **Idioma de la plataforma**: puedes usar la interfaz en español, inglés, portugués o francés. El selector de idioma está en el menú de tu perfil / barra superior. Cambiarlo no afecta el idioma en que tu asistente de IA responde a los clientes.
- **Tema claro u oscuro**: en la barra superior encuentras el interruptor de tema (claro / oscuro / automático según tu sistema).
- **Cierre de sesión por inactividad**: por seguridad, si dejas la sesión inactiva mucho tiempo, verás un aviso antes de cerrarla automáticamente. Es normal; solo vuelve a iniciar sesión.

---

## Preguntas frecuentes

**Invité a alguien pero no le llega el correo.**
Pídele que revise la carpeta de spam o correo no deseado. Verifica también que el correo esté bien escrito. Puedes reenviar la invitación desde **Usuarios**.

**Un agente ve menos opciones que yo. ¿Está mal?**
No. Cada rol ve solo lo que necesita para su trabajo. Un agente ve la bandeja de entrada y sus contactos, pero no la facturación ni la configuración: eso es correcto y protege tu cuenta.

**Activé la verificación en dos pasos y perdí mi teléfono.**
Usa uno de los **códigos de respaldo** que guardaste al activarla. Si tampoco los tienes, escríbenos a soporte para verificar tu identidad y recuperar el acceso.

**¿Puedo obligar a todo mi equipo a usar verificación en dos pasos?**
La verificación en dos pasos se activa por usuario. Si necesitas exigirla a nivel de toda la empresa o usar SSO obligatorio, contáctanos y te ayudamos según tu plan.

¿Sigues con dudas? Escríbenos en https://parallly-chat.cloud/support
