---
id: primeros-pasos
title: "Getting started and initial setup"
routes: ["/admin/setup-wizard", "/admin", "/admin/channels", "/admin/agent", "/admin/settings/billing"]
roles: ["tenant_admin"]
keywords: ["getting started", "start", "sign up", "create account", "onboarding", "initial setup", "setup wizard", "setup", "connect channel", "connect whatsapp", "test agent", "essentials", "checklist", "your progress", "8/9", "tour", "trial", "new user", "meet your agent", "connect later", "show me where", "email verification"]
---

# Getting started and initial setup

Welcome to Parallly! This guide walks you from creating your account to your AI agent answering its first message.

## How to create your account

1. Go to [admin.parallly-chat.cloud](https://admin.parallly-chat.cloud) and click **Create your free account**.
2. Fill in your name, email, and password, or use **Continue with Google**.
3. Submitting the form takes you **straight into the 4-step welcome wizard**; there is no code to wait for at this point:
   - **Your company** — business name, industry, sub-type, and time zone (fields like website, phone, and description are optional, but they help your agent answer better).
   - **Your customers** — who you sell to. The options adapt to your industry.
   - **Goals** — what you want to achieve: answering FAQs, booking appointments, selling, providing support, and more.
   - **Plan** — review the current options and choose how to begin.
4. Click **Create my account**.

Trial terms, prices, and payment options appear during registration and under **Administration → Plan & Billing**. That screen is the current source of truth for your account and country.

When you finish, Parallly pre-configures your workspace based on your industry: a sales funnel with tailored stages, a suggested AI agent with a name and tone, base FAQs for your sector, and the tools specific to your line of business (menu, properties, tours, etc., as applicable).

## Verifying your email (when it applies)

Parallly sends a **6-digit code** to confirm your email address. That verification **does not block** setup: you can keep configuring and connect your channel before completing it. While it is pending you'll see a dashboard notice with the option to resend the code; if it doesn't arrive, check your spam folder and confirm the address is spelled correctly.

## Meet your agent: the setup wizard

After signing up, the dashboard opens **Meet your agent**, a **three-step** wizard (also available at `/admin/setup-wizard`):

1. **Your agent** — you don't pick a template: Parallly already prepared an agent from the industry and goals you declared, with its name, role, and greeting. This step is to **confirm or adjust it** (name and welcome message) and try it in the chat next to it. If you'd rather start from something else, the secondary **Change template** button takes you to the full agent list.
2. **Connect WhatsApp** — the requirements, the connection route, and the button that opens the Meta window (see the next section).
3. **Done** — what comes next, with **three of the essentials**: connect the channel, load what the agent must know, and add the person who receives the chats. The **Getting started** card on Home computes up to six steps from your plan, role, and industry, so it can show more than this fixed summary.

**Connect later** is a valid exit: it is recorded, the wizard lets you continue, and **Home reminds you** with the **Getting started** card and a resume notice. Nothing you already configured is lost.

You can reopen the wizard whenever you want from **Settings → Setup assistant**.

## How to connect your first channel

Without a connected channel, the business **receives no messages through that channel**. Connecting it does not publish the agent draft: you must then review its assignment, test the draft, and publish the approved version. We recommend starting with **WhatsApp**, the most widely used channel in Latin America.

Before connecting WhatsApp, have on hand:

- A **phone number**: your current WhatsApp Business number, or a new one that doesn't have WhatsApp.
- Access to that number's **verification code** (via SMS or call).
- A **Facebook account** to authorize the connection with Meta (you can create one during the process).

Helpful tips:

- If you connect your current WhatsApp Business number, you can scan a **QR code** from the app to keep your chats.
- If you can't connect yet, use **Connect later** and pick it up from the **Getting started** card on Home: the step stays pending, not lost.
- You can also connect **Instagram**, **Messenger**, **Telegram**, or **Web Chat** for your site, depending on what your plan includes. Email does not currently have certified self-service configuration.

Later on, you can manage everything from **Channels**, in the **Administration** section of the sidebar.

## The product tour and "Show me where"

When the wizard has an agent draft, the last step offers **Review and publish my agent**. That path does not publish by itself: it takes you through the editor, testing, candidate preparation and review, and ends at the publication confirmation. Connecting a channel and publishing the agent are independent states; the path asks you to check the assignment before confirming.

The general product tour remains available from **Home**. It highlights the agent, channels, conversations, analytics and, when applicable, the tool specific to your industry.

Besides that general tour, when that screen or that step has a tour, the pending card, the screen's **Help** panel, and Parallly Assist show a **Show me where** (or **Show me how**) button: it opens the right screen and highlights, step by step, where the change is made. The tour **does not change** anything by itself; it only takes you to the exact place.

## The "Getting started" card

**Getting started** appears on **Home** while you have essential steps that are both
pending and available for your plan, role, and industry:

- **connect WhatsApp** (or another certified channel available to your account);
- **review your agent** (name, message for when it cannot answer, rules, and reasons to hand off to a person);
- **describe what your business does** in Business information;
- **load what the agent must know**: FAQs, documents, or your industry's catalog;
- **invite a person** who receives the chats when the AI hands them over;
- **confirm your business hours**, if your industry works with a calendar.

Each item has **Continue**, which opens the screen where it is done and, when a tour covers that step, also **Show me where**, which highlights the exact field or button step by step. Some steps have no tour — your industry's own catalog, for example — and roles that cannot run tours see only **Continue**. Each pending step opens an allowed route. The card disappears when all steps are done
and does not turn into a floating `8/9` pill. If Parallly cannot verify a source, it
shows **Retry** instead of claiming the step is incomplete. Advanced tasks stay in
their own modules and do not inflate this essential progress.

## What to do first: recommended order

1. **Complete the business information and knowledge**: website, documents, policies, FAQs, and the relevant catalog.
2. **Connect WhatsApp** (or your main channel). Connecting it does not put a draft in front of customers.
3. **Adjust the agent draft**: tone, rules, greeting, tools, and channel assignment; test it in the internal chat.
4. **Prepare, review, and publish** the approved version. Publication makes the draft content and assignments operational.
5. **Send a message from your phone** and confirm both the reply and conversation in **Conversations**.
6. **Invite your team** from **Users** and assign roles: administrator, supervisor, or agent.

## Frequently asked questions

**Do I need a card to try Parallly?**
It depends on the option available to your account. Registration and **Plan & Billing** show whether a payment method is required and when a charge would begin.

**How much do the plans cost?**
Open **Administration → Plan & Billing** for current prices, currency, billing cycle, and terms.

**Which channels does my plan include?**
**Channels** shows which connections you can activate; **Plan & Billing** shows the availability and limits for your account.

**Can I have multiple AI agents?**
Yes, when your account has capacity available. Each connection uses its own agent; check the current allowance in **Plan & Billing**.

**What about the SMS channel?**
SMS is not a conversation channel: it's used to send notifications to your customers using credits (1 credit = 1 message segment).

**I skipped the wizard — how do I get back to it?**
From **Settings → Setup assistant**, or directly at `/admin/setup-wizard`. You can also configure each piece separately from the **AI Agent** and **Channels** menus: the **Getting started** card on Home shows pending essentials and, when that step has a tour, its **Show me where** button.

**Do I have to verify my email before configuring the agent?**
No. Email verification does not block the wizard or the channel connection; you can complete it whenever the code arrives.

**Can I use the dashboard in another language?**
Yes: Spanish, English, Portuguese, and French. Change the language from the selector at the top of the dashboard.

**Where do I ask for help?**
Write to us at [parallly-chat.cloud/support](https://parallly-chat.cloud/support), or ask the copilot inside the dashboard.
