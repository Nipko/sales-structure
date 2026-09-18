---
id: centro-calidad-agente
title: "Agent health and Quality center"
routes: ["/admin/agent/quality", "/admin"]
roles: ["tenant_admin", "tenant_supervisor"]
keywords: ["agent health", "quality center", "agent quality", "preparation", "tested quality", "production evidence", "agent at risk", "configuration incomplete", "critical actions", "badge", "snooze", "Parallly Assist", "improve agent", "channel coverage", "operational channel connection", "show me where", "guided tour", "context bar", "needs reauthorisation", "essentials", "next step", "not ready", "whatsapp not delivering", "billing time zone", "payment method in meta", "channel nobody answers", "day 0", "first real customer", "unconfirmed example prices"]
---

# Agent health and Quality center

**Agent health** shows what still needs configuration, what has been tested, and what
is happening in real conversations for each AI agent. Its detail is under **Insights
→ Agent health**. Admins and Supervisors can read it; only Admins can
edit agents, connections, or configuration under **AI & Growth → AI Agent**.

## Where it appears and what it means

- The **Your agents' health** card on Home always summarizes the worst status and
  open actions for Admins and Supervisors.
- The **Insights → Agent health** badge counts only open **Critical and High**
  signals. It is an attention count, not a score.
- The global banner appears only for an open Critical signal or an **Agent at risk**
  status, and only after the agent answers its first real customer (or three days after
  the account was created, whichever comes first); finishing the setup wizard does not
  bring that moment forward. Until then the Home card is the guide, with one exception:
  if a channel you connected cannot answer — the connection stopped working, the agent
  has no channel assigned, no agent handles that channel, or WhatsApp cannot deliver —
  the banner shows anyway and names the reason. You can **Review**, **Ask
  Assist**, or **Snooze for 24 hours**.
- Snoozing hides that signal temporarily; it does not fix it. These alerts stay in
  the dashboard and do not send email or push notifications.

## The three evidence layers

- **Preparation:** checks business and scope, knowledge, conversation and brand,
  actions, safety and handoff, and operational robustness. A capability outside the
  agent's scope can be **Not applicable** and does not lower the result. The overall
  status is decided by the **essentials** (channel, agent, business, team) and any
  real problem; an unfinished mission or a test that hasn't run stay as pending, but
  they do not mark an agent that already answers as "not ready". For example,
  while the business hasn't confirmed the example prices its industry recipe
  seeded (services and, for a gym, membership plans), it shows the non-critical
  **Unconfirmed example prices** warning: the agent doesn't state those prices until they are confirmed.
- **Tested quality:** shows the latest critical evaluation and simulation, including
  version, date, threshold, and scenarios. Earlier evidence can become outdated when
  the agent changes. It is automated evidence, not a certification.
- **Production:** uses real interactions attributed to the agent and its version. It
  keeps verified resolution, observed conversational quality, handoffs, tool failures,
  and knowledge gaps separate. When the sample is still too small, the result is
  **Insufficient evidence**, not zero.

Historical evidence that does not identify the agent unambiguously is not assigned
retroactively. A newly saved version may therefore need new interactions before
it has a useful production signal.

## What "Operational channel connection" actually checks

This **Preparation** check separates three things that are easy to confuse:

- **Assignment** — the agent editor has those channels ticked for this agent.
- **Connection** — that account exists and is active under **Administration → Channels**.
- **Credential** — the permission is still valid, so the channel can still send replies.

A channel ticked on the agent but not connected **no longer blocks** the agent when
another assigned channel is working: it appears as **Assigned channel coverage**, a High
action that is not critical, with how many assignments the agent has, how many are
connected, and which ones have no connection.

**Operational channel connection** blocks as critical in only two cases:

- no assigned channel can **receive** messages (no active connection), or
- a credential **needs re-authorisation** (expired, revoked, in error, or absent), so the
  agent cannot **send** the reply.

A separate critical check covers assignments that are not a certified conversational
channel at all: **Operational channel scope** rejects an agent assigned to a channel type
that does not carry conversations (for example SMS, which only sends notifications, or
email, which has no certified self-service configuration today). Disconnecting it is not
enough: untick that type in the agent editor and leave only certified channels — WhatsApp,
Instagram, Messenger, Telegram, or the web chat.

A binding that points at an account that no longer exists (for example, the number was
reconnected and its identifier changed) counts as an assignment without a connection:
tick the current account again in the agent editor to fix it.

## Channels nobody answers and WhatsApp that can't deliver

Two critical **Preparation** checks explain an agent that doesn't answer even though the
channel shows as connected:

- **Every connected channel has an agent that replies**. It goes through every active
  connection of the business with the same rule Parallly uses when a message arrives:
  first the agent assigned to that account, then the one assigned to that channel type
  and, if there is none, the default agent. It fails when a connected channel has nobody
  to answer it (no agent has it assigned and there is no active default agent) or when two
  agents claim it at once: Parallly doesn't choose for you, and neither answers. Messages
  arrive but go unanswered. It appears only once, on the default agent (or, if there is
  none, on the oldest active one). You fix it in the agent editor: assign that channel to a
  single agent or make one the default; **Show me where** points to the spot.
- **WhatsApp can deliver replies**. For each WhatsApp number the agent answers, it looks at
  what Parallly checks before sending a reply. It fails — and no reply goes out from that
  number — when the number's **billing time zone** is missing; when Meta **won't charge**
  the WhatsApp account; when the account **has no payment method** in Meta, from 1 October
  2026 (before that date it is a warning, not a block); or when the **currency** Meta bills
  in is unknown and **Spend protection** is on (in **Observe only**, the initial setting, it
  stops nothing and is not reported).

For the second one, **Review** takes you to **Channels → WhatsApp**: the time zone is
confirmed right there and replies go out again; the payment method is added in Meta's
tools and then, if the number was paused, you press **Resume sending** or **Check with
Meta**; the currency is solved by reconnecting the number or setting spend protection
back to **Observe only**. It has no guided tour, and **Channels** is an admin screen: a
Supervisor sees the check, but the fix belongs to the Admin.

When they fail, both show in **Agent health**, in the channel step of the **Getting
started** card, and in the global banner, even before the first real reply: they are
exactly why an agent doesn't answer.

## What happens when you click Review

**Review** opens the screen where the change is made and, at the top of that screen, a
**context bar** explains why you are there. It shows the pending action, the affected
agent, a plain-language explanation with the evidence from the check (for example,
"assigned to 2 channels, 1 connected, not connected: instagram"), and up to four buttons:
**Show me where**, **Ask Assist**, **Snooze for 24 hours**, and close. **Show me where**
appears only when a tour covers that signal and your role can run it; otherwise the bar
shows the other three. It is part of the
screen, not a notification: nothing is sent anywhere, and it disappears when you close it
or return to that screen without that link.

**Review** no longer drops you at the door: the link carries the tab and the field, so the
editor opens that tab, scrolls to the field, and highlights it. If the signal is the
fallback message, you land with that field marked; same for the rules or the assigned
channels. You do not have to comb through a long form looking for what was missing.

## Show me where (guided tour)

**Show me where** opens the right screen and highlights, step by step, where the change is
made: which field, which tab, which button. The tour **does not change** any
configuration; it only points at the place, and the person decides what to type and when
to save. It runs on desktop, where those dashboard elements live. Admins get the editing
tours (connect a channel, assign channels to an agent, handoff rules); Supervisors get the
review tours (Quality center, production evidence). Two tours also reach the **agent**
role: the help-system tour (where each screen's help lives) and the first-inbox-
conversation tour. You can also ask for it in the chat:
when you ask Assist where or how to do something that has a tour, the answer includes that
button.

## How to interpret the status

- **Not evaluated yet:** there is not enough evidence yet.
- **Configuration incomplete:** a requirement is missing or preparation has a warning.
- **Agent at risk:** a critical test or important real signal needs review.
- **Ready for a controlled pilot:** preparation and tests support limited use, but
  real-world evidence is still insufficient.
- **Operating with evidence:** configuration, current tests, and a useful production
  sample are available.
- **Review required:** evidence became outdated or recent performance deteriorated.

No status means the agent is perfect, certifies its operation, or guarantees business
results.

## What to improve first

Parallly keeps status snapshots and signals by agent, version, and cause. Agent
changes, QA results, evaluations, and simulations refresh the evidence. Recurrences
are grouped to avoid duplicate alerts, and a bounded periodic pass recovers missed
events. A signal can be open, acknowledged, snoozed, resolved, or superseded.
Acknowledging or snoozing manages attention; only new evidence resolves the signal.

Open Critical and High recommendations first. Each identifies the affected pillar and
dimension and, when available, how many scenarios or interactions produced the signal.
Use them to distinguish among:

- **Strengthen knowledge:** information is missing or the source was not retrieved.
- **Adjust behavior:** the information existed, but the agent asked, explained,
  refused, or handed off incorrectly.
- **Repair a capability:** a tool, connection, policy, approval, or human route failed.

The Quality center does not automatically rewrite prompts, policies, or content. An
Admin makes the change, reruns the tests, and checks whether new evidence confirms the
improvement; a Supervisor can review results and coordinate follow-up.

## Ask Parallly Assist

From Home or the global banner, **Ask Assist** opens the chat for the selected agent
and signal. The server validates the tenant, role, agent, and signal, and Assist
explains one priority using the current state. An Admin may receive a repair route; a
Supervisor receives the review route without gaining edit permission.

The context contains only status, version, milestone, blocker codes, test freshness,
sample sizes, severity, pillar, dimension, and counts. It excludes transcripts,
customer text, conversation IDs, prompts, retrieval queries, free-form judge text,
and secrets. Assist does not apply changes or start external communications.

Beyond the agent status, Assist also receives the **list of the business's connected
channels** (channel type, how many accounts, and their credential state) and the bounded
evidence of the check: counts and channel types, never names, numbers, or identifiers.
That is why it can tell you which channel is working and which one is missing, instead of
claiming that you have no connected channels.

## Frequently asked questions

**Is the setup checklist the same as the Quality center?**
No. The **Getting started** card on Home shows only the four essentials (channel,
agent, business, and team) available for your plan and role, flags the **Next** step,
and disappears when they are complete. It replaces the old floating `8/9` pill. Agent
health adds what improves the agent (mission, knowledge, hours, appointments,
catalog), tests, and production evidence.

**Is a strong simulation score enough to let it handle conversations on its own?**
No. It helps reduce risk, but review it together with critical blockers, version
freshness, and real evidence when available.

**Does the system learn and change itself after every conversation?**
No. Interactions create diagnostics and recommendations; a person reviews and
approves any change before it is tested again.
