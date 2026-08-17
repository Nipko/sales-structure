---
id: integraciones-desarrolladores
title: "Integrations, API, webhooks, and web chat"
routes: ["/admin/settings/integrations", "/admin/settings/integrations/crm", "/admin/settings/integrations/ecommerce", "/admin/settings/integrations/mcp", "/admin/settings/integrations/payments", "/admin/settings/integrations/reviews", "/admin/settings/integrations/slack", "/admin/settings/integrations/vertical", "/admin/settings/integrations/webhooks", "/admin/settings/api-keys", "/admin/settings/integrations/web-chat", "/admin/settings/integrations/web-chat/triggers"]
roles: ["tenant_admin"]
keywords: ["integrations", "api", "api key", "webhook", "mcp", "crm", "ecommerce", "payments", "reviews", "slack", "web chat", "widget", "developers", "credentials"]
---

# Integrations, API, webhooks, and web chat

An administrator manages external connections under **Settings → Channels & Integrations**. This includes CRM, ecommerce, payments, reviews, Slack, vertical services, MCP servers, and web chat configuration.

For custom integrations, use **API Keys** and **Webhooks**. Treat keys and secrets like passwords: copy them only to the system that needs them, rotate exposed credentials, and verify every webhook signature. Before enabling an integration in production, test its event with non-sensitive data and confirm which actions it can perform.

Under **Integrations → Payments**, the business can connect its own Wompi or compatible payment provider account to charge customers. Funds go directly to that account and these credentials never pay the Parallly subscription. Select one active provider, copy the events URL shown on screen, and enable **Customer payments** on the agent. The agent uses the order amount stored in Parallly and only confirms “paid” after the backend validates the provider event and canonical transaction; a link, redirect, or screenshot is not proof of payment. New links depend on the current plan feature, while previously issued payments continue to reconcile after a downgrade.

Connector availability depends on account configuration. The integration screen and **Plan & Billing** are the current source of truth; avoid relying on limits or prices copied into external documents.
