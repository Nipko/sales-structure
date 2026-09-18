---
id: agentes-ia
title: "AI Agents: create and configure"
routes: ["/admin/agent", "/admin/agent/simulation"]
roles: ["tenant_admin"]
keywords: ["agent", "ai agents", "bot", "chatbot", "virtual assistant", "create agent", "template", "personality", "instructions", "tone", "agent schedule", "assign channel", "connection", "duplicate agent", "default agent", "agent limit", "channels without agent", "test agent", "rules", "forbidden topics", "required fields", "when to hand off to a human", "fallback message", "active inactive", "advanced", "assist", "main instructions", "sales and support", "agent draft", "save", "immediate changes", "reviewed mode", "already answers", "earlier changes", "changes not applied", "discard changes", "channel nobody answers"]
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

The agent is created and its editor opens. Creating it from this screen does not yet make it the default agent or hand it any connections: customize it, tick the connections it will handle under **Channel Assignment**, and save; from that moment it answers there.

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
- **Personality** — communication style, emoji and humor use, **Response length** (Concise, Standard or Detailed), and the opening greeting.
- **Message for when it cannot answer** — the fallback text, required.
- **Instructions** — one main guide, concrete rules, forbidden topics, and the information to ask for in each context. The main guide is part of the effective prompt in guided mode.
- **When to hand off to a human** — the list of reasons that make the agent stop replying and alert your team: the customer asks for it, complains, asks about a discount, or the agent fails several times in a row. Without at least one reason, the conversation never reaches a person.
- **Sales and support** — choose whether the agent sells, supports, or does both; sales agents can also set recommendation intensity and the maximum allowed discount.
- **Schedule** — when the agent is active (see below).
- **Capabilities** — what the agent can do, with switches to turn each one on or off:
  - Search for answers in your knowledge base
  - Check availability and book appointments
  - Show products, services or properties from your catalog
  - Create orders or reservations
  - Hand the conversation over to a person on your team when needed

Specialized capabilities depend on the tenant's **business type**. The editor only offers families that belong to that profile and explains when missing data, plan access, or a provider prevents activation.

**Advanced** is not one card: it is two collapsible sections in two different tabs, which is why you never find them together:

- **Advanced: fine-tune the search** — inside **Capabilities**, under the knowledge-search switch (it only appears when that switch is on). That is where how many passages to use and how closely they must match live.
- **Advanced** — inside **Instructions**, with the data the agent must ask for in each context.

Both ship with sensible values; change them only if you know what you are tuning.

## Configure with Parallly Assist

You can ask Assist to review the agent and prepare changes to identity, language, instructions, rules, required information, after-hours behavior, sales/support mode, recommendations, response length, knowledge, and permissions. Assist presents a proposal for review; accepting it applies the change to the agent (or leaves it as a draft if your account uses reviewed mode). Assist never turns the agent on or off. In custom-prompt mode, Assist withholds personality, main-guide, rules, and required-field edits because the custom prompt replaces them. Never send credentials or connection details through chat.

When you're done, click **Save**. The change applies immediately to the assigned connections and the green toast reads **Saved. Your agent now answers this way.**; the previous version stays in history. If a required field is missing, the editor marks it in red and does not save. Use **Test agent** to see it respond before or after saving. If you leave with unsaved changes, the editor warns you.

**Reviewed mode (optional).** Teams that prefer to approve every change before it reaches customers can turn on reviewed mode for the account. Then the button reads **Save draft**, the **Review a version** and **Publish and view history** sections appear, and the change only reaches customers after you review and publish that version. By default, the account is in immediate mode.

**Earlier changes not applied yet.** If you saved changes under the old draft-and-review flow and they were never applied, the editor shows **You have earlier changes that haven't been applied yet** at the top. The form shows what your agent uses today: choose **Apply those changes** so it starts using them (they are saved like any change; if a required field is missing, the editor marks it) or **Discard those changes** to leave it as it is. If you save without applying them, they are discarded and what you see is saved. If your agent changed afterwards (for example, you switched it on, connected a channel, or accepted a proposal from Assist), the notice says they can no longer be applied: discard them so you can save again.

## Active or inactive

The editor header has an **Active / Inactive** switch. An **inactive** agent replies on none of its connections, even when the channel is connected and the schedule says it should. You can deactivate it immediately after confirming, and reactivate it with the same switch: it turns on right away. (In reviewed mode, reactivating goes through reviewing and publishing a version.) **Agent health** flags any inactive agent as a critical blocker, with or without assigned connections.

## How to set the agent's schedule

1. Configure the account-wide days, time ranges, and time zone under **Settings → Business hours**.
2. Open **Schedule** in the agent editor to review that calendar and choose whether AI keeps replying outside it.
3. If you turn after-hours AI off, write this agent's specific fallback and save.

Business hours belong to the tenant and are shared by its agents; each agent only chooses its own behavior outside them.

## How to assign the agent to each connection

The rule is simple: **one AI agent per connection**. A connection is each account or number you've connected — for example, "WhatsApp Sales" and "WhatsApp Support" are two separate connections, and each can have its own agent.

1. In the agent editor, go to **Channel Assignment**.
2. Select the connections this agent will handle. You'll see each account with its name and number, not the generic channel.
3. If the connection was already assigned to another agent, the editor warns you that it **will be reassigned** from the previous agent.
4. Click **Save**. Reassignment happens on save. If a ticked connection isn't connected yet, its row shows **Connect**, which takes you to that channel's screen.

When you connect your **first channel**, it gets assigned only to the default agent (if it's the only active one); there's no need to go back to the editor. With several active agents, the assignment is yours to make.

The available connection types and capacity appear under **Channels** and **Plan & Billing**.

## What the "channels without an assigned agent" notice means

If **AI Agent** shows **Channels without an assigned agent**, you have active connections that no agent handles specifically. While an active default agent exists, those messages are answered by its operational version. If there is no active default agent, or two agents have the same connection assigned, nobody answers there: messages arrive but go unanswered, and **Agent health** flags it as critical under **Every connected channel has an agent that replies**.

Click **Assign agent now** to choose which agent handles each connection and deliver a personalized experience.

## Duplicate, save as template and other actions

In the **AI Agent** list, each agent has an actions menu:

- **Duplicate** — creates an exact copy, ideal for experimenting without touching the agent that's already working.
- **Save as template** — copies the current configuration into a reusable template when the feature is enabled.
- **Set as default** — makes it the agent that answers unassigned connections, immediately.
- **Delete** — retires the agent from use by deactivating it and releasing its connections while retaining its record. The default agent cannot be retired until another is set as default.

## Test your agent before going live

From **AI Agent → Test agent** you can chat with the agent exactly as it answers today, without affecting real customers, spending messages, or creating bookings. Test it whenever you change personality, rules, tools, or connections.

## Frequently asked questions

**Can I have one agent for sales and another for support?**
Yes, when your account has capacity. Create one with the **Sales Advisor** template and another with **Support Agent**, then assign each one to the matching connection.

**What happens if I connect a channel and don't assign an agent to it?**
Your default agent replies, if it is active; if not, nobody answers on that channel and **Agent health** tells you. You'll see the unassigned-channels notice in **AI Agent** so you can fix it with one click.

**Can the agent reply via SMS?**
No. SMS in Parallly is not a conversation channel: it's used only for outbound notifications with credits (1 credit = 1 segment). The self-service conversational surfaces are WhatsApp, Instagram, Messenger, Telegram and web chat. Email retains an internal inbound adapter, but not certified self-service configuration.

**I changed the instructions and the agent behaves the same — what should I check?**
Make sure the save finished with the green toast **Saved. Your agent now answers this way.**; if a required field was missing, the editor marks it in red and doesn't save. Then verify that connection is assigned to this agent and not another, and that the agent is **Active**. In reviewed mode, you also need to review and publish the version.

**How do I add more agents or more numbers?**
The screen shows the available capacity for agents and connections. Review current options under **Administration → Plan & Billing**, or write to us at https://parallly-chat.cloud/support if you need different capacity.
