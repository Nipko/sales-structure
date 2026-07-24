---
id: canales-email-widget
title: "Email channel and website chat widget"
routes: ["/admin/channels", "/admin/channels/email", "/admin/settings/integrations/web-chat", "/admin/settings/integrations/web-chat/triggers"]
roles: ["tenant_admin"]
keywords: ["email", "email channel", "connect email", "smtp", "sendgrid", "gmail", "outlook", "widget", "web chat", "chat on my website", "chat on my site", "chat bubble", "embed code", "install widget", "triggers", "proactive triggers", "welcome message", "pre-chat form"]
---

Beyond WhatsApp and social media, your business can serve customers over **Email** (incoming emails land in your inbox like any other conversation) and through a **website chat widget** you install on your own site so visitors can talk to your AI assistant without leaving the page. Here's how to set up both.

> Only the **admin** role can connect the Email channel and configure the web chat widget.

## Availability by plan

| Plan | Email channel | Web chat widget | Proactive widget triggers |
|------|----------------|--------------------|--------------------------------|
| Emprendedor | Not included | Not included | — |
| Starter | Yes | Yes | Up to 3 |
| Pro | Yes | Yes | Up to 10 |
| Enterprise | Yes | Yes | Unlimited |
| Custom | Yes | Yes | Unlimited |

If your plan doesn't include one of them, you can upgrade under **Settings** → **Billing**.

---

## How to connect the Email channel

1. In the sidebar, go to **Channels** and click the **Email** card.
2. Under **Sender settings**, fill in:
   - **Sending email**: the address your emails will go out from (e.g. `ventas@tuempresa.com`).
   - **Sender name**: the name your customers will see (e.g. "Sales Team — MyCompany").
   - **Reply to**: an optional address where replies arrive, if you want it to differ from the sending address.
3. Choose the sending **Provider**:
   - **SMTP**: works with any email service (Gmail, Outlook, your hosting). Fill in **Host**, **Port**, **Username**, **Password** and **Encryption**. Recommended: TLS on port 587.
   - **SendGrid**: if your business handles a high volume of email, paste your **SendGrid API Key**.
4. Turn on the **Channel active** switch.
5. Click **Save settings**. Parallly sends a test email to confirm everything is working.

That's it: emails received at that address will show up as conversations in your inbox, alongside WhatsApp, Instagram and the rest of your channels.

> **If you use Gmail or Outlook with 2-step verification**: don't use your regular password. Create a 16-character "App password" from your email account's security settings and use it in the **Password** field.

### Receiving emails with SendGrid

If you chose SendGrid, the page shows an inbound address with a **Copy Webhook URL** button. Copy it and paste it in your SendGrid account (under Settings → Inbound Parse) so incoming emails reach your Parallly inbox. It's a one-time step.

### How email works in your inbox

- Each incoming email creates a new conversation, or joins an existing one if the contact is already on file.
- Your AI assistant can reply to emails just like it replies to WhatsApp or Instagram messages.
- Replies go out as a normal email from the address you configured.
- You'll see the subject, body and attachments of each email inside the conversation.

### Assigning an AI assistant to Email

Remember the general rule: **one AI assistant per connection**. In your assistant's editor (**AI Agent** section), link the Email connection so it answers incoming emails. If you'd rather have only your human team reply to emails, simply don't assign an assistant.

---

## How to install the chat widget on your website

1. In the sidebar, go to **Settings** → **Integrations** section → **Web chat**.
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

## How to create proactive triggers (so the chat says hello first)

Triggers make the widget activate on its own based on visitor behavior, without waiting for a click. Used well, they significantly increase the number of conversations started.

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
7. Click **Save**. The trigger becomes **Active** right away.

**Examples that work well:**

- Pricing page + 15 seconds → bubble: "Questions about our plans? I'll help you choose."
- Exit intent at checkout → open widget: "Wait! Can I help you complete your purchase?"
- 3rd visit → banner: "Welcome back — book a free demo."

> **Tip**: one or two well-placed triggers convert better than bombarding the visitor on every page. If you see the notice "You've reached your plan's trigger limit", deactivate one or upgrade your plan.

---

## Frequently asked questions

**Does the Email channel replace my regular email?**
No. Your mailbox keeps working as usual; Parallly connects to your email service to send replies and to bring incoming emails into your conversation inbox. Nothing is deleted from your email account.

**I saved the Email settings but no emails are reaching my inbox.**
Check that the **Channel active** switch is on and that the test email arrived. If you use Gmail/Outlook with 2-step verification, make sure you're using an app password. If you use SendGrid, confirm you pasted the inbound URL into your SendGrid account.

**Can I have the widget on several websites?**
You can create more than one widget with **Create widget**, and each one has its own embed code and its own customization.

**How do I remove the chat from my site?**
On the widget card, click **Delete** and confirm: visitors won't be able to chat anymore, even if the code is still on your page. If you'd rather keep the widget and its settings, ask whoever manages your site to remove the code from the page.

**What happens to widget chats when my business is closed?**
Your AI assistant replies 24/7. If the visitor asks to talk to a person outside working hours, your **Business hours** and the after-hours message you configured apply.

**Do I need to know how to code to install the widget?**
No. You just copy the code with **Copy code** and paste it into your site (or send it to whoever manages it). It's a one-time step.

Still have questions? Write to us at https://parallly-chat.cloud/support
