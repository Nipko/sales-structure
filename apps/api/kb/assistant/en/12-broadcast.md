---
id: broadcast
title: "Campaigns and broadcasts"
routes: ["/admin/broadcast", "/admin/channels/whatsapp/templates", "/admin/contacts/segments"]
roles: ["tenant_admin", "tenant_supervisor"]
keywords: ["campaign", "campaigns", "broadcast", "broadcasts", "bulk send", "bulk messages", "mass whatsapp", "template", "whatsapp templates", "message template", "segment", "recipients", "audience", "schedule send", "promotions", "marketing", "delivered", "read", "a/b test", "sender number"]
---

# Campaigns and broadcasts

The **AI & growth → Campaigns** section brings together drafts, audiences, statuses, and metrics for bulk sends. Admins and supervisors can see it when the feature is enabled for the account.

## Availability in this release

The launch flow from the editor is **not certified end to end for production**:

- For WhatsApp, the current editor does not safely bind the entered body to the exact name and components of a Meta-approved template. A send may fail even when the text looks correct.
- A scheduled campaign has no operational cancel action before the automatic process picks it up.
- Campaign Email does not certify Email as a conversational channel or provide a self-service Email connection.

For now, use the screen to prepare drafts, review segments, and inspect already recorded results. **Do not select Send now or schedule a production campaign** until the panel provides a verified template/sender selector and a cancel action. Coordinate a controlled test with support before any real send.

## Preparing a safe draft

1. Go to **AI & growth → Campaigns** and create a campaign.
2. Give it an internal name.
3. Choose **All contacts** or a **Segment** created under **CRM → Segments**.
4. Review the recipient count and communication opt-outs.
5. Save the draft without a send date.

Do not put sensitive data in the internal name. Current availability, channels, and capacity are shown on the screen and under **Administration → Plan & Billing**.

## WhatsApp templates

Path: **Channels → WhatsApp → View all templates**.

- A template has a technical name, language, category, and components that must exactly match what Meta approved.
- **Sync from Meta** refreshes the statuses shown in Parallly.
- When WhatsApp is connected, Parallly may submit **4 seed templates**: appointment reminder, attendance confirmation, order confirmation, and payment received.
- Meta decides whether each template is approved or rejected and how long review takes; Parallly only displays the received status.

Having an approved template does not by itself fix the campaign-editor limitation described above.

## Statuses and metrics

The list may show drafts and previously processed campaigns with recipients, deliveries, reads, replies, or failures. These figures depend on events reported by each provider; delivery or read data is not always available.

A/B variant controls are present in the editor, but their send uses the same unverified launch flow. Use them only as draft configuration until the flow is certified.

## Frequently asked questions

**Can I cancel a scheduled campaign?**
There is no operational cancel action in the current release. That is why you should not schedule production campaigns from this editor.

**Can I type the WhatsApp template body directly and send it?**
Not safely in this release. WhatsApp requires the exact identifier and components of an approved template; the editor does not yet perform that binding end to end.

**How long does Meta take to approve a template?**
There is no guaranteed timeframe. Check the synchronized status under **Channels → WhatsApp**.

**Does campaign Email enable an Email channel?**
No. Self-service conversational Email is not currently certified.

**Need more help?** Write to us at https://parallly-chat.cloud/support
