---
id: inbox
title: "Inbox and human support"
routes: ["/admin/inbox", "/admin/settings/macros", "/admin/settings/integrations/sms-notifications"]
roles: ["tenant_admin", "tenant_supervisor", "tenant_agent"]
keywords: ["inbox", "handoff", "take conversation", "assist customer", "human agent", "return to bot", "internal notes", "macros", "quick replies", "canned responses", "snooze", "assign conversation", "resolve conversation", "copilot", "AI summary", "rewrite message", "AI suggestion", "notifications", "bell", "escalation"]
---

# Inbox and human support

The **Inbox** is where your team sees every conversation in real time and where a person can take over when the AI needs help. You'll find it in the sidebar, under **Operation → Inbox**.

The screen has three areas: on the left, the conversation list (with filters like **All**, **Mine**, **Unassigned**, **Handoff** and **Resolved**, plus filters by channel); in the center, the message thread; and on the right, the contact panel with their information, notes and appointments. Conversations from all your connected channels land here: WhatsApp, Instagram, Messenger, Telegram, Email and your website chat.

## How to take a conversation (handoff)

When a customer asks to speak with a person, or the AI detects it can't resolve the case, the conversation goes to "waiting for human" and the AI pauses.

1. Open the conversation from the Inbox (the ones waiting for attention are highlighted in the list).
2. You'll see an orange notice: **Human attention required** — "The AI assistant has been paused. The customer is waiting for a response from a human."
3. Click **Take conversation**. The conversation is assigned to you and you can now write to the customer directly.

You can also take any conversation at any time using the **Assign to me** button in the chat header, even if no one requested help. While the conversation is with you, the AI stays silent: the customer talks only with you.

## The AI summary when you take a conversation

So you don't have to read the entire history, when you open an escalated conversation you'll see a box with the **Conversation summary (AI)**: what the customer asked for, what was discussed, and why it was escalated.

You can also press **Summarize** at any time (above the message box) and the copilot shows you an instant summary, with the **Customer intent** and the **Pending** topics still to resolve.

## How to return the conversation to the AI

Once you've resolved the case:

1. Click **Resolve** in the conversation header.
2. Your work is done, the conversation is released, and the AI assistant takes over the customer's next messages again.

Conversations with no activity for 72 hours are marked as resolved automatically to keep your inbox clean. You can view them with the **Resolved** filter; there the history is read-only, and if you need to pick one up again, use **Reopen conversation**.

## Agent copilot: suggestions and rewriting

The copilot helps you reply better and faster:

- **AI suggestion**: in conversations you're handling, the copilot proposes a ready-to-use reply. Press **Use suggestion** to drop it into the message box (you can edit it before sending) or **Regenerate** to request another.
- **AI draft**: sometimes the AI prepares a draft for your approval. Review it and choose **Use draft** or **Discard**. Nothing is sent without your confirmation.
- **Rewrite**: write your reply however it comes out and let the copilot polish it. Next to the message box, press **Rewrite** and choose the tone: **Professional**, **Friendly**, **Empathetic**, **Shorter**, **Expand** or **Fix spelling**.

## Quick replies and macros

- **Quick replies**: in the message box, type **/** and the list of your team's predefined replies appears. Keep typing to filter and select one; the customer's details (like their name) fill in automatically.
- **Macros**: these are sequences of actions that run with one click (for example: tag, assign, leave a note and send a reply, all together). In the conversation, open the actions menu (⋯) and choose **Macros**.

To create macros, an admin or supervisor goes to **Settings → Macros** and presses **New macro**. Each macro combines actions like **Assign to agent**, **Add tag**, **Change status**, **Add note** or **Send predefined reply**, and can have **Personal** visibility (yours only) or **Team** visibility.

## Internal notes

Internal notes are comments between colleagues that the customer never sees.

1. In the conversation, open the actions menu (⋯) and choose **Internal notes**.
2. Type in the **Add internal note...** field and save.
3. The note stays visible to the whole team on that conversation and also in the contact's history.

Use them to leave context before passing a case to someone else ("VIP customer, already offered the 10% discount").

## Snoozing a conversation

If a case can't move forward right now ("call me on Monday"), don't leave it taking up space in your inbox:

1. Open the actions menu (⋯) and choose **Snooze**.
2. Choose when it should come back: **1 hour**, **3 hours**, **Tomorrow 9am** or **Next Monday**.
3. The conversation is hidden from the active view and reappears automatically on the chosen date.

## Assignment between agents

- Each conversation can have an owner. Use the **Mine** filter to see only your own, and **Unassigned** to find orphaned conversations.
- Any team member can take a conversation with **Assign to me**; if it was already with someone else, an admin or supervisor can reassign it.
- If you set up **skills** in your team's profiles (**Users** menu), Parallly automatically routes each escalation to the right person — for example, English-language cases to the agent who speaks English.
- Macros can also assign to a specific agent as part of their actions.
- If an escalated conversation goes more than 5 minutes without a response, supervisors receive an alert so no one is left waiting.

The number of people who can use Parallly depends on your plan: Emprendedor includes 1 user, Starter 3, Pro 5, and Enterprise and Custom have no limit.

## Notifications

The **bell** in the top bar gathers all alerts and groups them by category: **Messages**, **Transfers** (escalations to a human), **Privacy**, **Appointments**, **Automation**, **Orders** and **System**. Direct escalations (the customer asked for a human) are highlighted in red; escalations due to low AI confidence, in yellow; and supervisor alerts arrive with sound.

If your plan is Pro or higher, you can also receive an SMS when the AI escalates a conversation: turn it on in **Settings → Integrations → SMS alerts**.

## Teamwork without stepping on each other

If two people open the same conversation at once, both see a colored label with the other person's name below the header. This way you avoid replying to the same customer twice. It works on its own, with nothing to set up: the label disappears when the other person closes the conversation.

## Frequently asked questions

**Does the AI keep replying while I'm handling the conversation?**
No. From the moment you take the conversation, the AI is paused and the customer talks only with you. It reactivates when you press **Resolve**.

**Does the customer see internal notes or AI summaries?**
No. Notes, summaries and copilot suggestions are for your team only. The customer only receives what you send from the message box.

**What happens if no one takes an escalated conversation?**
It keeps showing in the pending filter and, if more than 5 minutes pass without a response, supervisors receive an alert with sound so they can step in.

**Can I make sure certain cases always reach the same person?**
Yes. Set up skills in your team's profiles (**Users** menu) for automatic routing, or create a macro with the **Assign to agent** action.

**Is a snoozed conversation lost if the customer writes before then?**
It's not lost: the conversation reappears automatically on the date you chose and the full history is preserved.

Need more help? Write to us at https://parallly-chat.cloud/support
