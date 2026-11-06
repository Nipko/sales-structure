---
id: configuracion-gobierno
title: "Business settings, policies, and governance"
routes: ["/admin/settings/business-info", "/admin/settings/localization", "/admin/settings/fiscal", "/admin/settings/business-hours", "/admin/settings/policies", "/admin/settings/alerts", "/admin/compliance", "/admin/settings/media", "/admin/settings/prechat", "/admin/settings/email-templates", "/admin/settings/macros", "/admin/settings/recall", "/admin/settings/public-booking"]
roles: ["tenant_admin", "tenant_supervisor"]
keywords: ["settings", "company", "business information", "language", "timezone", "tax", "hours", "policies", "alerts", "compliance", "media", "prechat", "emails", "macros", "memory", "booking", "recall", "re-engagement"]
---

# Business settings, policies, and governance

**Settings** contains data that affects several areas. Administrators control identity, localization, tax details, policies, and sensitive features. Supervisors can operate screens enabled for their role, such as alerts or media, but must not assume administrator permissions.

- **Account and company**: profile, business information, language, time zone, tax details, and hours.
- **CRM and conversations**: attributes, pipeline, pre-chat forms, macros, memory, and email templates.
- **Governance and alerts**: policies the agent may consult, compliance, notifications, and alert rules.
- **Public experience**: media library and public booking page configuration.

The screen is authoritative: if an action is absent, your role or account configuration may not enable it. Before saving, check which channels, agents, or automations consume the setting. Changing time zone, hours, policies, or identity can affect replies and schedules; record the reason and test the agent before publishing sensitive changes.

## Automatic re-engagement (recall)

Only an administrator configures it, under **Settings → Auto recall** (the screen is titled **Automatic re-engagement**), and it appears when your plan includes the feature. It writes again to customers who have not come back: semi-annual dental cleanings, veterinary check-ups, or renewals.

- **Days of inactivity before re-engaging**: how long after the last completed appointment (for example 180 for a semi-annual cleaning).
- **Days to wait between re-engagements**: the minimum time before writing to the same person again.
- **Channel** and **Message**: the channel must be connected and active; the message supports the variables `{name}` and `{months}`.

The check runs every day at 9 AM (server time) and only writes to contacts who have a phone number, have not opted out, and whose last appointment **marked as completed** is older than the threshold; that is why you should complete appointments in **Appointments**. **Send now (test)** runs the same check immediately and sends real messages to the contacts who qualify. If you have several numbers on the same channel and Parallly cannot tell which one to send from, it does not send: it leaves you a task to choose the number.
