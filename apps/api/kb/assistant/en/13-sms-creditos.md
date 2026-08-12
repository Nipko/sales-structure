---
id: sms-creditos
title: "SMS credits and SMS notifications"
routes: ["/admin/settings/billing", "/admin/broadcast"]
roles: ["tenant_admin", "tenant_supervisor"]
keywords: ["sms", "credits", "sms credits", "sms package", "buy credits", "sms balance", "top up", "text messages", "sms notifications", "segment", "sms campaigns", "sms reminders", "out of balance", "sms disabled", "text customers"]
---

# SMS credits and SMS notifications

SMS is an **outbound notification** feature, not a conversation channel for the AI agent. Availability, coverage, sender identity, and how credits are provisioned depend on the integration enabled for the account and country.

## Segments and usage

One credit represents one SMS segment. Plain text usually fits more characters than a message with certain symbols or emojis, and a long message can be split into several segments. The editor counter is authoritative before sending: review its estimate because text encoding can change the total.

## Balance or credit purchase

An administrator can open **Administration → Plan & Billing**. If the **SMS credits** section appears, it shows the balance, usage, and active options. When a purchase or top-up action exists, the page states the packages, price, currency, provider, terms, and confirmation; use only that secure flow.

If the section or button is absent, purchasing is not enabled for that account. Do not assume a provider, payment type, instant crediting, or expiration rule: the page and operation confirmation are the current source of truth.

## Preparing an SMS campaign draft

An administrator or supervisor can use **AI & Growth → Campaigns** when SMS appears as an option:

1. Create the campaign and select **SMS**.
2. Write the text and review the estimated segment count.
3. Choose an authorized audience and confirm that opt-outs are honored.
4. Review the summary and save the draft. Do not send or schedule it for production from the current editor: it shares the campaign flow that is not yet certified, and scheduled campaigns have no cancel action. See **Campaigns and broadcasts**.

Reminders and automations may also consume credits when the SMS action is enabled. Security codes that Parallly sends to users are not part of the business's campaigns.

## If SMS is disabled

- If SMS does not appear in **Campaigns**, the service is unavailable for that account, country, or configuration.
- If the balance is insufficient, sending is blocked; check the page before trying again.
- A supervisor can prepare or operate allowed campaigns, but only an administrator can access billing or an enabled purchase flow.
- If a confirmed operation is not reflected, refresh the page and contact support with the date and status, without sharing sensitive payment information.

The sender number or identity depends on the integration and may vary by country. Do not promise inbound SMS replies unless the page itself states that two-way messaging is enabled.
