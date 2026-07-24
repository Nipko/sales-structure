---
id: sms-creditos
title: "SMS credits and SMS notifications"
routes: ["/admin/settings/billing", "/admin/broadcast"]
roles: ["tenant_admin"]
keywords: ["sms", "credits", "sms credits", "sms package", "buy credits", "sms balance", "top up", "text messages", "sms notifications", "segment", "mercadopago", "one-time payment", "sms campaigns", "sms reminders", "out of balance", "text alerts", "sms disabled", "text to customers"]
---

# SMS credits and SMS notifications

With Parallly you can send **SMS notifications** to your customers: reminders, alerts, and promotions that arrive as a text message on their phone. SMS runs on a system of **prepaid credits** that you buy in packages.

Important: SMS is **not a conversation channel**. It's a **one-way** send: your customer receives the message but cannot reply to it by SMS. Conversations with your AI agent happen over WhatsApp, Instagram, Messenger, Telegram, Email, or the web chat.

## What a credit is

- **1 credit = 1 SMS segment** (roughly **160 characters** of plain text).
- If your message uses **accents, ñ, or emojis**, each segment shrinks to about **70 characters**, because the text travels in a different format.
- A message longer than one segment is split into several and **uses one credit per segment**. For example, a reminder of about 120 characters with accents uses 2 segments, that is, 2 credits.

Tip: write short, direct messages. If you can avoid accents and emojis, each credit goes further.

## How to buy a credit package

Packages are paid with **MercadoPago** as a **one-time payment**: it's not a subscription and doesn't generate recurring charges.

1. In the side menu, under **Management**, go to **Billing**.
2. Scroll down to the **SMS credits** section. There you'll see the available packages with their message count and price (some are marked as **Most popular**).
3. Choose the package you need and press **Buy**.
4. The MercadoPago checkout opens. Complete the payment as with any online purchase.
5. When you return to Parallly you'll see the "Processing your purchase…" notice: the credits are **added automatically within a few seconds** after the payment is confirmed.

Only the account **administrator** can buy credits, because the purchase is made from the Billing page.

## How to check your balance and usage

In the same **SMS credits** section of **Billing** you'll find:

- Your **current balance** ("available credits"), always visible at the top of the section.
- The **SMS used this month**.
- Automatic notices: when your balance **drops below 50 credits** an alert appears suggesting you top up, and when it reaches **0** you'll see a prominent notice to buy a package.

Every send is recorded internally with its date and credit amount, so the balance always reflects exactly what you bought minus what you used.

## How to send SMS notifications to your customers

SMS messages go out from **Campaigns** (side menu, **Growth** section):

1. Go to **Campaigns** and create a new campaign.
2. When choosing the send channels, select **SMS** (if the option is available in your account).
3. Write the message text. The editor shows you the character counter so you know how many segments it will use.
4. Choose the audience and send or schedule the campaign.

Beyond campaigns, credits are **also consumed** by any automated SMS sends you have set up, such as **appointment reminders** and **follow-up sequences**.

What does **not** consume credits: the SMS messages the platform sends to you for security (for example, verification codes). Your credits are only for the messages your business sends to **your customers**.

## Why it may appear disabled

There are three different situations:

- **You don't see the "SMS credits" section in Billing, or SMS doesn't appear as a channel in Campaigns**: the SMS service is enabled at the platform level and may be temporarily turned off (for example, while coverage is being adjusted in your country). While it's off, credits can't be bought and SMS can't be sent. Your **balance stays intact** and becomes available again when the service is reactivated.
- **You ran out of balance**: SMS sends simply **don't go out** and **you're not charged anything**. Buy a package and the next sends will go out normally (messages that didn't go out due to a lack of balance are not resent on their own).
- **You're not an administrator**: buying packages is in Billing, which only the account administrator can see. Ask your administrator to top up.

## Frequently asked questions

**Do credits expire?**
They have no expiration date: your balance is kept until you use it, even if the SMS service is temporarily paused.

**Is buying credits a subscription?**
No. It's a **one-time payment** through MercadoPago. You buy whenever you want and top up only when you need to.

**Can my customers reply to the SMS?**
No. SMS is one-way. If you want to chat with your customers, use the conversation channels (WhatsApp, Instagram, Messenger, Telegram, Email, or the web chat).

**Why did a single message deduct several credits?**
Because it went over one segment. Plain text fits ~160 characters per segment; with accents or emojis, ~70. A long message is split into several segments and each one costs 1 credit.

**I paid and don't see the credits?**
Crediting is automatic and usually takes a few seconds after the payment is confirmed. Refresh the **Billing** page; if after a few minutes the balance still doesn't appear, write to support: https://parallly-chat.cloud/support

**What number do the SMS messages come from?**
Parallly sends them with a platform sender number; you don't need to contract or connect any SMS provider of your own.
