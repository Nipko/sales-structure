---
id: canales-whatsapp
title: "Connect WhatsApp"
routes: ["/admin/channels", "/admin/channels/whatsapp", "/admin/channels/whatsapp/templates"]
roles: ["tenant_admin"]
keywords: ["whatsapp", "connect whatsapp", "whatsapp number", "whatsapp business", "coexistence", "whatsapp app", "migrate number", "templates", "whatsapp template", "sync chats", "chat history", "qr code", "verification", "meta", "facebook", "disconnect whatsapp", "24 hour window", "multiple accounts", "second number"]
---

# Connect WhatsApp

WhatsApp is Parallly's main channel: once connected, your AI agent starts receiving and answering your customers' messages on that number, using your catalog, your calendar, and your business information. The connection is official, through Meta (the company that owns WhatsApp), and takes between 5 and 20 minutes depending on the method you choose.

## Before you start

- You need to be an **administrator** of your Parallly account (supervisors and agents can view channels, but not connect them).
- You need a Facebook account with access to the business in Meta Business Suite.
- Have the phone number you'll use at hand: it must be able to receive SMS or calls (virtual VoIP numbers and premium lines won't work).
- WhatsApp is available on every plan, starting with Emprendedor.

## How to connect your number

1. In the sidebar, under the **Management** section, go to **Channels**.
2. On the **WhatsApp** card, click **Connect**.
3. You'll see the **"Choose your connection method"** screen with these options:
   - **Test number** — explore the platform with no commitment and connect your real number later.
   - **New number** (~5 min) — for a number that has never been used on WhatsApp. This is the fastest path.
   - **WhatsApp Business App** (tagged **Coexistence**, ~20 min) — if you already use the WhatsApp Business app on your phone and want to keep it. It's the most popular option; see the next section.
   - **Migrate from another provider** (~15 min) — if you already use WhatsApp with another platform (Wati, 360dialog, Twilio, etc.) and want to bring your number over with zero downtime.
4. Pick your method and click **Connect with Facebook**. A Meta window opens.
5. Log in with your Facebook account and select (or create) your Meta Business portfolio.
6. Select or add your WhatsApp Business account and phone number.
7. Verify the number with a **code sent by SMS or voice call** and approve the permissions.
8. You'll see the progress on screen: **Authorization → Connecting number → Activating WhatsApp**. When it finishes, "Connection successful!" appears and your agent is already answering on that number.

> Tip: as soon as you connect, the screen shows the **"Test your agent"** card with your number. Send it a WhatsApp message from another phone and watch it reply.

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
- **Disconnected** — there's no connection yet, or it was disconnected.

When you open **WhatsApp** with a connected number, you'll see the **Active Channel** card with the **Number**, the **Verified name**, and the **Quality** (the rating Meta gives your number based on how customers receive your messages; keeping it "high" gets you better sending limits). You'll also find the **Business Profile** card with the **Manage profile** button to edit the information your customers see on WhatsApp.

## WhatsApp templates

WhatsApp lets you reply freely during the **24 hours** after the customer's last message. To write to them **outside** that window — for example, an appointment reminder or a campaign — you need a **template approved by Meta**.

To manage them: **Channels → WhatsApp → View all templates** (the **WhatsApp Templates** page).

- **Sync from Meta** — brings into Parallly the templates you already have approved in your account.
- **Create template** — build a new one without leaving Parallly: name, language, category, body with variables (for example `{{1}}` for the customer's name), header, footer, and up to 3 buttons, with a live preview. When done, click **Send to Meta**; approval usually takes anywhere from minutes to 72 hours.
- Each template shows its status: **Approved**, **Pending**, or **Rejected** (with the rejection reason so you can fix it and resubmit).
- When you connect WhatsApp, Parallly automatically submits **3 seed templates** already validated (appointment reminder, order confirmation, and payment received) so you have something to start with.

## More than one WhatsApp number?

You can connect several numbers on the same channel depending on your plan. On the WhatsApp card you'll see the account counter (for example "1/2 accounts") and the **Add another** button while you still have room.

| Plan | WhatsApp numbers |
|------|:---:|
| Emprendedor | 1 |
| Starter | 1 |
| Pro | 2 |
| Enterprise | 3 |
| Custom | Unlimited |

Each connection is independent: it has its own AI agent (you assign it in the agent editor), its conversations never mix, and when sending campaigns or templates you choose which number the message goes out from. If you need more numbers than your plan allows, write to us at [support](https://parallly-chat.cloud/support).

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

Still have questions? Write to us at [support](https://parallly-chat.cloud/support).
