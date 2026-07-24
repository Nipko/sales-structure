---
id: agentes-ia
title: "AI Agents: create and configure"
routes: ["/admin/agent", "/admin/agent/simulation"]
roles: ["tenant_admin"]
keywords: ["agent", "ai agents", "bot", "chatbot", "virtual assistant", "create agent", "template", "personality", "instructions", "tone", "agent schedule", "assign channel", "connection", "duplicate agent", "default agent", "agent limit", "channels without agent", "test agent", "rules", "forbidden topics"]
---

# AI Agents: create and configure

Your AI agent is the "virtual salesperson" that replies to your customers on WhatsApp, Instagram, Messenger, Telegram, Email and your website chat, 24 hours a day. Here you'll learn how to create it, give it a personality, set its schedule and assign it to your connections.

> This section is managed by the **admin** role. Supervisors and human agents see the results in the inbox, but they don't configure AI agents.

## How many agents your plan includes

| Plan | AI agents | Save your own templates |
|------|:---:|:---:|
| Emprendedor | 1 | No |
| Starter | 1 | No |
| Pro | 3 | Yes |
| Enterprise | 10 | Yes |
| Custom | Unlimited | Yes |

If you hit the limit, you'll see the **Agent limit reached** notice with an option to **Upgrade plan**.

## How to create an agent

1. In the side menu, go to **AI Agent**.
2. Click **New Agent**.
3. Pick a template. You'll see three groups:
   - **Recommended for your business** — templates tailored to your industry (for example, receptionist for clinics, real estate advisor, order taking for restaurants).
   - **General templates** — **Sales Advisor**, **Support Agent**, **FAQ Bot**, **Appointment Scheduler**, **Lead Qualifier** and **Blank Agent** (to set everything up from scratch).
   - **My templates** — the ones you saved yourself (available from the Pro plan).
4. Click **Use this** on the template you chose.
5. Type an **Agent name** if you want a custom one (for example, Sofia or Max); if you leave it blank, the template's name is used.

The agent is created and its editor opens so you can customize it.

## How to configure personality and instructions

Inside **AI Agent**, click **Edit** on the agent. The editor is organized into cards:

- **Identity** — name, role or title (for example, "Sales advisor") and language.
- **Personality** — the **Communication style** (Friendly, Professional, Formal, Casual or Empathetic), the **Response length** (Concise, Standard or Detailed) and the opening greeting.
- **Behavior** — your own free-text rules (for example, "always offer the family combo before closing"), the forbidden topics the agent must never touch, and the response mode (always AI, always human or hybrid).
- **AI Model** — how advanced the agent's "brain" is. Higher plans unlock more powerful models.
- **Schedule** — when the agent is active (see below).
- **Capabilities** — what the agent can do, with switches to turn each one on or off:
  - Search for answers in your knowledge base
  - Check availability and book appointments
  - Show products, services or properties from your catalog
  - Create orders or reservations
  - Hand the conversation over to a person on your team when needed

When you're done, click **Save changes** — the button is always visible in the bottom bar, so you won't lose edits while scrolling.

## How to set the agent's schedule

1. In the agent editor, open the **Schedule** card.
2. Select the days and time slots when the agent responds (for example, "Daily 9:00–18:00" or only 5 days a week).
3. Save with **Save changes**.

Outside those hours the agent doesn't reply automatically; combine this with the response mode if you'd rather have your team take over at certain times.

## How to assign the agent to each connection

The rule is simple: **one AI agent per connection**. A connection is each account or number you've connected — for example, "WhatsApp Sales" and "WhatsApp Support" are two separate connections, and each can have its own agent.

1. In the agent editor, go to **Channel Assignment**.
2. Select the connections this agent will handle. You'll see each account with its name and number, not the generic channel.
3. If the connection was already assigned to another agent, the editor warns you that it **will be reassigned** from the previous agent.
4. Click **Save changes**.

How many connections of the same type you can have depends on your plan:

| Plan | WhatsApp | Instagram | Messenger | Telegram |
|------|:---:|:---:|:---:|:---:|
| Emprendedor | 1 | 1 | 1 | 1 |
| Starter | 1 | 1 | 1 | 1 |
| Pro | 2 | 1 | 3 | 1 |
| Enterprise | 3 | 2 | 5 | 2 |
| Custom | Unlimited | Unlimited | Unlimited | Unlimited |

> The Emprendedor plan includes the WhatsApp channel only. The other channels unlock from Starter (Telegram from Pro).

## What the "channels without an assigned agent" notice means

If in **AI Agent** you see a highlighted notice like "2 channel(s) without an assigned agent", it means you have active connections that no agent handles specifically. In the meantime, those messages are answered by your **default agent** with a generic configuration.

Click **Assign agent now** to choose which agent handles each connection and deliver a personalized experience.

## Duplicate, save as template and other actions

In the **AI Agent** list, each agent has an actions menu:

- **Duplicate** — creates an exact copy, ideal for experimenting without touching the agent that's already working.
- **Save as template** — turns the configuration into a reusable template (it appears under **My templates**). Available from the Pro plan.
- **Set as default** — defines which agent replies on connections that don't have one assigned.
- **Delete** — removes the agent (you'll be asked to confirm). The default agent can't be deleted.

## Test your agent before going live

From the **AI Agent → Test agent** menu you can chat with your agent in simulation mode, without affecting real customers. Use it every time you change the personality or the rules, before it talks to your customers.

## Frequently asked questions

**Can I have one agent for sales and another for support?**
Yes, from the Pro plan (3 agents). Create one with the **Sales Advisor** template and another with **Support Agent**, and assign each to the matching connection — for example, two different WhatsApp numbers.

**What happens if I connect a channel and don't assign an agent to it?**
Your default agent replies. You'll see the unassigned-channels notice in **AI Agent** so you can fix it with one click.

**Can the agent reply via SMS?**
No. SMS in Parallly is not a conversation channel: it's used only for outbound notifications with credits (1 credit = 1 segment). The conversational channels are WhatsApp, Instagram, Messenger, Telegram, Email and the web chat.

**I changed the instructions and the agent behaves the same — what should I check?**
Make sure you clicked **Save changes** in the editor's bottom bar and that you edited the agent assigned to that connection (not a different one). Then verify it in **Test agent**.

**How do I add more agents or more numbers?**
Both limits depend on your plan (see the tables above). You can upgrade your plan from Settings → Billing, or write to us at https://parallly-chat.cloud/support if you need a special limit.
