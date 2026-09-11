---
id: canales-whatsapp
title: "Connect WhatsApp"
routes: ["/admin/channels", "/admin/channels/whatsapp", "/admin/channels/whatsapp/templates"]
roles: ["tenant_admin"]
keywords: ["whatsapp", "connect whatsapp", "whatsapp number", "whatsapp business", "coexistence", "whatsapp app", "migrate number", "templates", "whatsapp template", "sync chats", "chat history", "qr code", "verification", "meta", "facebook", "disconnect whatsapp", "24 hour window", "multiple accounts", "second number", "needs reauthorisation", "popup blocked", "connection with warnings", "business not verified", "meta charges", "whatsapp cost", "payment method", "card on meta", "service messages", "free service messages", "spend ceiling", "sending paused", "stopped replying", "1 october", "meta invoice", "who charges"]
---

# Connect WhatsApp

WhatsApp is Parallly's main channel: once connected, your AI agent starts receiving and answering your customers' messages on that number, using your catalog, your calendar, and your business information. The connection is official, through Meta (the company that owns WhatsApp), and takes between 5 and 20 minutes depending on the method you choose.

## Before you start

- You need to be an **administrator** of your Parallly account; channel administration is not available to supervisors or agents.
- You need a Facebook account with access to the business in Meta Business Suite.
- Have the phone number you'll use at hand: it must be able to receive SMS or calls (virtual VoIP numbers and premium lines won't work).
- The **Channels** screen shows whether WhatsApp is enabled for your account.

## How to connect your number

1. In the sidebar, under **Administration**, go to **Channels**.
2. On the **WhatsApp** card, click **Connect**.
3. Before the routes appear you get **"Before you connect WhatsApp"**: a short list with the number, access to its verification code, and the Facebook account. Tick the three items and click **Continue**; until you do, the button reads **Confirm the items to continue**. It is a reminder, not a validation: nothing about your data is checked there. The same step appears in the **Meet your agent** wizard and on the **WhatsApp** screen.
4. You'll see the **"Choose your connection method"** screen with three routes:
   - **WhatsApp Business App** (tagged **Coexistence**, marked **Recommended**, ~20 min) — if you already use the WhatsApp Business app on your phone and want to keep it along with your chats. This is the route we suggest; see the next section.
   - **New number** (~5 min) — for a number that has never been used on WhatsApp. This is the fastest path when you are starting a new line.
   - **Migrate from another provider** (~15 min) — if you already use WhatsApp with another platform (Wati, 360dialog, Twilio, etc.) and want to bring your number over with zero downtime.
5. Pick your method and click **Connect with Facebook**. A Meta window opens.
6. Log in with your Facebook account and select (or create) your Meta Business portfolio.
7. Select or add your WhatsApp Business account and phone number.
8. Verify the number with a **code sent by SMS or voice call** and approve the permissions.
9. You'll see the progress on screen: **Authorization → Connecting number → Activating WhatsApp**. When it finishes, "Connection successful!" appears and your agent is already answering on that number.

> Tip: as soon as you connect, the screen shows the **"Test your agent"** card with your number. Send it a WhatsApp message from another phone and watch it reply.

### If the Meta window does not appear

Authorization happens in a Meta pop-up window. If nothing opens when you click, or the
button stays waiting, it is almost always the browser blocking pop-ups:

1. Allow pop-ups for `admin.parallly-chat.cloud` from the blocking icon in the address
   bar.
2. Click **Connect with Facebook** again.
3. Do not close the Meta window until you see the finished-connection message. If you
   closed it halfway, start again from **Channels**.

This step works best on a computer: on a phone the Meta window opens as another tab and is
easy to lose track of.

### Connection finished with warnings

Sometimes the connection completes but something is still pending on Meta's side. The
screen then does not show a clean success: an **amber card** lists the warnings. The most
common ones:

- **Business not verified on Meta** — the number stays connected, with lower sending
  limits, until you complete business verification in Meta Business Suite.
- **Webhook subscription failed** — Parallly was not subscribed to that number's incoming
  messages, so the agent may receive nothing. Retry the connection and, if it happens
  again, contact support.
- **Number registration still pending** — Meta finished registering the number later than
  the rest of the connection. It usually resolves itself within minutes; come back to the
  screen and confirm the number went active.
- **We could not fetch your templates** — template synchronisation failed. The connection
  still works; sync them again from **Templates** whenever you want.

Read the warning before you consider setup finished: the amber card means "connected, but
check this", not "all set".

## Coexistence mode: keep your WhatsApp Business app

If you currently serve your customers from the WhatsApp Business app on your phone, you don't have to give it up. With the **WhatsApp Business App** method (Coexistence), your number gets connected to Parallly **and** keeps working on your phone at the same time: the AI replies from the platform and you can keep chatting from the app whenever you want.

Steps specific to this method:

1. Log in with your Facebook account and select your Meta Business portfolio.
2. **Scan the QR code from your WhatsApp Business app** (just like linking WhatsApp Web).
3. **Authorize the sync of history and contacts**. Important: you have **24 hours** to authorize it after connecting; if the window passes, you'll need to repeat the connection from scratch.

Requirements: an up-to-date WhatsApp Business app (version 2.24.17 or higher), a number with at least 7 days of activity on the app, and a stable WiFi connection (syncing may take several hours).

**What syncs with Parallly:**

- Individual chats from the last **6 months** (text)
- Images, videos, and audio from the last 14 days
- Your contacts saved in the app
- New messages you send from the app, in real time

**What does NOT sync:** group chats, disappearing or "view once" messages, media files older than 14 days, and the app's product catalog.

**Coexistence mode limitations:**

- You must **open the WhatsApp Business app at least every 14 days** to keep the connection active.
- Linked devices (WhatsApp Web/Desktop) get disconnected on activation; you can reconnect them afterward.
- The app's broadcast lists become read-only.
- Sending speed is somewhat lower (~20 messages per second), plenty for the vast majority of businesses.

## Channel statuses

In **Channels**, each card shows the connection status:

- **Connected** — the number is active and the agent is replying.
- **Connected** + **Reconnect: credentials expired** — the card shows both badges at once:
  the usual green one and, next to it, a red one. The connection exists, but the permission
  Parallly uses to send is expired, revoked, in error, or gone. The number can still
  receive messages and replies do not go out until you authorise again from **Connect**.
  **Agent health** reports it as an affected operational connection and treats it as a
  critical agent action.
- **Disconnected** — there's no connection yet, or it was disconnected.

When you open **WhatsApp** with a connected number, you'll see the **Active Channel** card with the **Number**, the **Verified name**, and the **Quality** (the rating Meta gives your number based on how customers receive your messages; keeping it "high" gets you better sending limits). You'll also find the **Business Profile** card with the **Manage profile** button to edit the information your customers see on WhatsApp.

## What Meta charges your WhatsApp account

From **1 October 2026**, Meta charges **your own WhatsApp Business account** for every **delivered service message**: replies from your agent and from your team inside the 24-hour window. What your customers send you stays free.

That charge is **not Parallly's**. To Meta, Parallly is a technology provider: it does not invoice you for those messages, does not pay Meta on your behalf and does not include them in your subscription. They are two separate payments and neither replaces the other:

- **Your Parallly subscription** — the software. Managed in **Administration → Plan & Billing**.
- **The messages WhatsApp delivers** — paid by your business to Meta, with the payment method on **your** WhatsApp Business account.

Changing your Parallly plan does not change what Meta charges.

### The payment method goes on Meta, not on Parallly

You add it from Meta's own tools (WhatsApp Manager → account settings → **Billing & payments**), with a user who administers that WhatsApp Business account. If your Meta portfolio already has a payment method on file — for ads, for instance — you can select it for this account without entering it again.

**Parallly never asks for a card number in chat**: not the agent, not Parallly Assist, not support. If someone asks for it inside a conversation, it is not us.

### With no payment method, the number stops delivering

It does not degrade: from 1 October 2026 a WhatsApp Business account with no payment method **stops delivering service messages**, even if you have spent nothing that month. From the outside it looks like an agent that stopped answering.

What keeps working: incoming messages are still received, stored and shown in the **Inbox**. The conversation is not lost; the reply is what does not go out.

### How to check whether your number is ready

1. Open **Channels → WhatsApp** and look at the **WhatsApp charges (Meta)** card: it shows whether any number has had sending paused.
2. Confirm in Meta's tools that **that** WhatsApp Business account has a payment method, a currency and a time zone set. All three are required: with one missing, the charge cannot be made.
3. **A card on file does not guarantee the charge will be approved.** Meta can say a payment method exists and the bank still decline it: expired card, international purchases not enabled, no available limit, incomplete tax details. "On file" only means that this is not the missing piece.

### The 1,000 free service messages

Every **number** gets **1,000 free service messages per calendar month**. Meta charges from the 1,001st onwards.

What the allowance is **not**:

- **Not per country.** A number answering nine countries has one thousand free in total, not one thousand per country.
- **Not per contact or per conversation.** It counts delivered messages, not people.
- **Not for templates.** Marketing, utility and authentication templates are charged separately and do not consume the allowance.
- **Not cumulative.** What you do not use this month does not carry over.
- **Not per account or per plan.** It is per number: with two numbers connected, each brings its own allowance.

The month closes in the **time zone of your WhatsApp Business account**, which may not be yours. If Parallly shows a 30-day window and Meta shows a calendar month, they are measuring different periods.

### What you see in Parallly, and what you do not

In **Channels → WhatsApp**, the **WhatsApp charges (Meta)** card shows how much of the free allowance is gone, the period's spend kept separate per currency, where it went and which numbers are paused. The **admin** and the **supervisor** can read it; resuming a number is the admin's alone.

It measures **what Parallly sent** over that connection. It is not a copy of Meta's invoice — Meta issues that, and you read it in Meta's tools.

### What a spend ceiling can and cannot promise

A spend ceiling bounds **what Parallly sends** over that connection during the period. Today the meter **records**: it counts, it warns, and by default it **stops no message**. There is no screen for setting a ceiling; containment is enabled account by account, after looking at what the meter recorded.

And even when active, there are three things a ceiling **cannot** promise:

- **It does not limit what another tool charges to the same account.** If another system — or your team from the WhatsApp Business app — sends through that same WhatsApp Business account, that usage lands on the same Meta invoice, and Parallly neither sees it nor can stop it.
- **It is not a limit Meta enforces.** Meta does not know about your ceiling: it keeps delivering and charging whatever reaches it, from wherever.
- **It does not lower the rate.** It cuts volume, not the price per message.

### If a number has sending paused

When Meta answers that the account **cannot be billed**, Parallly pauses chargeable sends **for that number** — only that one, not the rest — and does not retry: every attempt would be identical and fail the same way until somebody acts on Meta's side.

1. In **Channels → WhatsApp** you will see **Sending paused**, with the reason and since when.
2. Fix the payment method in Meta's tools.
3. Come back to Parallly and press **Resume sending** (admin only). It is your statement that you fixed it, not a verification: if Meta refuses the charge again, the number pauses itself on the next attempt and the reason appears there again.

While the pause lasts, incoming messages keep being received.

## WhatsApp templates

WhatsApp lets you reply freely during the **24 hours** after the customer's last message. To write to them **outside** that window — for example, an appointment reminder or a campaign — you need a **template approved by Meta**.

To manage them: **Channels → WhatsApp → View all templates** (the **WhatsApp Templates** page).

- **Sync from Meta** — brings into Parallly the templates you already have approved in your account.
- **Create template** — build a new one without leaving Parallly: name, language, category, body with variables (for example `{{1}}` for the customer's name), header, footer, and up to 3 buttons, with a live preview. When done, click **Send to Meta**; Meta determines the review status and timing.
- Each template shows its status: **Approved**, **Pending**, or **Rejected** (with the rejection reason so you can fix it and resubmit).
- When you connect WhatsApp, Parallly automatically submits **4 seed templates** already validated (appointment reminder, attendance confirmation, order confirmation, and payment received) so you have something to start with.

## More than one WhatsApp number?

You can connect several numbers when your account has capacity. The WhatsApp card shows current usage and the **Add another** button while room remains. Check the current limit in **Plan & Billing**.

Each connection is independent: it has its own AI agent (you assign it in the agent editor), and its conversations never mix. A campaign draft can record the intended sender number, but do not launch real campaigns from the current editor: exact template/sender binding and cancellation are not yet certified end to end. If you need more numbers than your account's current configuration allows, write to us at [support](https://parallly-chat.cloud/support).

## How to disconnect a number

1. Go to **Channels**, open **WhatsApp**, and pick the connection you want to remove.
2. Click **Disconnect** and confirm. If you have several numbers, the rest stay active.
3. The result is shown with a color:
   - **Green** — fully disconnected.
   - **Yellow** — disconnected in Parallly, but it's worth double-checking in Meta Business Suite that the integration was closed there too.
   - **Red** — there was a network error; try again.

## Frequently asked questions

**Can I keep using WhatsApp Business on my phone?**
Yes, with **Coexistence** mode: the AI replies from Parallly and you keep the app. Just remember to open it at least every 14 days.

**Do I lose my previous chats when connecting?**
No, if you connect via coexistence: up to 6 months of text chats and your contacts get synced. If you migrate from another provider, that provider's history is not transferred.

**Do I need templates for the agent to reply?**
No. The agent replies freely within the 24-hour window after the customer's last message. Templates are only needed when you start the conversation outside that window.

**Why was my template rejected?**
Meta reviews the content. On the templates page you'll see the **rejection reason**; fix the text (avoid aggressive promotional language in utility templates) and submit it again.

**Who can connect or disconnect WhatsApp?**
Only the account **administrator**. Supervisors and agents can see the status but not change it.

**Can I have a different agent on each number?**
Yes. The rule is one AI agent per connection: for example, a sales agent on one number and a support agent on another. You assign it in the agent editor.

**Does Parallly charge me for WhatsApp messages?**
No. From 1 October 2026 Meta charges your WhatsApp Business account for every delivered service message, with the payment method you added on Meta. Your Parallly subscription is a separate payment and does not change because of this.

**Do I give my card to Parallly to pay for WhatsApp?**
No, and nobody from Parallly will ask for it in chat. The WhatsApp payment method goes on Meta's tools, against your own WhatsApp Business account.

**Are the 1,000 free messages per account or per number?**
Per number and per calendar month, with no carry-over. Not per country, not per contact, and not for templates.

**Are Instagram and Messenger charged per message too?**
Not today. The per-service-message charge starting on 1 October 2026 is WhatsApp's; Instagram, Messenger and Telegram have no per-service-message charge from their provider.

Still have questions? Write to us at [support](https://parallly-chat.cloud/support).
