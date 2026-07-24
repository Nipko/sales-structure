---
id: canales-redes
title: "Connecting Instagram, Messenger, and Telegram"
routes: ["/admin/channels", "/admin/channels/instagram", "/admin/channels/messenger", "/admin/channels/telegram"]
roles: ["tenant_admin"]
keywords: ["instagram", "messenger", "telegram", "facebook", "connect channel", "connect instagram", "connect messenger", "connect telegram", "reconnect", "token expired", "bot", "botfather", "direct messages", "dm", "disconnect channel", "business account", "multiple accounts", "account limit", "facebook page", "social media"]
---

Beyond WhatsApp, your business can serve customers on **Instagram**, **Messenger**, and **Telegram**. All three are connected from the **Channels** section in the sidebar, and each connection can have its own AI agent. Here's what you need, how to connect each one, what the statuses mean, and what to do when a connection expires.

> Only the **admin** role can connect and disconnect channels. Supervisors and agents can see the status but can't change it.

## Before you start: requirements per channel

| Channel | You need |
|-------|-----------|
| Instagram | An **Instagram Business** account (personal accounts don't work; this is a Meta requirement, not a Parallly one) |
| Messenger | A Facebook account with admin access to your business's **Facebook page** |
| Telegram | A **Telegram bot** created with @BotFather (we guide you step by step; it takes less than 2 minutes) |

## How to connect Instagram

1. In the sidebar, go to **Channels** and find the **Instagram** card.
2. Click **Connect**.
3. On the Instagram page, click **Connect with Instagram**. A Meta popup window will open.
4. Sign in with your **Instagram Business** account and accept the messaging permissions Meta asks for.
5. The window closes on its own and you'll see your **Connected account** with your profile's name and username.

From that moment on, Instagram direct messages (DMs) arrive in your inbox and your AI agent can reply to them.

### When and how to reconnect Instagram

The authorization Meta grants Parallly for your Instagram account **lasts 60 days**. You don't have to do anything to keep it active: Parallly renews it automatically every day as the expiration date approaches.

- On the channel card you'll see the notice "**Token expires in X days**" for your information.
- If the automatic renewal fails (for example, because you changed your password or permissions on Instagram), you'll get an alert and see the message "**Token expired. Please reconnect your account.**"
- In that case, click **Reconnect** and sign in with Instagram again. Your conversations and history remain fully intact.

## How to connect Messenger

1. In the sidebar, go to **Channels** and find the **Messenger** card.
2. Click **Connect**.
3. Click **Connect with Facebook**. The Facebook login dialog will open.
4. Sign in, **select your business's Facebook page**, and grant the requested messaging permissions.
5. Done: you'll see your **Connected page** and Messenger messages will start arriving in your inbox.

## How to connect Telegram

1. In the sidebar, go to **Channels** and find the **Telegram** card. Click **Connect**.
2. **Step 1 — Create your bot on Telegram** (under 1 minute):
   - Open Telegram and search for **@BotFather** (Telegram's official bot creation assistant), or use the **Open @BotFather** button.
   - Send the `/newbot` command and pick a name and a username for your bot.
   - BotFather will send you a **token**: copy it.
3. Click **I already have the token**.
4. **Step 2 — Paste your bot token** into the field shown and click **Connect bot**. The token is stored encrypted and is never displayed in plain text.
5. You'll see the confirmation "**Bot connected!**". Parallly completes the rest of the setup automatically.
6. Use **Open in Telegram** to send your bot a test message and confirm your AI agent replies.

## Connection statuses

On the **Channels** page, each card shows its current status:

- **Connected** (green badge): the channel sends and receives messages normally. The button changes to **Configure** to open the details.
- **Disconnected** (red badge): the channel isn't active. Open the card to connect or reconnect it.
- **Account counter** ("X/Y accounts"): how many connections of that type you have active and how many your plan allows. If you still have room, the **Add another** link appears.

Remember: each connection needs an assigned AI agent to reply automatically. The assignment is done from the agent editor (**AI Agent** section), and the **one agent per connection** rule applies.

## Multiple accounts on the same channel

Depending on your plan, you can connect more than one account of the same type (for example, two Instagram accounts or two Telegram bots) without their conversations mixing. Limits included per plan:

| Plan | Instagram | Messenger | Telegram |
|------|:---------:|:---------:|:--------:|
| Emprendedor | 1 | 1 | 1 |
| Starter | 1 | 1 | 1 |
| Pro | 1 | 3 | 1 |
| Enterprise | 2 | 5 | 2 |
| Custom | Unlimited | Unlimited | Unlimited |

If you need more connections than your plan includes, write to us at [support](https://parallly-chat.cloud/support): limits can be extended for your account.

## How to disconnect an account

Disconnection is **per account**: if you have several connections on the same channel, disconnecting one doesn't affect the others.

1. Go to **Channels**, open the channel, and choose the connection you want to remove.
2. Click **Disconnect** and confirm in the modal.
3. The result tells you exactly what happened:
   - **Green** — "Fully disconnected": everything was also closed on the provider's side (Meta or Telegram).
   - **Yellow** — "Disconnected on platform": Parallly will no longer process messages, but it's worth checking the integration on the provider's side (for example, in Meta Business Suite), because the authorization may have expired before the shutdown completed.
   - **Red** — there was a network error: try again.

## Frequently asked questions

**Can I connect my personal Instagram?**
No. Only **Instagram Business** accounts work. It's a Meta requirement. Converting your personal account to Business is free and done from the Instagram app.

**Do I have to reconnect Messenger or Telegram every so often?**
No. Periodic renewal only applies to Instagram, and it's normally automatic. You'll only need to step in if you get an alert that the renewal failed.

**Can I have a different AI agent on each channel?**
Yes: the rule is **one agent per connection**. You can have, for example, a formal agent on Messenger and a friendlier one on Instagram, depending on what your plan allows.

**I connected the channel but the bot doesn't reply. What should I check?**
Check two things in this order: that the channel card says **Connected**, and that the connection has an AI agent assigned in the **AI Agent** section. If both look right and it still doesn't reply, contact us at [support](https://parallly-chat.cloud/support).

**What happens to my conversations if I disconnect and reconnect?**
Nothing is lost: your conversation history and contacts are preserved. When you reconnect, new messages pick up the existing conversation.
