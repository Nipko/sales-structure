---
id: primeros-pasos
title: "Getting started and initial setup"
routes: ["/admin/setup-wizard", "/admin", "/admin/channels", "/admin/agent", "/admin/settings/billing"]
roles: ["tenant_admin"]
keywords: ["getting started", "start", "sign up", "create account", "onboarding", "initial setup", "setup wizard", "setup", "connect channel", "connect whatsapp", "test agent", "essentials", "checklist", "your progress", "8/9", "tour", "trial", "new user", "meet your agent", "connect later", "show me where", "email verification", "next step", "four essentials", "already answers", "immediate changes", "trial link", "trial page", "show it to my partner", "where does your number live", "question before connecting whatsapp", "right path from the start", "day 0", "first real customer", "trial countdown", "billing time zone", "payment method in meta", "where do your customers write to you", "recommended channel", "included from", "channel outside my plan", "confirm email for instagram", "pick up where you left off", "put it in my bio", "web chat in my plan", "change template"]
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

Parallly sends a **6-digit code** to confirm your email address. That verification **does not block** setup: you can confirm your agent, try it on its link, and connect **WhatsApp** before completing it. **Instagram**, **Messenger**, and **Telegram** do need it, and the wizard says so **before** any window opens: above those channels it shows "Before connecting Instagram, Messenger and Telegram, confirm your email" (naming only the ones your plan includes), with **Resend code** and **I have the code** to type it in. While it is pending you'll also see a dashboard notice with the option to resend the code; if it doesn't arrive, check your spam folder and confirm the address is spelled correctly.

## Meet your agent: the setup wizard

After signing up, the dashboard opens **Meet your agent**, a **three-step** wizard (also available at `/admin/setup-wizard`):

1. **Your agent** — you don't pick a template: Parallly already prepared an agent from the industry and business type you declared, with its name, role, greeting, and example rules. This step is to **confirm or adjust it** (name and welcome message) and try it in the chat next to it. What you save is applied immediately. During your day 0 (see below) the wizard adds no other guide on top of the step: there is no help panel and no link to change the template, and the connection step offers no **Show me where**. After your agent's first real reply they come back, and the secondary **Change template** button takes you to the full agent list.
2. **Where do your customers write to you?** — the step orders the channels by your business type's recipe: the one that suits it best goes on top, with the reason (a beauty salon, for example, starts with Instagram; a clinic, with WhatsApp). If your industry brings no recommendation, WhatsApp goes first. A channel your plan does not include shows a lock and **Included from** followed by the name of the plan that brings it, **before** any window opens, next to **Go to Plan and billing**; if the channel recommended for your business is one of those, the step says so and suggests starting meanwhile with one your plan does include. WhatsApp starts with the question **Where does your WhatsApp number live today?** and the button that opens the Meta window (see the next section); Instagram opens the window to log in to Instagram and Messenger the Facebook one, and Telegram asks right there for the key @BotFather gives you. When you connect Instagram, Messenger, or Telegram, the step confirms it with its own notice ("Instagram connected") and tells you how to write to it to try it. When you connect WhatsApp, the screen checks two things before telling you your agent already answers: if the number has no **billing time zone**, it asks you to confirm one (your business's zone is already selected, so it is usually one tap), and it shows whether your WhatsApp account has a **payment method in Meta**. You can move on even if something is missing and finish it later in **Channels → WhatsApp**.
3. **Done** — it says your agent **already answers** on your channel only when that is true, and names the channels you connected; then message it from another phone to see for yourself. If WhatsApp is connected but the billing time zone or the payment method is missing, it tells you what is left and offers **Finish in Channels → WhatsApp**. If you didn't connect any channel, it tells you your agent already answers through its link and that the channel the previous step led with (WhatsApp, Instagram…) is still pending. Below, **Load what your agent must know** and **Invite a person** show as done if you already did them and as pending if not; whatever Parallly could not check is left out. After that, the **Getting started** card on Home shows whichever essentials are still missing.

This step also shows the **your agent's link** card: a public page — its address starts with `/w/` followed by an identifier that is never your business name — where anyone can chat with your agent just like a customer would. It exists from day 0, before you connect any channel. What it is depends on your plan:

- **If your plan does not include web chat**, the link is for **trying your agent and showing it to someone**: the platform pays for its messages up to a per-account allowance, each page has a daily message cap, and the conversation never goes to a person. Its actions are **Open**, **Copy link**, and **Show it to my partner** (opens WhatsApp with a message already written); below, the card explains what a plan that includes web chat changes and offers **See plans**. It does not suggest putting it in your bio or on your website: your customers would hit the cap with nobody to serve them.
- **If your plan includes web chat**, that same link is a **real channel**: it serves your customers on your plan's quota, without the trial's daily cap, and can hand the conversation to your team when the customer asks for a person. The card then adds **Put it in my bio** (copies the link for Instagram → Edit profile → Links) and **Put it on my website** (takes you to the web chat screen, where your site's chat is created and its two lines are copied).

The change applies message by message: as soon as your plan includes web chat, the next message that arrives through the link is already served as a real channel, with nothing to reconnect. In **Administration → Channels** the link has its own row, labelled **Nothing to connect**, with the **Open** and **Copy link** buttons: it is never connected or disconnected, and for the **Getting started** card it does not count as a connected channel.

**Connect later** is a valid exit: it is recorded, the wizard lets you continue, and the **Getting started** card on Home reminds you on its channel step, with **Pick up where you left off** and the reason: "You left this for later." or, if you answered the WhatsApp question with **Another provider already uses it** or **I do not have it at hand right now**, what you noted. In those two cases **Pick up where you left off** takes you to **Channels → WhatsApp**, where your answer is; the answer is saved in your account, so you see it the same way from another phone or browser. There is no separate resume notice: the card is the only reminder. Pressing **Next** on the connection step without connecting counts the same: it is recorded as "connect later", never skipped silently. Nothing you already configured is lost.

You can reopen the wizard whenever you want from **Settings → Setup assistant**.

## How to connect your first channel

Without a connected channel, the business **receives no messages through that channel**. When you connect your first channel, your default agent gets assigned to it and starts answering there just as you tested it in the chat; there's no need to go back to the editor. Start with the channel your customers already write to you on: the wizard puts the one your industry's recipe recommends on top. If it is **WhatsApp**, the most widely used channel in Latin America, it starts with a single question — where does your number live today? — so you pick the right path from the start. Meanwhile, your agent already answers on your agent's link, though that page doesn't count as a connected channel.

Before connecting WhatsApp, have on hand:

- A **phone number**: your current WhatsApp Business number, or a new one that doesn't have WhatsApp.
- Access to that number's **verification code** (via SMS or call).
- A **Facebook account** to authorize the connection with Meta (you can create one during the process).

Helpful tips:

- If you connect your current WhatsApp Business number, you can scan a **QR code** from the app to keep your chats.
- If you can't connect yet, use **Connect later** and pick it up from the **Getting started** card on Home: the step stays pending, not lost.
- You can also connect **Instagram**, **Messenger**, **Telegram**, or **Web Chat** for your site, depending on what your plan includes: the ones it doesn't include show a lock and **Included from** before anything opens. Instagram, Messenger, and Telegram need your email confirmed; WhatsApp does not. Email does not currently have certified self-service configuration.

Later on, you can manage everything from **Channels**, in the **Administration** section of the sidebar.

## The product tour and "Show me where"

The wizard's last step offers **Take the dashboard tour**: it's the general **Home** tour, which highlights the agent, channels, conversations, analytics and, when applicable, the tool specific to your industry. It only opens if you ask for it and changes nothing.

Besides that general tour, when that screen or that step has a tour, the pending card, the screen's **Help** panel, and Parallly Assist show a **Show me where** (or **Show me how**) button: it opens the right screen and highlights, step by step, where the change is made. The tour **does not change** anything by itself; it only takes you to the exact place.

During your day 0, the wizard's connection step does not show **Show me where**: the step's question is already the guide, and a tour on top would be a second voice. It comes back after your agent's first real reply.

## The "Getting started" card

**Getting started** appears on **Home** while any of the **four essentials**
available for your plan and role is still missing, in this order:

- **connect a channel** (WhatsApp, Instagram, Messenger, Telegram, or Web Chat);
- **review your agent** (name, message for when it cannot answer, rules, and reasons to hand off to a person);
- **describe what your business does** in Business information;
- **invite a person** who receives the chats when the AI hands them over.

The step marked **Next** is the one worth doing now. Loading knowledge, confirming business
hours, setting up appointments, or the catalog improve the agent, but they are not required
for it to answer: they live in **Agent health**, not on this card. On Home, while the card is there,
it is the card that tells you what is missing: the global banner **Something important needs fixing in your agents.** does not show there.

Each item has **Continue**, which opens the screen where it is done and, when a tour covers that step, also **Show me where**, which highlights the exact field or button step by step. Some steps have no tour — your industry's own catalog, for example — and roles that cannot run tours see only **Continue**. Each pending step opens an allowed route. The card disappears when all steps are done
and does not turn into a floating `8/9` pill. If Parallly cannot verify a source, it
shows **Retry** instead of claiming the step is incomplete. Advanced tasks stay in
their own modules and do not inflate this essential progress.

If you left the channel for later, its step no longer says **Continue**: it says **Pick up where you left off**, with the reason you gave (see **Connect later** above).

## Your day 0: the dashboard doesn't interrupt you

Until your agent answers its **first real customer** — or until three days after you created the account, whichever comes first — the dashboard doesn't interrupt you: no trial countdown, no install-app notice, no automatic greeting from the help bubble ("Hi! I'm Parallly"), and no global **Agent health** banner saying **Something important needs fixing in your agents.** Finishing the setup wizard does not end this period; your agent's first reply on a connected channel or on your website's web chat does, even when you are the one writing to it from another phone. Your agent's link and **Test agent** don't count.

On **Home**, while day 0 lasts and the **Getting started** card has something pending, the card is the screen: the zeroed indicators, the help panel, **Agent health**, recent activity, AI usage, and the empty agenda are not shown.

What always shows is a real delivery failure. If a channel you connected cannot answer — the connection stopped working, your agent has no channel assigned, no agent handles that channel, or WhatsApp cannot deliver the replies — the global banner appears anyway and names the reason; on Home, the channel step of the **Getting started** card tells you. A restriction on your account, such as an expired plan or read-only mode, also always shows.

## What to do first: recommended order

1. **Confirm your agent** in the wizard and test it in the test chat.
2. **Connect the channel your customers write to you on** (the wizard puts the one your industry recommends on top). From that moment the agent is assigned and answers there; on WhatsApp, confirm the billing time zone if the screen asks for it.
3. **Send a message from another phone** and confirm both the reply and conversation in **Conversations**.
4. **Complete the business information and knowledge**: website, documents, policies, FAQs, and the relevant catalog. Also confirm the example prices of your services under **Appointments** → **Services** so the agent can state them.
5. **Adjust the agent whenever you want**: tone, rules, greeting, tools, and channel assignment. Saving applies the change immediately; test it in the test chat.
6. **Invite your team** from **Users** and assign roles: administrator, supervisor, or agent.

## Frequently asked questions

**Do I need a card to try Parallly?**
It depends on the option available to your account. Registration and **Plan & Billing** show whether a payment method is required and when a charge would begin.

**How much do the plans cost?**
Open **Administration → Plan & Billing** for current prices, currency, billing cycle, and terms.

**Which channels does my plan include?**
**Channels** shows which connections you can activate; **Plan & Billing** shows the availability and limits for your account. In the wizard, a channel your plan does not include shows **Included from** and the name of the plan that brings it, before any window opens.

**Can I have multiple AI agents?**
Yes, when your account has capacity available. Each connection uses its own agent; check the current allowance in **Plan & Billing**.

**What about the SMS channel?**
SMS is not a conversation channel: it's used to send notifications to your customers using credits (1 credit = 1 message segment).

**What is "your agent's link"?**
It's a public page that exists from day 0, before you connect any channel, where anyone can chat with your agent just like a customer would. If your plan does not include web chat, it is for trying the agent and showing it to someone: the platform pays for its messages up to a per-account allowance, each page has a daily message cap, and the conversation doesn't go to a person. When the day's cap is reached, the chat itself says so and continues the next day; if the allowance runs out, the chat says it works again once the business turns on web chat. With a plan that includes web chat, the same link is a real channel: no daily cap, your plan's quota, and handoff to your team. Either way it doesn't count as a connected channel: the **Getting started** card keeps asking for a real channel (WhatsApp, Instagram, Messenger, Telegram, or your site's web chat).

**I skipped the wizard — how do I get back to it?**
From **Settings → Setup assistant**, or directly at `/admin/setup-wizard`. You can also configure each piece separately from the **AI Agent** and **Channels** menus: the **Getting started** card on Home shows pending essentials and, when that step has a tour, its **Show me where** button.

**Do I have to verify my email before configuring the agent?**
No. Email verification does not block the wizard, your agent's link, or connecting WhatsApp; you can complete it whenever the code arrives. You do need it to connect Instagram, Messenger, or Telegram — the wizard tells you before any window opens — and to confirm your WhatsApp billing time zone.

**Why don't I see my trial countdown?**
Because your account is in its day 0: that notice, the install-app notice, and the Agent health global banner wait until your agent answers its first real customer, or until three days have passed since you created the account. Your trial terms are always in **Administration → Plan & Billing**.

**Can I use the dashboard in another language?**
Yes: Spanish, English, Portuguese, and French. Change the language from the selector at the top of the dashboard.

**Where do I ask for help?**
Write to us at [parallly-chat.cloud/support](https://parallly-chat.cloud/support), or ask the copilot inside the dashboard.
