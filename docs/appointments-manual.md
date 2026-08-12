# Citas y Calendario — Manual Completo

> Actualizado: 2026-07-23 · Código de referencia: `apps/api/src/modules/appointments/*`, `apps/api/src/modules/conversations/tools/appointment-tools.ts`, `apps/dashboard/src/app/admin/appointments/*`, `apps/dashboard/src/components/appointments/*`, `apps/api/prisma/tenant-schema.sql`

## Resumen

El módulo de Citas es un sistema de agendamiento integrado en Parallly. Soporta:

- **Reserva multicanal por el agente IA** (WhatsApp, Instagram, Messenger, Telegram) vía tool calling / motor determinístico de reserva.
- **Página pública de auto-reserva** (`/book/:tenantSlug`) sin autenticación.
- **Gestión desde el dashboard** (calendario, agenda, servicios, configuración, analítica).
- **Citas recurrentes**, **multi-calendario** (Google/Outlook), **recordatorios por plantilla de WhatsApp** y **confirmaciones multicanal + email**.

> Nota: **SMS ya no es un canal conversacional**. El SMS del proyecto es notificación one-way por créditos (modelo reseller); no participa en el flujo de reserva ni en las confirmaciones de citas.

---

## Arquitectura

```
El cliente reserva vía:
  1. WhatsApp/IG/Messenger/Telegram → Agente IA (tool calling / booking-engine) → AppointmentsService
  2. Página pública (/book/:tenantSlug) → PublicBookingController → AppointmentsService
  3. Dashboard (admin) → AppointmentsController → AppointmentsService

Después de reservar:
  → EventEmitter('appointment.created') → AppointmentNotificationsService
    → OutboundQueueService → confirmación por el canal del contacto (WhatsApp/IG/Messenger/Telegram)
    → (opcional) EmailTemplatesService → email de confirmación
    → EventEmitter('appointment.ws') → relay WebSocket al dashboard

Antes de la cita (crons):
  → send24hReminders  (*/15)          → plantilla WhatsApp aprobada (24 h antes)
  → send2hReminders   (3,18,33,48)    → plantilla WhatsApp aprobada (2 h antes)

Después de la cita (crons):
  → sendAttendanceChecks (5,35)       → plantilla WhatsApp de confirmación de asistencia (≥30 min tras end_at)
  → autoCompleteAppointments (20 * *) → marca 'completed' (completed_by='auto') las confirmadas que terminaron hace ≥2 h
```

**Importante sobre recordatorios**: los recordatorios (24 h / 2 h) y la comprobación de asistencia se envían **exclusivamente como plantillas de WhatsApp aprobadas** vía `WhatsappMessagingService.sendTemplate` (funcionan fuera de la ventana de 24 h). **No** pasan por `OutboundQueueService` y **solo** se envían a contactos cuyo `channel_type` es `whatsapp` (los demás se omiten). Las **confirmaciones y cancelaciones**, en cambio, sí van por `OutboundQueueService` y respetan el canal del contacto.

**No existe auto no-show**: ningún cron marca automáticamente `no_show`. La comprobación de asistencia solo envía una plantilla; el estado `no_show` se asigna manualmente desde el dashboard.

---

## Backend (API)

### Archivos

| Archivo | Propósito |
|------|-----------|
| `appointments.module.ts` | Módulo NestJS |
| `appointments.controller.ts` | Endpoints REST (JWT + RolesGuard + TenantGuard). Rutas estáticas antes de las dinámicas `:appointmentId` |
| `appointments.service.ts` | CRUD, disponibilidad, recurrencia, detección de conflictos, config (recordatorios / flows / reserva pública) |
| `services.service.ts` | CRUD de servicios + asignación de staff |
| `calendar-integration.service.ts` | OAuth + sync Google/Outlook, multi-calendario, resolución en 3 niveles, gate por plan (`maxCalendars`) |
| `calendar-callback.controller.ts` | Callbacks OAuth2 de los proveedores de calendario |
| `public-booking.controller.ts` | Endpoints públicos (sin auth) para reserva del cliente, rate-limit por IP |
| `appointment-reminders.service.ts` | Crons: recordatorios 24 h / 2 h, comprobación de asistencia, auto-complete |
| `appointment-notifications.service.ts` | Confirmación/cancelación dirigidas por eventos (canal del contacto + email) |
| `appointment-notifications-i18n.ts` | Textos de las notificaciones (es/en/pt/fr) |

Las herramientas del agente IA viven fuera del módulo, en `conversations/tools/appointment-tools.ts` (definiciones + máquina de estados del prompt) y se ejecutan en `conversations/ai-tool-executor.service.ts`.

### Endpoints REST

Prefijo global: `/api/v1`. Todas las rutas autenticadas usan `@UseGuards(AuthGuard('jwt'), RolesGuard, TenantGuard)`.

#### Autenticadas (JWT + TenantGuard)

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| `GET` | `/appointments/:tenantId` | Listar citas (filtros: `status`, `assignedTo`, `startDate`, `endDate`) |
| `POST` | `/appointments/:tenantId` | Crear cita individual |
| `PUT` | `/appointments/:tenantId/:appointmentId` | Actualizar cita |
| `PUT` | `/appointments/:tenantId/:appointmentId/cancel` | Cancelar cita (con motivo) |
| `GET` | `/appointments/:tenantId/:appointmentId` | Obtener cita por ID |
| `POST` | `/appointments/:tenantId/recurring` | Crear serie recurrente |
| `GET` | `/appointments/:tenantId/recurring/:groupId` | Instancias de una serie |
| `PUT` | `/appointments/:tenantId/recurring/:groupId/cancel` | Cancelar la serie completa |
| `GET` / `POST` / `PUT` / `DELETE` | `/appointments/:tenantId/services[/:serviceId]` | CRUD de servicios (POST gateado por plan → `appointmentsServices`) |
| `GET` | `/appointments/:tenantId/services/:serviceId/staff` | Staff asignado a un servicio |
| `POST` | `/appointments/:tenantId/services/:serviceId/staff` | Asignar staff a un servicio |
| `DELETE` | `/appointments/:tenantId/services/:serviceId/staff/:userId` | Quitar staff de un servicio |
| `GET` / `POST` | `/appointments/:tenantId/availability` | Leer / guardar horario semanal |
| `GET` / `POST` / `DELETE` | `/appointments/:tenantId/blocked-dates[/:dateId]` | Fechas bloqueadas |
| `GET` | `/appointments/:tenantId/bookable-slots` | Slots reservables (duración de servicio + ocupación de calendario) |
| `GET` | `/appointments/:tenantId/check-slots` | Slots disponibles (herramienta IA) |
| `POST` | `/appointments/:tenantId/calendar/sync` | Sync manual de eventos externos + emite `calendar.synced` (WebSocket) |
| `GET` | `/appointments/:tenantId/calendar/integrations` | Calendarios conectados (`?all=true` para todos los usuarios) |
| `GET` | `/appointments/:tenantId/calendar/events` | Eventos de calendario externo |
| `GET` | `/appointments/:tenantId/calendar/google/connect` | Iniciar OAuth Google (con `assignmentType`/`assignmentId` opcionales) |
| `GET` | `/appointments/:tenantId/calendar/microsoft/connect` | Iniciar OAuth Microsoft/Outlook |
| `PUT` | `/appointments/:tenantId/calendar/:integrationId/assignment` | Actualizar etiqueta/asignación de un calendario |
| `DELETE` | `/appointments/:tenantId/calendar/:integrationId` | Desconectar calendario |
| `POST` | `/appointments/:tenantId/calendar/:integrationId/reassign-disconnect` | Endpoint de compatibilidad; hoy falla cerrado con `applySupported:false` y no reasigna. Reasignar/cancelar manualmente y verificar antes de desconectar |
| `GET` / `POST` | `/appointments/:tenantId/reminder-settings` | Leer / actualizar toggles de recordatorios |
| `GET` / `POST` | `/appointments/:tenantId/booking-flows-config` | Leer / actualizar WhatsApp Flows de reserva |
| `GET` / `POST` | `/appointments/:tenantId/public-booking-config` | Leer / actualizar toggle y branding de la reserva pública |

#### Públicas (sin auth, rate-limit 10/min por IP)

Ruta base: `/api/v1/booking/:tenantSlug/...`

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| `GET` | `/booking/:tenantSlug/info` | Branding del tenant (nombre, logo, color, `welcomeText`, toggle) |
| `GET` | `/booking/:tenantSlug/services` | Servicios reservables activos |
| `GET` | `/booking/:tenantSlug/services/:serviceId` | Detalle de un servicio |
| `GET` | `/booking/:tenantSlug/slots?date&serviceId` | Slots disponibles |
| `POST` | `/booking/:tenantSlug/book` | Crear reserva (requiere `serviceId`, `date`, `startTime`, `customerName`, `customerPhone`) |

Los endpoints públicos rechazan con `public_booking_disabled` cuando `settings.publicBooking.enabled` es `false`. El rate-limit usa `INCR`+`EXPIRE` atómico en Redis (`ratelimit:booking:{ip}`).

### Crons (`appointment-reminders.service.ts`)

Cada cron recorre los tenants activos, lee `getReminderSettings(tenantId)` y respeta el toggle correspondiente antes de procesar.

| Cron | Método | Toggle | Propósito |
|------|--------|--------|-----------|
| `*/15 * * * *` | `send24hReminders()` | `reminder24h` | Citas a 23–25 h → plantilla WhatsApp `appointment_reminder`; marca `reminder_24h_sent = true` |
| `3,18,33,48 * * * *` | `send2hReminders()` | `reminder2h` | Citas a 1.75–2.25 h → plantilla `appointment_reminder`; marca `reminder_2h_sent = true` |
| `5,35 * * * *` | `sendAttendanceChecks()` | `attendanceCheck` | Citas que terminaron hace ≥30 min → plantilla `attendance_check`; marca `no_show_followed_up = true`. **No** cambia el estado a `no_show` |
| `20 * * * *` | `autoCompleteAppointments()` | `autoComplete` | `UPDATE ... SET status='completed', completed_at=NOW(), completed_by='auto'` en confirmadas que terminaron hace ≥2 h; actualiza `contacts.last_appointment_at` |

Detalles de las plantillas: se resuelve la plantilla aprobada (`whatsapp_templates.approval_status = 'APPROVED'`), la zona horaria del tenant (`settings.businessHours.timezone`, fallback `America/Bogota`) y el idioma (`tenant.language`, fallback `es`). Los recordatorios rellenan los parámetros de cuerpo: nombre, servicio, fecha, hora, staff y ubicación.

### Esquema de base de datos (`prisma/tenant-schema.sql`, por-tenant)

**Tabla `appointments`** (columnas base + `ADD COLUMN IF NOT EXISTS` para tenants existentes):
- `id` UUID PK
- `contact_id` UUID FK → contacts (ON DELETE SET NULL)
- `conversation_id` UUID FK → conversations (ON DELETE SET NULL)
- `assigned_to` UUID
- `service_id` UUID · `service_name` VARCHAR(500)
- `start_at` / `end_at` TIMESTAMP
- `status` VARCHAR(50) DEFAULT `'pending'` : `pending | confirmed | cancelled | completed | no_show`
- `location` VARCHAR(500) · `notes` TEXT · `metadata` JSONB
- `source` VARCHAR(50) DEFAULT `'manual'` : `manual | ai_agent | public_booking`
- `customer_name` · `customer_email` · `customer_phone`
- `google_event_id` · `outlook_event_id` VARCHAR(255)
- `reminder_sent` BOOLEAN (legacy) · `reminder_24h_sent` (legacy 24 h) · `reminder_2h_sent` BOOLEAN (recordatorio de 2 h **activo**)
- `cancellation_reason` TEXT · `no_show_followed_up` BOOLEAN
- `completed_at` TIMESTAMP · `completed_by` VARCHAR(50) (`'auto'` | `'staff'`)
- `rating` INTEGER (1-5) · `rating_feedback` TEXT
- `recurring_group_id` UUID · `recurrence_rule` JSONB
- `created_at`, `updated_at` TIMESTAMP

> Deuda técnica: coexisten `reminder_24h_sent` y `reminder_1h_sent`/`reminder_sent` (legacy) con `reminder_2h_sent`. El flujo vigente usa `reminder_24h_sent` y `reminder_2h_sent`.

**Tabla `services`:**
- `id`, `name`, `description`, `duration_minutes` (DEFAULT 30), `buffer_minutes` (DEFAULT 0)
- `price` DECIMAL(15,2), `currency` VARCHAR(10) DEFAULT `'COP'`, `color`, `is_active`, `sort_order`, `metadata`
- `category`, `location_type` (`in_person`/`online`/`hybrid`, DEFAULT `in_person`), `max_concurrent`, `required_fields` JSONB (DEFAULT `["name","phone"]`)
- `is_public` BOOLEAN (reservable en la página pública), `meeting_link`, `location_address`
- `duration_type` (`fixed`/`flexible`/`open`), `duration_minutes_max`

**Tabla `service_staff`:** `id`, `service_id` FK, `user_id`, `is_primary`, `sort_order` · UNIQUE(`service_id`, `user_id`).

**Tabla `availability_slots`:** `user_id`, `day_of_week` (0=domingo … 6=sábado), `start_time`/`end_time` TIME, `is_active`.

**Tabla `blocked_dates`:** `user_id`, `blocked_date` DATE, `reason`.

**Tabla `calendar_integrations`:** `user_id`, `provider` (`google`/`microsoft`, DEFAULT `google`), `encrypted_refresh_token`, `calendar_id` (DEFAULT `primary`), `account_email`, `sync_token`, `watch_channel_id`/`watch_resource_id`/`watch_expiration`, `is_active`, `label`, `assignment_type` (`general`/`staff`/`service`, DEFAULT `general`), `assignment_id`.

---

## Frontend (Dashboard)

### Arquitectura de componentes

```
admin/appointments/page.tsx (orquestador, ~1160 líneas)
├── CalendarGrid.tsx    — Vista semana/día, grid horario, indicador de hora actual
├── AgendaTab.tsx       — Tabla con búsqueda, filtros de estado, rango de fechas, acciones rápidas
├── ServicesTab.tsx     — Cards de servicio + panel de asignación de staff
├── ConfigTab.tsx       — 5 cards de configuración (ver abajo)
├── AnalyticsTab.tsx    — Analítica de citas
├── AppointmentModal.tsx — Alta/edición con opción de recurrencia
├── ServiceModal.tsx    — Alta/edición de servicio (duración/tipo, buffer, precio, color, ubicación)
└── shared.ts           — Tipos, constantes (DAY_KEYS, etc.) y utilidades de fecha
```

**5 pestañas** (`TabNav`): `calendar` · `agenda` · `services` · `config` · `analytics`.

### Calendario

**Vista semana:** grid de 7 días (lunes-domingo), franja 7:00-20:00, bloques con color del servicio; eventos externos (Google/Outlook) con borde punteado; clic en slot vacío crea cita; clic en cita edita; clic en cabecera de día cambia a vista día.

**Vista día:** columna única expandida, más detalle (nombre del staff), navegación día anterior/siguiente.

**Ambas:** indicador de hora actual (línea roja), auto-scroll a la hora actual, botón "Hoy", icono de repetición en citas recurrentes. Banner de sincronización con "Sincronizar ahora" y auto-refresh cada 2 min; actualizaciones en vivo por WebSocket (`/inbox`: `appointmentCreated`, `appointmentUpdated`, `calendarSynced`).

### Agenda

Búsqueda por servicio/contacto/agente, filtros de estado con contadores, rango de fechas (Desde/Hasta), acciones rápidas por fila (Ver/Editar, Confirmar, Completar, Cancelar), estado vacío.

### Servicios

Búsqueda y filtro (Todos/Activos/Inactivos), cards con franja de color, badges de duración/precio, toggle activo, panel expandible de asignación de staff (con badge de staff principal).

### Configuración — 5 cards (`ConfigTab.tsx`)

1. **Calendarios conectados** — Multi-calendario Google/Outlook con selector de asignación (general/staff/servicio), etiqueta editable en línea, contador `n/max` y bloqueo al alcanzar `maxCalendars`.
2. **Horario de atención** — Horario día a día con toggles y selectores de hora, opción 24/7.
3. **Recordatorios** — **4 toggles**: recordatorio 24 h, recordatorio 2 h, comprobación de asistencia, auto-completar. Persisten vía `POST /reminder-settings`.
4. **WhatsApp Flows (reserva)** — *Beta*, opt-in. Toggle + campo de `flowId`; habilitar requiere un Flow ID válido (validado en el servidor).
5. **Fechas bloqueadas** — Alta/baja de festivos/vacaciones.

> La antigua card "No-Show" fue **eliminada**: la comprobación de asistencia por plantilla la sustituye.

### Citas recurrentes

Toggle en el modal de creación; frecuencias Diaria / Semanal / Cada 2 semanas / Mensual; conteo de instancias (2-52); crea N citas enlazadas por `recurring_group_id`; icono de repetición en el calendario; cancelación de la serie completa vía API.

### Página pública de reserva (`/book/:tenantSlug`)

Asistente por pasos: **Servicio → Fecha → Hora → Datos del cliente (nombre y teléfono obligatorios; email/notas según `required_fields`) → Confirmación**. El branding (nombre, logo, color, texto de bienvenida) sale de `/booking/:tenantSlug/info`.

---

## Integración con IA

El agente IA reserva mediante **tool calling** sobre un motor de reserva **determinístico** (`conversations/booking-engine.service.ts`) que evita que el LLM decida el flujo. Las definiciones de herramientas y la máquina de estados del prompt están en `conversations/tools/appointment-tools.ts`; la ejecución en `conversations/ai-tool-executor.service.ts` (emite `appointment.created` al reservar y dispara la sincronización de calendario).

**8 herramientas disponibles:**

| Herramienta | Propósito |
|------|-----------|
| `list_services` | Lista los servicios reservables. Llamar UNA vez al inicio |
| `check_availability` | Slots disponibles para `date` + `serviceId` (`staffId` opcional). Obligatoria antes de mostrar horarios |
| `create_appointment` | Reserva tras confirmación (requiere `serviceId`, `date`, `time`, `customerName`, `customerEmail`) |
| `cancel_appointment` | Cancela por `appointmentId` (verifica pertenencia por `contact_id`) |
| `list_customer_appointments` | Próximas citas del cliente actual |
| `reschedule_appointment` | Reprograma a nueva fecha/hora; sugiere llamar antes a `check_availability`; solo citas propias |
| `get_appointment_details` | Detalle completo de una cita (servicio, fecha, hora, estado, notas) |
| `send_booking_link` | Devuelve el enlace de auto-reserva para que el cliente reserve por su cuenta |

**Máquina de estados del prompt** (`BookingState`): `idle → has_services → has_service → has_date → has_slots → has_time → collecting_info → confirmed`. Con auto-selección si hay un único servicio, fuzzy match de nombres de servicio, detección de "hoy"/"today" y de confirmación ("sí/yes/ok/confirmo…").

**Reglas del prompt:** nunca inventar disponibilidad (solo slots de `check_availability`); no re-preguntar datos ya conocidos; no pedir nombre/email hasta que el cliente elija horario; respuestas de 1-3 frases; responder en el idioma del cliente.

---

## Flujo de notificaciones

| Evento | Disparador | Destino | Contenido |
|--------|------------|---------|-----------|
| Cita creada | `appointment.created` → `AppointmentNotificationsService` | Canal del contacto (WhatsApp/IG/Messenger/Telegram) vía `OutboundQueueService` + email opcional | Confirmación con servicio, fecha, hora, ubicación / enlace de reunión |
| Cita cancelada | `appointment.cancelled` | Canal del contacto vía `OutboundQueueService` | Aviso de cancelación con motivo |
| Recordatorio 24 h | Cron `*/15` | **Solo WhatsApp**, plantilla `appointment_reminder` vía `sendTemplate` | Recordatorio con detalles |
| Recordatorio 2 h | Cron `3,18,33,48` | **Solo WhatsApp**, plantilla `appointment_reminder` | Recordatorio |
| Comprobación de asistencia | Cron `5,35` | **Solo WhatsApp**, plantilla `attendance_check` | Confirmación de asistencia (no reprograma ni marca no-show) |

**Confirmaciones/cancelaciones**: `OutboundQueueService` (BullMQ, 3 reintentos, rate-limit por plan), resolviendo el canal por `contact.channel_type` y el token por-cuenta vía `ChannelTokenService`. Emiten además `appointment.ws` para el relay WebSocket al dashboard.

**Email de confirmación**: si el contacto tiene email y `agent_personas.config_json.tools.appointments.emailConfirmations` **no** está en `false`, se envía la plantilla `appointment_confirmation_email` (es/en/pt/fr) vía `EmailTemplatesService` (fire-and-forget, no crítico).

**Recordatorios/asistencia**: se envían solo a contactos `channel_type = 'whatsapp'` y requieren la plantilla de Meta aprobada; si no hay plantilla aprobada, se omite con warning.

---

## Gating por plan

Las capacidades `appointmentsServices` y `maxCalendars` se leen de
`billing_plans.features` y de los overrides autorizados del tenant. No se duplican
valores por plan en este manual porque el catálogo puede cambiar sin despliegue. La
creación de servicios se bloquea en `POST /services`
(`throttle.enforcePlanLimit('appointmentsServices', …)`) y la conexión de
calendarios en `calendar-integration.service.ts`
(`enforcePlanLimit('maxCalendars', …)`). Ambas claves están registradas en
`throttle/plan-features.registry.ts`.

**Multi-calendario — resolución en 3 niveles** al sincronizar: calendario
específico de servicio → específico de staff → general del tenant. Genera enlaces
de Google Meet / Teams para servicios `online`/`hybrid`. La desconexión con citas
dependientes no tiene hoy una reasignación/cancelación automática certificada: el
endpoint de compatibilidad responde `applySupported:false`; hay que reasignar o
cancelar manualmente, verificar el resultado y solo entonces desconectar.

---

## i18n

Todos los textos de UI están traducidos en 4 idiomas (es/en/pt/fr) vía next-intl. Namespace: `appointments.*`.

Secciones clave: `status.*`, `servicesSection.*`, `configSection.*` (incluye `reminder24h`, `reminder2h`, `attendanceCheck`, `autoComplete`, `whatsappFlows*`), `errors.*`, `toasts.*`, `recurrence*`, `days.*`/`daysShort.*`.

Los textos de las notificaciones de canal viven en `appointment-notifications-i18n.ts` (backend); los del email en las plantillas de `email-templates`.

Formato de fecha en el dashboard vía `useLocale()` → `dateLocale`: es → es-MX, en → en-US, pt → pt-BR, fr → fr-FR. En el backend, las plantillas/notificaciones usan es-CO para el español.
