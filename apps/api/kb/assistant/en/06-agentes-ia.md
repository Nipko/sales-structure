---
id: agentes-ia
title: "AI Agents: create and configure"
routes: ["/admin/agent", "/admin/agent/simulation"]
roles: ["tenant_admin"]
keywords: ["agent", "ai agents", "bot", "chatbot", "virtual assistant", "create agent", "template", "personality", "instructions", "tone", "agent schedule", "assign channel", "connection", "duplicate agent", "default agent", "agent limit", "channels without agent", "test agent", "rules", "forbidden topics", "required fields", "when to hand off to a human", "fallback message", "active inactive", "advanced"]
---

# AI Agents: create and configure

Your AI agent is the "virtual salesperson" that replies to your customers on WhatsApp, Instagram, Messenger, Telegram and your website chat, 24 hours a day. Here you'll learn how to create it, give it a personality, set its schedule and assign it to your connections.

> This section is managed by the **admin** role. Supervisors and human agents see the results in the inbox, but they don't configure AI agents.

## Agent capacity

**AI Agent** shows how many agents you can create and whether custom templates are enabled. If you reach capacity, you'll see **Agent limit reached**; check the current allowance in **Plan & Billing**.

## How to create an agent

1. In the side menu, go to **AI Agent**.
2. Click **New Agent**.
3. Pick a template. You'll see three groups:
   - **Recommended for your business** — templates tailored to your industry (for example, receptionist for clinics, real estate advisor, order taking for restaurants).
   - **General templates** — **Sales Advisor**, **Support Agent**, **FAQ Bot**, **Appointment Scheduler**, **Lead Qualifier** and **Blank Agent** (to set everything up from scratch).
   - **My templates** — the ones you saved yourself, when the feature is enabled for your account.
4. Click **Use this** on the template you chose.
5. Type an **Agent name** if you want a custom one (for example, Sofia or Max); if you leave it blank, the template's name is used.

The agent is created and its editor opens so you can customize it.

## What the editor requires before saving

An agent only works well when the minimum is defined. On save, the editor checks and points at the missing field:

- **Agent name** — how it introduces itself to your customers.
- **Role** — what it does (for example, "Sales advisor" or "Receptionist").
- **Message for when it cannot answer** — the exact sentence the agent says when the question falls outside what it knows. Promising to find a person beats improvising.
- **At least one rule** of behavior.
- **At least one reason** under **When to hand off to a human**.

If you clear one of those fields to rewrite it, save only once it is complete again: an agent with no fallback message or no handoff reasons shows up as a critical blocker in **Agent health**.

**If your agent runs in custom-prompt mode**, this list changes. When your account has that feature enabled and the agent uses it, a single text you write replaces the guided personality: **Agent health** marks identity, tone, greeting, fallback message, and rules as **Not applicable**, and requires instead that the prompt is not empty. What **stays mandatory** is at least one reason under **When to hand off to a human**: without it the conversation never reaches a person, whatever the prompt says. If you see “Not applicable” where this guide says “required”, that is why, not a mistake.

## How to configure personality and instructions

Inside **AI Agent**, click **Edit** on the agent. The editor is organized into tabs and cards:

- **Identity** — name, role or title (for example, "Sales advisor") and language.
- **Personality** — the **Communication style** (Friendly, Professional, Formal, Casual or Empathetic), the **Response length** (Concise, Standard or Detailed) and the opening greeting.
- **Message for when it cannot answer** — the fallback text, required.
- **Instructions** — your own free-text rules (for example, "always offer the family combo before closing"), the forbidden topics the agent must never touch, and the response mode (always AI, always human or hybrid).
- **When to hand off to a human** — the list of reasons that make the agent stop replying and alert your team: the customer asks for it, complains, asks about a discount, or the agent fails several times in a row. Without at least one reason, the conversation never reaches a person.
- **AI Model** — which engine the agent uses. The editor shows the models enabled for your account.
- **Schedule** — when the agent is active (see below).
- **Capabilities** — what the agent can do, with switches to turn each one on or off:
  - Search for answers in your knowledge base
  - Check availability and book appointments
  - Show products, services or properties from your catalog
  - Create orders or reservations
  - Hand the conversation over to a person on your team when needed

**Advanced** is not one card: it is two collapsible sections in two different tabs, which is why you never find them together:

- **Advanced: fine-tune the search** — inside **Capabilities**, under the knowledge-search switch (it only appears when that switch is on). That is where how many passages to use and how closely they must match live.
- **Advanced** — inside **Instructions**, with the data the agent must ask for in each context.

Both ship with sensible values; change them only if you know what you are tuning.

When you're done, click **Save changes** — the button is always visible in the bottom bar, so you won't lose edits while scrolling.

## Active or inactive

The editor header has an **Active / Inactive** switch. An **inactive** agent replies on none of its connections, even when the channel is connected and the schedule says it should. Use it to prepare an agent without exposing it to customers, or to turn it off for a while without deleting anything. **Agent health** flags any inactive agent as a critical blocker, with or without assigned connections.

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

The available connection types and capacity appear under **Channels** and **Plan & Billing**.

## What the "channels without an assigned agent" notice means

If **AI Agent** shows **Channels without an assigned agent**, you have active connections that no agent handles specifically. In the meantime, those messages are answered by your **default agent** with a generic configuration.

Click **Assign agent now** to choose which agent handles each connection and deliver a personalized experience.

## Duplicate, save as template and other actions

In the **AI Agent** list, each agent has an actions menu:

- **Duplicate** — creates an exact copy, ideal for experimenting without touching the agent that's already working.
- **Save as template** — turns the configuration into a reusable template when the feature is enabled (it appears under **My templates**).
- **Set as default** — defines which agent replies on connections that don't have one assigned.
- **Delete** — removes the agent (you'll be asked to confirm). The default agent can't be deleted.

## Test your agent before going live

From the **AI Agent → Test agent** menu you can chat with your agent in simulation mode, without affecting real customers. Use it every time you change the personality or the rules, before it talks to your customers.

## Frequently asked questions

**Can I have one agent for sales and another for support?**
Yes, when your account has capacity. Create one with the **Sales Advisor** template and another with **Support Agent**, then assign each one to the matching connection.

**What happens if I connect a channel and don't assign an agent to it?**
Your default agent replies. You'll see the unassigned-channels notice in **AI Agent** so you can fix it with one click.

**Can the agent reply via SMS?**
No. SMS in Parallly is not a conversation channel: it's used only for outbound notifications with credits (1 credit = 1 segment). The self-service conversational surfaces are WhatsApp, Instagram, Messenger, Telegram and web chat. Email retains an internal inbound adapter, but not certified self-service configuration.

**I changed the instructions and the agent behaves the same — what should I check?**
Make sure you clicked **Save changes** in the editor's bottom bar and that you edited the agent assigned to that connection (not a different one). Then verify it in **Test agent**.

**How do I add more agents or more numbers?**
The screen shows the available capacity for agents and connections. Review current options under **Administration → Plan & Billing**, or write to us at https://parallly-chat.cloud/support if you need different capacity.
