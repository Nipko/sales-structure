---
id: citas-calendarios
title: "Appointments and calendars"
routes: ["/admin/appointments", "/admin/settings/public-booking"]
roles: ["tenant_admin", "tenant_supervisor", "tenant_agent"]
keywords: ["appointments", "scheduling", "calendar", "book", "booking", "reservations", "services", "availability", "working hours", "google calendar", "outlook", "reminders", "attendance confirmation", "reschedule", "cancel appointment", "blocked dates", "meeting link", "meet", "teams", "public booking", "booking page", "recurring appointment"]
---

# Appointments and calendars

Parallly comes with a full scheduling system: you define your services and hours once, and from then on your AI agent books appointments on its own inside the conversation, your team sees them on a shared calendar, and everything can sync with Google Calendar or Outlook.

It all lives in the sidebar, under **Appointments**. When you open it you'll see the **Appointments & Scheduling** page with five tabs: **Calendar** (week or day view), **Agenda** (appointment list), **Services**, **Settings**, and **Analytics**. Settings are for admins and supervisors; agents can view the calendar, create appointments, and handle them.

## How to create your services

Services are what your customers can book (a consultation, a haircut, an advisory session…).

1. Go to **Appointments** → **Services** tab.
2. Click **New service**.
3. Fill in the **Service name**, the **Duration** in minutes, and, if you want, the **Price**.
4. Under **Time between appointments (min)** you can leave a breather between one appointment and the next (for example, 10 minutes to get the space ready).
5. Choose the **Modality**: **In-person**, **Online**, or **Hybrid**.
   - If it's in-person, enter the **Address**.
   - If it's online or hybrid, you can leave the **Meeting link** empty: a Meet or Teams link is generated automatically for each appointment.
6. Save with **Create service**. You can activate or deactivate services whenever you like.

How many services you can create depends on your plan: Emprendedor 1, Starter 2, and Pro and up with no limit.

## How to set your availability

1. Go to **Appointments** → **Settings** tab → **Working hours** section.
2. Choose **Available 24/7** or **Custom schedule** and mark, day by day, the hours you're open.
3. Save the changes. Important: if you don't save your hours, the AI agent won't have any real availability to offer in conversations.

### Blocked dates (vacations, holidays)

In the same **Settings** tab, **Blocked dates** section:

1. Click **Block date**.
2. Pick the day and write the reason (for example, "Holiday").

The AI agent will never offer times on a blocked day, and they won't be available on the public booking page either.

## How to connect Google Calendar or Outlook

Connecting your calendar avoids scheduling conflicts: Parallly appointments show up in your personal calendar, so your whole team sees an up-to-date schedule.

1. Go to **Appointments** → **Settings** tab → **Connected calendars** section.
2. Click **Connect Google Calendar** or **Connect Outlook**.
3. Authorize access with your Google or Microsoft account.
4. Done: new appointments are also created in your external calendar automatically.

How many calendars you can connect depends on your plan:

| Plan | Connected calendars |
|------|---------------------|
| Emprendedor | 1 |
| Starter | 1 |
| Pro | 3 |
| Enterprise | 10 |
| Custom | No limit |

### With several calendars, which one gets each appointment?

You give each connected calendar a label: **General**, **Team member**, or **Service**. When an appointment is created, it's sent following this order:

1. The calendar assigned to the appointment's **service**.
2. If there isn't one, the calendar of the assigned **team member**.
3. If not that either, the business's **general** calendar.

### Disconnecting a calendar that has upcoming appointments

If you try to disconnect a calendar with pending appointments, the panel offers you two options: **Reassign appointments to another calendar** (you choose the destination, the appointments move, and only then does it disconnect) or **Cancel all appointments and disconnect**. That way no booking is left hanging without you deciding.

## Automatic meeting links

For services with **Online** or **Hybrid** modality, each appointment automatically generates its video-call link (Meet with Google Calendar, Teams with Outlook). The customer gets it in their confirmation, without you having to create the meeting by hand. If you'd rather use your own fixed link, paste it in the service's **Meeting link** field.

## Reminders and attendance confirmation

In **Appointments** → **Settings** → **Reminders & follow-up** section you can turn on:

- **Reminder 24 hours before** — sent one day before the appointment.
- **Reminder 2 hours before** — a final heads-up on the same day.
- **Attendance confirmation** — after the appointment, the customer is asked whether they showed up.
- **Auto-complete** — appointments are marked as completed 2 hours after their end time, with no manual work.

WhatsApp reminders use notification templates pre-approved by Meta, so they always arrive, even if the customer hasn't written in over 24 hours.

## The AI books on its own in the conversation

When a customer asks for an appointment over WhatsApp, Instagram, or any connected channel, the AI agent guides them step by step: first the service, then a date with real availability, then the time, and finally a confirmation. On that last step the system re-checks the slot, so two people can't end up with the same spot.

Once confirmed, everything happens on its own: the appointment lands on your **Calendar**, syncs with your Google Calendar or Outlook, the customer gets a confirmation email, the assigned team member is notified, and, if the service is online, the meeting link is included.

On WhatsApp you can also turn on **WhatsApp Flows (Beta)** from the **Settings** tab: instead of going question by question, the customer books in a single step with an interactive form. If anything fails, the agent falls back to the text flow automatically.

## Public booking page

Beyond chat, you can have a web page where your customers book on their own:

1. Go to **Settings** (sidebar) → **Public Booking**.
2. Turn on the **Enable public booking** toggle.
3. Copy your link with the **Copy** button (it looks like `parallly-chat.cloud/book/your-business`) or click **Show QR code** to print or share it.
4. Under **Customization** you can set the page's **Welcome message** and **Brand color**.

Share the link in your Instagram bio, your WhatsApp Business profile, your email signature, or your website. Appointments that come in through it show up on your calendar with the source "Public Booking", alongside those created by the AI Agent or by your team from the dashboard.

## Frequently asked questions

**What happens if two people want the same time slot?**
The system checks availability at the exact moment of confirmation and rejects the second attempt, offering another time. There are no double bookings.

**Can I reschedule or cancel an appointment?**
Yes. In the **Calendar** tab you can reschedule by dragging the appointment to another time, or open it to edit or cancel it, giving the reason.

**Can I create appointments that repeat?**
Yes. When you create an appointment from the dashboard, check **Repeat this appointment** and choose the frequency (every day, every week, every 2 weeks, or every month) and how many times. The full series is created at once.

**Do I need to connect a calendar to use scheduling?**
No, scheduling works on its own inside Parallly. Connecting Google Calendar or Outlook is optional, but highly recommended if your team also schedules things outside the platform.

**Who can change the scheduling settings?**
Admins and supervisors. Agents can view the calendar, create appointments, and serve customers, but not modify services, hours, or connected calendars.

Need more help? Write to us at https://parallly-chat.cloud/support
