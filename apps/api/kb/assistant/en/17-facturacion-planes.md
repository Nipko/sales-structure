---
id: facturacion-planes
title: "Plans, billing and tax details"
routes: ["/admin/settings/billing", "/admin/settings/fiscal"]
roles: ["tenant_admin"]
keywords: ["plans", "pricing", "billing", "payment", "mercadopago", "credit card", "change plan", "upgrade plan", "free trial", "annual", "monthly", "invoice", "payment history", "tax details", "nit", "tax id", "dian", "plan limit", "sms credits", "coupon"]
---

# Plans, billing and tax details

Everything related to your subscription lives on a single page: in the side menu, under the **Management** section, open **Billing**. There you can see your current plan, switch plans, manage your card, review your payment history and buy SMS credits. Only the admin role can view and change billing.

## The 5 plans

| Plan | Monthly price | AI agents | AI messages/mo | Users | Contacts | Calendars | Channels |
|------|---------------|-----------|----------------|-------|----------|-----------|----------|
| **Emprendedor** | USD $21 | 1 | 1,000 | 1 | 100 | 1 | WhatsApp only |
| **Starter** | USD $49 | 1 | 5,000 | 3 | 500 | 1 | WhatsApp, Instagram, Messenger, Email and web chat |
| **Pro** | USD $129 | 3 | 25,000 | 5 | 5,000 | 3 | All |
| **Enterprise** | USD $349 | 10 | 100,000 | Unlimited | 50,000 | 10 | All |
| **Custom** | Quote-based | Unlimited | Unlimited | Unlimited | Unlimited | Unlimited | All |

A few useful details:

- **Emprendedor** is the entry-level plan: WhatsApp only, no automations or campaigns. Great to get started and upgrade later.
- **Starter** unlocks more channels, 5 automation rules and 3 campaigns per month.
- **Pro** adds Telegram, unlimited automations and campaigns, and up to **2 WhatsApp numbers** connected at once (each connection with its own AI agent).
- **Enterprise** allows up to 3 WhatsApp numbers, 2 Instagram accounts and priority support.
- **Custom** is tailor-made: price and limits are agreed with the Parallly team.
- Remember: there is **one AI agent per connection**. If you have 2 WhatsApp numbers, each number has its own agent; how many connections of the same type you can have depends on your plan.
- Prices are shown in your **local currency** when available (for example, Colombian pesos); otherwise you'll see the USD equivalent.
- SMS is not a conversational channel: it's **outbound notifications that run on credits** (1 credit = 1 SMS segment). See more below.

## Free trial

- **Emprendedor and Starter**: 7-day trial, **no card required**.
- **Pro and Enterprise**: 15-day trial, **card required** (you're not charged until the trial ends).
- Your account starts on the Emprendedor plan trial when you sign up.
- 3 days before the trial ends you'll get a reminder email. If the trial expires without a card on file, the account becomes **Expired**: you lose access, but **your data is kept** and everything comes back once you pay.

## Monthly or annual cycle

Every paid plan can be billed on a **Monthly** or **Annual** cycle. The annual option applies a **discount of about 15%** on the yearly total.

1. Go to **Management → Billing**.
2. Use the **Monthly / Annual** toggle: when you choose Annual, the plan cards show the yearly price and the savings.
3. To change the cycle of an active subscription, use **Switch to annual** (or **Switch to monthly**). The cycle change is **immediate**: the current subscription is closed and a new one is created with the chosen cycle.

## How to upgrade or downgrade

1. Go to **Management → Billing** and scroll down to **Available plans**.
2. On the card for the plan you want, click **Upgrade to…** (up) or **Downgrade to…** (down).
3. If you **upgrade**: a card is required and the new plan is charged immediately. The new limits apply right away.
4. If you **downgrade**: the change is **scheduled for the end of your current period**, with no extra charge. You keep all your features until that date, and you can change your mind with the **Keep my plan** button.

## Payment method (MercadoPago)

Charges are processed with **MercadoPago**. Your card is stored securely (Parallly never sees the full number).

To change your card:

1. In **Management → Billing**, click **Change card**.
2. Enter the new card details in the secure MercadoPago window.
3. Click **Save new card**. The next charge will use the new card.

### If a charge fails

When a payment is declined, your subscription goes into **Payment pending** status and you'll get an email with instructions. You have two options:

- **Change the card** and wait for the automatic retry.
- Click **Retry charge now** to force the verification right away.

If after **7 days** the payment isn't recovered, the account is temporarily suspended. Your data is kept for 90 days and everything reactivates once you pay.

## Payment history and invoices

On the same **Billing** page, the **Invoice history** section shows your latest payments with **Date**, **Amount** (in the currency charged) and **Status** (Successful, Failed, Refunded or Pending). When an invoice is available, a **Download** button appears.

## Pause or cancel

- **Pause subscription**: to take a break without cancelling. You're not charged while it's paused and you come back with **Resume** (the next charge keeps your original date). Plan limits still apply during the pause.
- **Cancel at the end of the period**: you keep access until the end date of your current cycle.
- **Cancel now**: access ends immediately, with no refund for the current period.

## Promotional coupons

If you received a promo code you can use it at two moments: when **creating your account** ("Promo code" field in the first step) or later, in **Billing** → **Coupon code** section: paste the code and click **Apply**. Coupons add free months to your trial period. If the coupon doesn't go through, the message will tell you why (expired, already used, not valid for your plan, etc.).

## SMS credits (notifications to your customers)

Sending SMS runs on **prepaid credits**: 1 credit = 1 SMS segment. In **Billing**, the **SMS credits** section shows your available balance and what you've used this month.

1. Choose a credit package and click **Buy**.
2. Pay with MercadoPago as a **one-time payment** (it's not a subscription).
3. Credits are added automatically within a few seconds.

Packages and prices are set by the platform and may vary by country. If the SMS feature is disabled at the platform level, the section won't allow buying or sending.

## Tax details for Colombia (NIT or cédula) and DIAN invoices

If your business is in Colombia, Parallly issues a **DIAN electronic invoice** for your charges. So the invoice is issued in your business's name, complete your fiscal profile:

1. In the side menu, open **Settings**.
2. Under the **Company** section, open **Electronic invoicing**.
3. Fill in: organization type (legal entity or individual), **document type and number** (NIT or cédula; the NIT check digit is calculated automatically), VAT liability, business name or personal names, municipality, address, email and phone.
4. Save your changes.

On that same page you can see the **history of issued invoices** (number, status, amount, PDF/XML) and retry an invoice that ended up pending.

> **Important:** if you don't complete your tax details, your invoices are issued to "Final Consumer" and **they aren't valid for tax deductions**. The Billing page reminds you of this with the **View tax details** / **Complete tax details** links.

## What happens when you hit a limit

The **Billing** page shows usage bars for your plan: AI messages for the month, multimedia processing (audio and images) and knowledge base.

- At **80%** usage you'll see an amber warning; at **95%**, a red alert with the **Upgrade plan** button.
- If you reach the limit of a resource (contacts, agents, campaigns, etc.), the platform notifies you with a message like "You've reached the limit of your current plan" and you won't be able to create more of that resource until you upgrade or free up space.
- If the **multimedia** limit runs out, your agent keeps replying, but audio and images are logged generically, without transcription or analysis.
- Monthly counters reset on the first day of each month.

## Frequently asked questions

**Can I change plans whenever I want?**
Yes. Upgrades apply instantly (with an immediate charge); downgrades are scheduled for the end of your period, with no extra charge.

**What happens to my data if I stop paying or cancel?**
It's kept. The account is locked, but once you reactivate payment you get everything back exactly as it was.

**Can I pay in my local currency?**
The price is shown in your currency when a local rate is available (Colombia, for example). The charge is processed by MercadoPago with the card you register.

**Does the free trial ask for a card?**
Emprendedor and Starter don't. Pro and Enterprise do, but nothing is charged until the trial ends.

**How do I get my invoice?**
In **Billing → Invoice history**, using the **Download** button. If you're in Colombia and completed your tax details, you'll also receive the DIAN electronic invoice (PDF/XML) in **Settings → Electronic invoicing**.

Questions about a charge? Write to us at https://parallly-chat.cloud/support — the Parallly team is happy to help.
