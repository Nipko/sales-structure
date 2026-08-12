---
id: automatizacion
title: "Automations and follow-up"
routes: ["/admin/automation", "/admin/automation/drip-sequences", "/admin/automation/templates"]
roles: ["tenant_admin", "tenant_supervisor"]
keywords: ["automation", "rules", "automatic rule", "follow-up", "nurturing", "sequence", "drip", "flow", "visual builder", "trigger", "conditions", "actions", "automation templates", "reminder", "abandoned cart", "re-engagement", "automatic messages", "prospecting", "rule limit"]
---

# Automations and follow-up

Automations are "if X happens, then do Y" rules that run on their own in the background: they send follow-ups, move leads between stages, assign agents, or add tags without anyone having to do it by hand. Under **AI & Growth** you'll find **Automation**, **Drip Sequences**, and **Templates**.

Users with an admin or supervisor role can create and edit them.

## How to create an automation rule

1. Go to **AI & Growth → Automation** and click **"New rule"**.
2. **Trigger** — pick the event that fires the rule:
   - **Lead captured** — when a new lead enters the system
   - **New message** — when a message arrives from the customer
   - **Conversation assigned** — when a conversation is assigned to an agent
   - **SLA breached** — when the response time is exceeded
   - **Inactivity** — when the customer stops replying
   - **Stage change** — when a lead moves to a different funnel stage
3. **Conditions** — optional filters by **Channel**, **Stage**, **Score**, **Tag** or **Source**. All of them must be met at once; if you add none, the rule runs every time the trigger fires.
4. **Actions** — what the rule does (you can chain several with **"Add action"**):
   - **Send WhatsApp template**
   - **Create follow-up task**
   - **Change pipeline stage**
   - **Add tag**
   - **Assign to agent**
   - Each action can have a delay in seconds, so it runs a while after the event.
5. **Summary** — give it a clear name (e.g. "Auto-assign new leads"), review the details and click **"Save Rule"**. You can check **"Activate rule immediately"** or leave it inactive and switch it on later with its toggle.

Every rule shows its **"Execution history"**, so you can check when it fired and with what result. If a send fails, the platform automatically retries up to 3 times.

> If **HTTP Request** is enabled for your account, a rule can notify another business system. Treat it as a technical integration and test it with non-sensitive data.

## How to use the visual flow builder

Besides the step-by-step wizard, you can build the same rule on a visual canvas:

1. In **Automation**, use the **"Visual builder"** button.
2. Drag and connect **Trigger**, **Condition** (with **Yes** / **No** branches), **Action** and **Wait** blocks (in minutes, hours or days).
3. Save with **"Save"**. You can switch anytime between the canvas and **"Edit with wizard"** — it's the same rule seen two different ways.

The visual builder is ideal for flows with branches ("if they replied, tag them; if not, wait 2 days and resend").

## How to create a follow-up (drip) sequence

**Drip Sequences** send a series of messages with waits between each step. They're perfect for nurturing cold leads, welcoming new customers, or post-sale follow-up.

1. Go to **AI & Growth → Drip Sequences** and click **"New sequence"**.
2. Name it (e.g. "New leads welcome") and pick the **Trigger event**:
   - **Manual enrollment** — you add contacts with **"Enroll contact"**
   - **Lead captured**
   - **Tag added**
   - **Stage change**
3. Click **"Add step"** for each message. Each step defines:
   - **Wait** — how long to wait before sending it (**Minutes**, **Hours** or **Days**)
   - **Message type** — **WhatsApp template**, **Custom message** or **AI-generated**
   - You can personalize with variables like `{{contact.name}}` to greet people by name.
4. Under **"Stop if"**, leave the stop conditions checked (see below).
5. Turn the sequence on with the **"Active"** toggle and click **"Save sequence"**.

### When the sequence stops for a contact

- **The contact replies** to a message in the series when the reply stop condition is enabled.
- The contact asks not to receive more messages (opt-out).

The visible **The contact converts** option is not yet enforced automatically in this release. Unenroll the contact manually after conversion.

> Tip: keep sequences short (3 to 5 steps). A lead who hasn't replied after 5 attempts rarely converts; better to focus your effort elsewhere.

### Prospecting a segment with a sequence

Inside an active sequence you'll find **"Prospect from CRM"**: you pick a lead segment and click **"Enroll segment"** to enroll them all at once (up to 500 per batch). The first step must be an approved WhatsApp template, because WhatsApp only allows templates to start a cold conversation. The platform honors opt-outs and never enrolls anyone twice.

## How to install an automation template

If you'd rather not start from scratch, go to **AI & Growth → Templates**:

1. Search or filter by **Category** (Lead nurturing, Appointment reminders, Abandoned cart, Welcome sequence, Re-engagement, Feedback collection, VIP treatment, After hours) or by **Industry** — if your business is in healthcare, you'll see appointment-reminder templates first, for example.
2. Click a card to see exactly what it does: trigger, conditions and actions.
3. Click **"Install"** — a copy of the rule is created in your account.
4. Use **"View rules"** to jump straight into editing it: adjust texts, timings and conditions to fit your business.
5. The installed rule stays **inactive** by default — activate it once you've reviewed it.

## Timing: when do automatic messages go out?

- The timing of a sequence, or of an action with a delay, counts from the event that triggered it (e.g. "2 days after the lead was captured").
- Your business hours are configured separately, in **Settings** → **Business Hours**. That's where you set your open days and hours and the after-hours message.
- In the template gallery, the **After hours** category comes with ready-made rules to reply automatically when people message you outside your hours.

## Availability and capacity

The screen shows whether rules, sequences, and **HTTP Request** are enabled, together with current usage. Check current limits in **Plan & Billing**.

## Frequently asked questions

**What's the difference between a rule and a drip sequence?**
A rule reacts to an event and runs actions (once). A drip sequence is a series of messages over time, with waits between each one, that accompanies the contact for days.

**I created a rule and nothing happens — why?**
Check three things: that the rule is **Active** (toggle on), that the conditions aren't too restrictive (all must be met at once), and the **"Execution history"** to see whether it fired and with what result.

**Can I pause a sequence without deleting it?**
Turning off **Active** prevents new enrollments, but already scheduled steps may continue for enrolled contacts in this release. Use **Unenroll** for those contacts before deactivating the sequence.

**Can automatic messages reach someone who asked not to be contacted?**
No. The platform honors opt-outs: if a contact asked not to receive messages, rules and sequences won't send them anything.

**Why won't my plan let me create more rules?**
Delete rules you no longer use, then check current capacity and available options under **Administration → Plan & Billing**.

Need more help? Write to us at https://parallly-chat.cloud/support
