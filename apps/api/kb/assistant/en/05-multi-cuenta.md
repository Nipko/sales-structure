---
id: multi-cuenta
title: "Multiple connections of the same channel (multi-account)"
routes: ["/admin/channels", "/admin/agent", "/admin/broadcast", "/admin/channels/whatsapp/templates"]
roles: ["tenant_admin", "tenant_supervisor"]
keywords: ["multi-account", "multiple accounts", "two whatsapp numbers", "second number", "another instagram account", "account limit", "connect another account", "add another", "disconnect an account", "sender number", "choose number", "send from number", "accounts per channel", "multiple connections", "two accounts", "account counter", "plan limit", "several numbers"]
---

# Multiple connections of the same channel (multi-account)

Does your business have one WhatsApp number for sales and another for support? Or two Instagram accounts for different brands? With Parallly you can connect **more than one account of the same channel** — for example two WhatsApp numbers, two Instagram accounts, or two Telegram bots — and each one works independently: conversations never get mixed up, and each connection can have its own AI agent.

> Connecting and disconnecting accounts is an **admin** task. Supervisors can view channel status and choose the sender number when sending campaigns.

## How many accounts of the same channel your plan includes

Each plan defines how many connections of the same type you can have. These are the included limits:

| Plan | WhatsApp | Instagram | Messenger | Telegram |
|------|:--------:|:---------:|:---------:|:--------:|
| Emprendedor | 1 | 1 | 1 | 1 |
| Starter | 1 | 1 | 1 | 1 |
| Pro | 2 | 1 | 3 | 1 |
| Enterprise | 3 | 2 | 5 | 2 |
| Custom | Unlimited | Unlimited | Unlimited | Unlimited |

Keep in mind:

- The channels available also depend on your plan: the **Emprendedor** plan includes WhatsApp only, and **Telegram** is available starting with the **Pro** plan.
- The **Email** channel supports one connection per business.
- If you need more accounts than your plan includes, you can upgrade from **Settings → Billing**, or write to us to expand your limit: the Parallly team can adjust it for your business.

## How to see how many accounts you have connected

1. In the sidebar, go to **Channels**.
2. Each channel card shows a counter in the format **"X/Y accounts"** — for example, "1/2 accounts" means you have 1 account connected and your plan allows up to 2 for that channel. If your limit is unlimited, you'll see the ∞ symbol.
3. When you still have room, the card shows the **Add another** link.

## How to connect another account of the same channel

1. Go to **Channels** and find the channel's card (for example, WhatsApp).
2. Click **Add another**.
3. Follow the same connection process as always: Meta login for WhatsApp, Instagram, or Messenger, or the @BotFather token for Telegram.
4. When you're done, the new account appears on the channel card alongside the others, with its own name or number.

Each account keeps its own authorization, so messages always go out through the correct number or account.

> If the **Add another** link doesn't appear, you've already reached your plan's limit for that channel.

## Each connection with its own AI agent

In Parallly the rule is **one AI agent per connection**, not per channel. That means if you have two WhatsApp numbers, you can assign a different agent to each — for example, "Sofía" for the sales number and "Carlos" for support.

To assign them:

1. In the sidebar, go to **AI Agent** and open the agent you want to configure.
2. In the **Channel Assignment** section, you'll see one option for **each connected account**, identified by its name or number (for example, "WhatsApp · Sales +57 300…").
3. Check the connections this agent should handle and press **Save changes** in the bottom bar.

If you assign this agent a connection that another agent was already handling, the platform warns you before saving: the connection will move to the new agent.

## How to disconnect a specific account

Disconnection is **per account**: you can disconnect one number without affecting the others.

1. Go to **Channels** and click the channel.
2. Find the specific account you want to disconnect and click **Disconnect**.
3. Confirm the message: "Disconnect this account? The other accounts on this channel will stay active."
4. Check the result in the confirmation modal: green means a complete disconnection; yellow means it was disconnected in Parallly, but you should also check your provider account (for example, Meta Business Suite).

## Choosing the sender number in campaigns

When you have more than one WhatsApp number connected, you choose which one to send from when creating a campaign:

1. In the sidebar, go to **Campaigns** and create a **New campaign**.
2. In the form you'll see the **Send from number** field.
3. Choose the sender number, or leave **Primary number (default)** to send from your main number.
4. Complete the rest of the campaign (audience, template, scheduling) and confirm.

## WhatsApp templates with multiple numbers

Templates approved by Meta belong to a specific number. If you have several numbers:

1. Go to **Channels → WhatsApp** and click **View all templates**.
2. When creating a template, the **Number / account** field appears: choose which number you're creating it for, or leave **Primary number (default)**.
3. Submit it for approval as usual. When sending campaigns, use templates from the same number you chose as the sender.

## Frequently asked questions

**Can conversations from my two numbers get mixed up?**
No. Each connection keeps its conversations separate in the inbox, and replies always go out through the same account the customer wrote to.

**Can I assign two AI agents to the same number?**
No. Each connection has exactly one assigned agent. What you can do is assign the same agent to several connections.

**I hit my plan's account limit — what do I do?**
You can upgrade your plan from **Settings → Billing**, or contact us at https://parallly-chat.cloud/support to evaluate expanding the limit for your business.

**If I disconnect one account, do the others keep working?**
Yes. Disconnection is individual: the other accounts on the same channel keep receiving and answering messages as usual.

**Does multi-account apply to the web chat or Email?**
Email supports one connection per business, and the web chat widget is configured separately in **Settings → Integrations → Web Chat**. Multi-account applies to WhatsApp, Instagram, Messenger, and Telegram.

**Do accounts from different channels count toward the same limit?**
No. The limit is per channel type: for example, on the Pro plan you can have 2 WhatsApp numbers and also 3 Messenger pages.

Questions? Write to us at https://parallly-chat.cloud/support — we're happy to help.
