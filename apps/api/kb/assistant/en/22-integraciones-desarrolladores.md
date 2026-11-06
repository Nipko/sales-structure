---
id: integraciones-desarrolladores
title: "Integrations, API, webhooks, and web chat"
routes: ["/admin/settings/integrations", "/admin/settings/integrations/crm", "/admin/settings/integrations/ecommerce", "/admin/settings/integrations/mcp", "/admin/settings/integrations/payments", "/admin/settings/integrations/reviews", "/admin/settings/integrations/slack", "/admin/settings/integrations/vertical", "/admin/settings/integrations/channel-manager", "/admin/settings/integrations/webhooks", "/admin/settings/api-keys", "/admin/settings/integrations/web-chat", "/admin/settings/integrations/web-chat/triggers"]
roles: ["tenant_admin"]
keywords: ["integrations", "api", "api key", "webhook", "mcp", "crm", "ecommerce", "payments", "reviews", "slack", "web chat", "widget", "developers", "credentials", "toast", "mindbody", "cliniko", "channel manager", "google business"]
---

# Integrations, API, webhooks, and web chat

An administrator manages external connections under **Settings → Channels & Integrations**. This includes CRM, ecommerce, payments, reviews, Slack, vertical services, MCP servers, and web chat configuration.

For custom integrations, use **API Keys** and **Webhooks**. Treat keys and secrets like passwords: copy them only to the system that needs them, rotate exposed credentials, and verify every webhook signature. Before enabling an integration in production, test its event with non-sensitive data and confirm which actions it can perform.

Under **Integrations → Payments**, the business can connect its own Wompi or compatible payment provider account to charge customers. Funds go directly to that account and these credentials never pay the Parallly subscription. Select one active provider, copy the events URL shown on screen, and enable **Customer payments** on the agent. The agent uses the order amount stored in Parallly and only confirms “paid” after the backend validates the provider event and canonical transaction; a link, redirect, or screenshot is not proof of payment. New links depend on the current plan feature, while previously issued payments continue to reconcile after a downgrade.

Connector availability depends on account configuration. The integration screen and **Plan & Billing** are the current source of truth; avoid relying on limits or prices copied into external documents.

## Vertical integrations (Toast, Mindbody, Cliniko)

Under **Settings → Channels & Integrations → Vertical integrations** you connect the system your industry already uses: **Toast** (restaurants: menu, items, and prices), **Mindbody** (fitness: classes and schedules), or **Cliniko** (healthcare: appointment types and availability, with no access to clinical records). The screen only shows the providers that apply to your business type.

These integrations are **read-only and in beta**: they bring data to the agent, but they do not write to the source system or confirm live availability when the provider does not offer it (Mindbody, for example, does not confirm spots or bookings). Fill in the credentials, press **Test** and, if the connection answers, **Sync**. Each card shows the status (for example **Working** or **Stale data**), when the last data arrived, and whether permissions are missing. **Resource mapping** links a Parallly location, calendar, or resource to its external ID; a mapping never enables writes on its own.

## Channel Manager (hotels and vacation rentals)

If your business is a hotel or a vacation rental, that screen also shows a link to **Channel Manager**, which connects Hostaway. You can **Test without syncing** before saving; then press **Sync now** and link each external listing to exactly one Parallly lodging. Hostaway remains the source of truth: the agent does not create bookings there yet, and an unmapped listing keeps its conversational bookings blocked and hands them to your team. Without a channel manager, you can sync Airbnb or Booking.com by iCal from each property (see **Tools and modules for your industry**).

## Google reviews

Under **Settings → Channels & Integrations → Reviews**, press **Connect Google Business**, authorize access, and save the location. **Sync** brings in your reviews (they also refresh on their own every few hours) and shows the average rating, the total, the ones still unreplied, and the negative ones. On each review, **AI suggest** drafts a reply in your account's language; review it, edit it if needed, and press **Post reply** to publish it on Google. If you turn on **AI auto-reply**, Parallly publishes a reply to every new unreplied review without human review, negative ones included: only turn it on if you accept that risk.

## External MCP servers

Connecting or discovering an external MCP server does not authorize its tools. An administrator reviews each tool and declares its effect (read, write, payment, notification, or irreversible) and whether it requires customer confirmation or human approval. A tool that has not been reviewed stays blocked for the agent.
