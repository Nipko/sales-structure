# Appointments & Calendar System — Complete Manual

## Overview

The Appointments module is a comprehensive scheduling system built into Parallly, supporting multi-channel booking (WhatsApp, Instagram, Messenger, Telegram, SMS), AI-powered scheduling via tool calling, public self-service booking, and recurring appointments.

---

## Architecture

```
Customer books via:
  1. WhatsApp/IG/Messenger/Telegram → AI Agent (tool calling) → AppointmentsService
  2. Public booking page (/book/:tenantSlug) → PublicBookingController → AppointmentsService
  3. Dashboard (admin) → AppointmentsController → AppointmentsService

After booking:
  → EventEmitter('appointment.created') → AppointmentNotificationsService
    → OutboundQueueService → WhatsApp confirmation message

Before appointment:
  → Cron (every 15min) → AppointmentRemindersService
    → 24h reminder via WhatsApp
    → 1h reminder via WhatsApp

After appointment:
  → Cron (every 30min) → AppointmentRemindersService
    → Auto-mark no-shows (30min after end_at)
    → Send follow-up message offering to reschedule
```

---

## Backend (API)

### Files

| File | Purpose |
|------|---------|
| `appointments.module.ts` | NestJS module, imports ChannelsModule |
| `appointments.controller.ts` | REST endpoints (JWT auth required) |
| `appointments.service.ts` | Core CRUD, availability, recurring, conflict detection |
| `services.service.ts` | Services CRUD + staff assignment |
| `calendar-integration.service.ts` | Google/Microsoft Calendar OAuth + sync |
| `calendar-callback.controller.ts` | OAuth2 callbacks for calendar providers |
| `public-booking.controller.ts` | Public endpoints (no auth) for customer booking |
| `appointment-reminders.service.ts` | Cron jobs: 24h/1h reminders + no-show detection |
| `appointment-notifications.service.ts` | Event-driven WhatsApp confirmations/cancellations |

### API Endpoints

#### Authenticated (JWT + TenantGuard)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/appointments/:tenantId` | List appointments (filter by status, date range, agent) |
| `POST` | `/appointments/:tenantId` | Create single appointment |
| `PUT` | `/appointments/:tenantId/:id` | Update appointment |
| `PUT` | `/appointments/:tenantId/:id/cancel` | Cancel appointment (with reason) |
| `GET` | `/appointments/:tenantId/:id` | Get appointment by ID |
| `POST` | `/appointments/:tenantId/recurring` | Create recurring series |
| `GET` | `/appointments/:tenantId/recurring/:groupId` | Get all instances of a series |
| `PUT` | `/appointments/:tenantId/recurring/:groupId/cancel` | Cancel entire series |
| `GET` | `/appointments/:tenantId/services` | List services |
| `POST` | `/appointments/:tenantId/services` | Create service |
| `PUT` | `/appointments/:tenantId/services/:id` | Update service |
| `DELETE` | `/appointments/:tenantId/services/:id` | Delete service |
| `GET` | `/appointments/:tenantId/services/:id/staff` | List staff for service |
| `POST` | `/appointments/:tenantId/services/:id/staff` | Assign staff to service |
| `DELETE` | `/appointments/:tenantId/services/:id/staff/:userId` | Remove staff from service |
| `GET` | `/appointments/:tenantId/availability` | Get availability slots |
| `POST` | `/appointments/:tenantId/availability` | Save availability slots |
| `GET` | `/appointments/:tenantId/blocked-dates` | List blocked dates |
| `POST` | `/appointments/:tenantId/blocked-dates` | Block a date |
| `DELETE` | `/appointments/:tenantId/blocked-dates/:id` | Unblock a date |
| `GET` | `/appointments/:tenantId/bookable-slots` | Get available slots (with calendar busy) |
| `GET` | `/appointments/:tenantId/check-slots` | AI tool: check available slots |
| `GET` | `/appointments/:tenantId/calendar/integrations` | List connected calendars |
| `GET` | `/appointments/:tenantId/calendar/events` | List external calendar events |
| `GET` | `/appointments/:tenantId/calendar/google/connect` | Start Google Calendar OAuth |
| `GET` | `/appointments/:tenantId/calendar/microsoft/connect` | Start Microsoft Calendar OAuth |
| `DELETE` | `/appointments/:tenantId/calendar/:id` | Disconnect calendar |

#### Public (No Auth)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/booking/:tenantSlug/services` | List active bookable services |
| `GET` | `/booking/:tenantSlug/services/:id` | Get service details |
| `GET` | `/booking/:tenantSlug/slots?date&serviceId` | Get available time slots |
| `POST` | `/booking/:tenantSlug/book` | Create booking (customer info required) |

### Cron Jobs

| Schedule | Method | Purpose |
|----------|--------|---------|
| `*/15 * * * *` | `send24hReminders()` | Find appointments 23-25h away, send WhatsApp reminder |
| `3,18,33,48 * * * *` | `send1hReminders()` | Find appointments 45-75min away, send WhatsApp reminder |
| `5,35 * * * *` | `markNoShows()` | Auto-mark appointments ended 30+ min ago as no_show, send follow-up |

### Database Schema

**appointments table:**
- `id` UUID PK
- `contact_id` UUID FK → contacts
- `conversation_id` UUID FK → conversations
- `assigned_to` UUID → public.users
- `service_name` VARCHAR
- `start_at` / `end_at` TIMESTAMP
- `status` VARCHAR: pending | confirmed | cancelled | completed | no_show
- `location`, `notes` TEXT
- `metadata` JSONB
- `source` VARCHAR: manual | ai_agent | public_booking
- `customer_name`, `customer_phone`, `customer_email`
- `reminder_24h_sent`, `reminder_1h_sent` BOOLEAN
- `cancellation_reason` TEXT
- `no_show_followed_up` BOOLEAN
- `rating` INTEGER (1-5)
- `rating_feedback` TEXT
- `recurring_group_id` UUID (links series instances)
- `recurrence_rule` JSONB (stored on first instance)
- `created_at`, `updated_at` TIMESTAMP

**services table:**
- `id`, `name`, `description`, `duration_minutes`, `buffer_minutes`
- `price`, `currency`, `color`, `is_active`, `sort_order`
- `category`, `location_type`, `max_concurrent`, `required_fields`

**service_staff table:**
- `service_id` UUID FK → services
- `user_id` UUID
- `is_primary` BOOLEAN
- UNIQUE(service_id, user_id)

**availability_slots table:**
- `user_id`, `day_of_week` (0-6), `start_time`/`end_time` TIME, `is_active`

**blocked_dates table:**
- `user_id`, `blocked_date` DATE, `reason`

**calendar_integrations table:**
- `user_id`, `provider` (google/microsoft), `encrypted_refresh_token`
- `calendar_id`, `account_email`, `sync_token`, `is_active`

---

## Frontend (Dashboard)

### Component Architecture

```
appointments/page.tsx (851 lines — orchestrator)
├── CalendarGrid.tsx — Week/Day view toggle, time grid, current time indicator
├── AgendaTab.tsx — Table view with search, status filters, date range, quick actions
├── ServicesTab.tsx — Service cards with staff assignment panel
├── ConfigTab.tsx — 6 config cards (schedule, calendars, reminders, blocked dates, no-show, calendar mode)
├── AppointmentModal.tsx — Create/edit form with recurrence option
├── ServiceModal.tsx — Create/edit service with duration presets, buffer, price, color
└── shared.ts — Types, constants (STATUS_CONFIG, HOURS, DAY_KEYS), utility functions
```

### Calendar Features

**Week View:**
- 7-day grid (Monday-Sunday), 7AM-8PM time slots
- Appointment blocks with service color, time, contact name
- External calendar events (Google/Outlook) shown with dashed border
- Click empty slot → create new appointment at that time
- Click appointment → edit
- Click day header → switch to day view

**Day View:**
- Single-column expanded layout
- Wider appointment blocks showing more detail (agent name)
- Same time grid and interaction patterns
- Navigation: previous/next day

**Both Views:**
- Current time indicator (red line with dot)
- Auto-scroll to current hour on mount
- Today button to jump back to current date
- Recurring appointments shown with repeat icon

### Agenda Features

- Full-text search across service name, contact name, agent name
- Status filter pills with count badges (Pending 3, Confirmed 5, etc.)
- Date range filter (From/To)
- Quick actions per row: View/Edit, Confirm, Complete, Cancel
- Empty state with action suggestion

### Services Features

- Search and filter (All/Active/Inactive)
- Service cards with color stripe, duration/price badges, active toggle
- Expandable staff assignment panel per service
- Assign/remove staff members from a dropdown
- Primary staff badge

### Configuration (6 Sections)

1. **Working Hours** — Day-by-day schedule with toggles and time pickers, 24/7 option
2. **Connected Calendars** — Google/Microsoft Calendar OAuth integration
3. **Automatic Reminders** — Toggle 24h and 1h WhatsApp reminders
4. **Blocked Dates** — Add/remove holiday/vacation dates
5. **No-Show Settings** — Auto-detection timing, follow-up message toggle
6. **Calendar Mode** — Week start day, slot duration, max daily appointments

### Recurring Appointments

- Toggle in appointment creation modal (checkbox + highlighted card)
- Frequency options: Daily, Weekly, Every 2 weeks, Monthly
- Instance count (2-52 max)
- Creates N individual appointments linked by `recurring_group_id`
- Repeat icon visible on appointment blocks in calendar
- Cancel entire series option via API

### Public Booking Page (`/book/:tenantSlug`)

4-step wizard:
1. **Service Selection** — Cards with name, duration, price
2. **Date Selection** — Calendar picker (past dates disabled)
3. **Time Selection** — Available slot grid
4. **Customer Info** — Name (required), phone (required), email, notes
5. **Confirmation** — Success screen with booking details

---

## AI Integration

The AI agent can book appointments through **tool calling** (function calling). Available tools:

| Tool | Purpose |
|------|---------|
| `list_services` | Returns active services with duration/price |
| `check_availability` | Generates available time slots for a date |
| `create_appointment` | Books an appointment after customer confirmation |
| `cancel_appointment` | Cancels (verifies ownership via contact_id) |
| `list_customer_appointments` | Returns upcoming appointments for the customer |

**Rules:**
- Never book without explicit customer confirmation
- Use context from previous turns (tool context persisted in conversation.metadata)
- Fuzzy match service names
- Max 3 slots returned per check

---

## Notifications Flow

| Event | Trigger | Channel | Message |
|-------|---------|---------|---------|
| Appointment created | EventEmitter `appointment.created` | WhatsApp/IG/Messenger/Telegram | Confirmation with service, date, time, location |
| Appointment cancelled | EventEmitter `appointment.cancelled` | WhatsApp/IG/Messenger/Telegram | Cancellation notice with reason |
| 24h reminder | Cron every 15 min | WhatsApp/IG/Messenger/Telegram | Reminder with full details |
| 1h reminder | Cron every 15 min | WhatsApp/IG/Messenger/Telegram | Urgent reminder |
| No-show follow-up | Cron every 30 min | WhatsApp/IG/Messenger/Telegram | Offer to reschedule |

All messages sent via OutboundQueueService (BullMQ, 3 retries, rate-limited).

---

## i18n

All UI strings are translated in 4 languages (es/en/pt/fr) via next-intl.
Namespace: `appointments.*`

Key sections:
- `status.*` — Pending, Confirmed, Cancelled, Completed, No Show
- `servicesSection.*` — Service management labels
- `configSection.*` — Configuration labels
- `errors.*` — Error messages for all operations
- `toasts.*` — Success messages
- `recurrence*` — Recurring appointment labels
- `businessHoursPage.days.*` / `daysShort.*` — Day names (full and abbreviated)

Date formatting uses `useLocale()` → dynamic `dateLocale` mapping:
- es → es-MX, en → en-US, pt → pt-BR, fr → fr-FR
