---
id: broadcast
title: "Campaigns and broadcasts"
routes: ["/admin/broadcast", "/admin/channels/whatsapp/templates", "/admin/contacts/segments"]
roles: ["tenant_admin", "tenant_supervisor"]
keywords: ["campaign", "campaigns", "broadcast", "broadcasts", "bulk send", "bulk messages", "mass whatsapp", "template", "whatsapp templates", "message template", "segment", "recipients", "audience", "schedule send", "promotions", "marketing", "delivered", "read", "a/b test", "sender number"]
---

# Campaigns and broadcasts

A **campaign** (or broadcast) is a message you send all at once to many of your contacts: a promotion, an announcement, a general reminder. It goes out over **WhatsApp** and/or **Email**, to all your contacts or to a specific segment.

You'll find campaigns in the sidebar, under **Growth → Campaigns**. They can be created by users with the **admin** or **supervisor** role (agents cannot).

## Before you start

- **WhatsApp uses templates approved by Meta.** To message a customer who hasn't written to you in the last 24 hours, WhatsApp requires the message to be a template that Meta has reviewed and approved. Check your templates under **Channels → WhatsApp** (you'll see the template summary and the **View all templates** button).
- **Prepare your audience.** You can send to **All contacts** or to a **Segment** (a saved group of contacts defined by filters, for example "VIP customers"). Segments are created under **CRM → Segments**.
- **Check your plan.** The Emprendedor plan doesn't include campaigns, and Starter allows up to 3 per month (see the limits table below).

## How to create and send a campaign

1. Go to **Growth → Campaigns** and click **New campaign**.
2. Enter the **Campaign name** (for example, "Summer Promo 2026"). It's for internal use only.
3. Under **Sending channels**, choose **WhatsApp**, **Email**, or both.
4. Write the content for each channel:
   - **WhatsApp template**: write the message text. Use `{{name}}` to automatically insert each contact's name. Remember it must match a Meta-approved template if you're contacting customers outside the 24-hour window.
   - **Email content**: the subject and body of the email.
5. If you have **more than one WhatsApp number connected**, the **Send from number** selector appears: choose which number the campaign goes out from, or leave it on **Primary number (default)**.
6. Under **Audience**, choose **All contacts** or **Segment** (and pick which one; you'll see how many contacts it includes).
7. Under **Send date (optional)**:
   - If you choose a date and time, the button will say **Schedule** and the campaign will go out on its own at that moment.
   - If you leave it empty, the button will say **Save draft** and the campaign is saved without being sent.
8. To send a draft right away, open it from the list and use **Send now**.

> Tip: bulk sends go out at a controlled pace to protect your WhatsApp number. If the campaign is large, it's normal for it to take several minutes to complete.

## Campaign statuses

Each campaign shows its status in the list: **Draft** (saved, not scheduled), **Scheduled**, **Sending**, **Sent**, **Completed**, or **Failed**.

## Metrics: how to read the results

At the top of **Campaigns** you'll see the totals: **Campaigns**, **Sent**, **Scheduled**, and **Replies**. In addition, each campaign shows its funnel:

- **Recipients** — how many contacts it targeted.
- **Delivered** — how many messages reached the customer's phone or inbox.
- **Read** — how many opened it (WhatsApp reports reads when the customer has that turned on).
- **Replied** — how many answered the message.

If you also want to know how many **sales** each campaign generated, check **Revenue by campaign** in the attribution section of Analytics.

## A/B testing (Pro plan and above)

With the **Test two variants (A/B)** toggle when creating the campaign, you can send two versions of the message and find out which one works better:

1. Turn on **Test two variants (A/B)** and write **Variant A** and **Variant B**.
2. Adjust the **Send split** (what percentage of the audience receives each variant).
3. Optional: turn on **Auto-select** so the system detects the winning variant and automatically uses it with the rest of the audience.
4. After the send, the campaign shows results per variant (sent, delivered, read rate) and you can use **Select winner**.

> Tip: change a single element between variants (the text, the offer, or the call to action). That way you'll know exactly what made the difference.

## WhatsApp templates: creating and getting them approved

Path: **Channels → WhatsApp → View all templates**.

- **Create template**: give it a name (lowercase and underscores, e.g. `payment_reminder`), choose the language and category, and write the header, body (with variables like `{{1}}`), footer, and up to 3 buttons. When you're done, **Send to Meta**.
- Meta usually reviews it in anywhere from minutes to 72 hours. The statuses are **Approved**, **Pending**, and **Rejected** (with the rejection reason visible).
- **Sync from Meta** brings in the templates you already have approved in your account.
- When you connect WhatsApp, Parallly automatically submits 3 useful **seed templates** (appointment reminder, order confirmation, and payment received) that Meta usually approves within minutes.
- If you have several numbers, when you create the template you choose the **Number / account** it belongs to.

## Limits by plan

| Plan | Campaigns per month | A/B testing | Segments | Contacts |
|------|---------------------|-------------|----------|----------|
| Emprendedor | Not included | — | — | 100 |
| Starter | 3 | No | 3 | 500 |
| Pro | Unlimited | Yes | 15 | 5,000 |
| Enterprise | Unlimited | Yes | Unlimited | 50,000 |
| Custom | Unlimited | Yes | Unlimited | Unlimited |

Other related limits: the **Email** channel is available from the Starter plan onward, and the number of **WhatsApp numbers** you can connect depends on your plan (Pro: 2, Enterprise: 3, Custom: no limit). You can upgrade your plan under **Settings → Billing**.

## What about SMS?

SMS in Parallly **is not a conversation channel**: it's a one-way notification that runs on **credits** (1 credit = 1 SMS segment) and goes out over the platform's infrastructure, without you needing to sign up for anything separately. Buying packages and your balance are managed under **Settings → Billing**. If the SMS option doesn't appear when you create your campaign, it's because it isn't enabled for your account yet.

## Frequently asked questions

**Why don't I see the Campaigns section?**
Your role must be admin or supervisor, and your plan must include campaigns (the Emprendedor plan doesn't).

**Can I cancel a scheduled campaign?**
While it's in the **Scheduled** status, you can manage it from the list before the send time. Once it's in the **Sending** status, the messages are already going out.

**Why doesn't my WhatsApp campaign reach some contacts?**
The most common causes: the template isn't **Approved** by Meta, the contact opted out (they no longer receive broadcasts), or the number no longer exists. Check the template status under **Channels → WhatsApp**.

**Can I personalize the message with each customer's name?**
Yes: write `{{name}}` in the text and each contact will receive their own name.

**How long does Meta take to approve a template?**
Usually anywhere from a few minutes to 72 hours. You'll see the status (Pending/Approved/Rejected) in the templates list.

**Does the AI reply to the campaign?**
If a customer answers your WhatsApp campaign, the reply comes in as a normal conversation and is handled by the AI agent for that connection.

Need more help? Write to us at https://parallly-chat.cloud/support
