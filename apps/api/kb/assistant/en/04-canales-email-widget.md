---
id: canales-email-widget
title: "Web chat and Email integration status"
routes: ["/admin/channels", "/admin/channels/email", "/admin/settings/integrations/web-chat", "/admin/settings/integrations/web-chat/triggers"]
roles: ["tenant_admin"]
keywords: ["email", "email channel status", "widget", "web chat", "chat on my website", "chat on my site", "chat bubble", "embed code", "install widget", "triggers", "proactive triggers", "welcome message", "pre-chat form"]
---

# Web chat and Email integration status

The **website chat widget** is an operational conversational surface that you install on your site so visitors can talk to your AI assistant without leaving the page.

> Only the **admin** role can configure the web chat widget.

## Availability

The screen shows whether web chat and proactive triggers are enabled and how much capacity remains. Check current details in **Plan & Billing**.

### Email status

Email exists as a technical adapter and internal inbound surface for managed integrations, but it is **not yet a certified conversational channel or available for self-service configuration**. The **Channels → Email** page currently lacks the API contract required to save per-tenant settings. Do not enter credentials or assume that this screen makes the channel operational.

If your organization needs an email integration, ask support for a technical assessment. Until the flow is implemented and certified end to end, Parallly Assist must not promise connection, sending, inbox delivery, or automatic AI replies over Email.

---

## How to install the chat widget on your website

1. Go to **Settings → Channels & Integrations → Web chat**.
2. Click **Create widget**. Your widget is created with the initial settings.
3. On the widget card you'll see the **Embed code**. Click the **Copy code** button.
4. Paste that code into your website, ideally just before the end of the page (if someone else manages your site, send them the code as is — they'll know where to put it). It works on any site: WordPress, Shopify, Wix, custom-built pages, etc.
5. Save the changes on your site and reload the page: the chat bubble will appear in the corner you chose.

Visitors who write through the widget show up as conversations in your inbox, and your AI assistant handles them automatically.

### How to customize the widget

On the same page, click your widget's **Configure** (gear) icon and adjust:

| Option | What it controls |
|--------|--------------|
| **Widget name** | Internal name to identify it (your visitors never see it) |
| **Assistant name** | The name the visitor sees in the chat window |
| **Primary color** | The color of the bubble and the chat header, so it matches your brand |
| **Position** | **Bottom right** or **Bottom left** of the screen |
| **Welcome message** | The first message the visitor sees when opening the chat |
| **Pre-chat form** | If enabled, the visitor leaves their details (name, contact info) before chatting |

When you're done, click **Save**. The changes apply on your site without touching the code again.

> The fields requested in the pre-chat form are defined under **Settings** → **Pre-chat form**. Asking for a phone number or email lets you recognize the visitor if they later write to you on WhatsApp or another channel.

---

## How to save trigger definitions (not yet executed publicly)

The screen lets you save trigger definitions based on visitor behavior. **In the current release, the public widget script does not yet evaluate or execute those definitions**, so do not rely on proactive opens, bubbles, or banners in production. Visitor-opened chat still works.

1. Go to **Settings** → **Web chat** and click the **Proactive triggers** button.
2. Click **New trigger** and give it a **Name** (e.g. "Help offer on pricing").
3. Under **Conditions**, click **Add condition** and choose when it fires:

| Condition | Fires when… |
|-----------|--------------------|
| **Time on page** | The visitor has spent X seconds on the page |
| **Scroll (%)** | They've scrolled past a certain percentage of the page |
| **Exit intent** | They move the cursor to close the tab |
| **Page URL** | They're on a specific page (e.g. `/precios`) |
| **Visit count** | They've visited your site N or more times |

4. If you add several conditions, choose the **Operator**: **All must match (AND)** or **At least one (OR)**.
5. Choose the **Action type**: **Open widget** (the chat opens by itself), **Show bubble** (a small message appears next to the icon) or **Show banner** (a strip with a message and a button).
6. Write the **Message** the visitor will see and, optionally, adjust the **Frequency (min)** (0 = shown only once per visit).
7. Click **Save**. The definition is stored, but it is not yet executed on the public site.

**Configuration examples the editor can prepare (not executed yet):**

- Pricing page + 15 seconds → bubble: "Questions about our plans? I'll help you choose."
- Exit intent at checkout → open widget: "Wait! Can I help you complete your purchase?"
- 3rd visit → banner: "Welcome back — book a free demo."

> Do not publish a strategy that depends on these triggers until the public loader marks them as available. The screen may show plan capacity while the browser executor is still pending.

---

## Frequently asked questions

**Can I have the widget on several websites?**
You can create more than one widget with **Create widget**, and each one has its own embed code and its own customization.

**How do I remove the chat from my site?**
On the widget card, click **Delete** and confirm: visitors won't be able to chat anymore, even if the code is still on your page. If you'd rather keep the widget and its settings, ask whoever manages your site to remove the code from the page.

**What happens to widget chats when my business is closed?**
Your AI assistant replies 24/7. If the visitor asks to talk to a person outside working hours, your **Business hours** and the after-hours message you configured apply.

**Do I need to know how to code to install the widget?**
No. You just copy the code with **Copy code** and paste it into your site (or send it to whoever manages it). It's a one-time step.

Still have questions? Write to us at https://parallly-chat.cloud/support
