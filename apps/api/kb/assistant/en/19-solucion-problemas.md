---
id: solucion-problemas
title: "Troubleshooting common issues"
routes: ["/admin/channels", "/admin/agent", "/admin/inbox", "/admin/broadcast", "/admin/appointments", "/admin/settings/billing"]
roles: ["tenant_admin", "tenant_supervisor", "tenant_agent"]
keywords: ["troubleshooting", "not working", "messages not arriving", "not responding", "bot not responding", "channel disconnected", "token expired", "reconnect", "campaign won't send", "template rejected", "plan limit", "limit reached", "appointment missing", "calendar not syncing", "verification email", "code not arriving", "error", "help", "support", "contact support"]
---

# Troubleshooting common issues

Something not working the way you expected? This guide gathers the most common issues and how to fix them step by step. If none of this solves it, at the end we explain how to reach support.

## Messages from a channel aren't arriving

If your customers write to you but the messages don't show up in the **Inbox**:

1. Go to **Channels** in the sidebar and find the card for the affected channel.
2. Check the connection status: if it says **Disconnected** or you see a notice like "**Token expired. Please reconnect your account**", that's the cause. Follow the steps in the next section to reconnect.
3. If you have **several accounts on the same channel** (for example, two WhatsApp numbers), confirm the customer wrote to the number or account that is connected: each connection is independent.
4. Test it yourself: send a message from another phone or account and check whether it appears in the **Inbox** within a few seconds.
5. If the channel shows as **Connected** and messages still aren't arriving, write to support with the channel, the approximate time, and an example of the message that didn't come through.

> Only the **administrator** role can connect, reconnect, or disconnect channels. Supervisors and agents can see the status, but can't change it.

## Channel disconnected or token expired: how to reconnect

Authorizations for some channels can expire over time or become invalid if you change the password or the account's permissions (for example, on Instagram or Facebook).

1. Go to **Channels** and open the channel card.
2. Click **Reconnect** (or **Connect**, if it shows as disconnected).
3. Sign in again with the provider (Meta, Google, etc.) and approve the permissions.
4. Done: the connection is active again and **your conversations and history stay intact**.

Helpful details:

- **Instagram** uses an authorization that lasts 60 days. Parallly renews it automatically, but if the renewal fails (password or permissions changed) you'll get an alert and see the token-expired notice on the card: there you just need to click **Reconnect**.
- Reconnecting **doesn't delete anything**: contacts, conversations, and agent settings stay the same.

## The AI agent isn't responding (or responds poorly)

Run through this list in order; the cause is almost always one of these:

1. **Does the connection have an agent assigned?** Go to **AI Agent**. If you see a notice like "channels without an assigned agent", those connections are handled by your default agent with a generic setup. Open the correct agent and, under **Connection assignment**, check the exact account it should handle. Remember: there's **one AI agent per connection**.
2. **Is the agent active?** In the agent list, make sure it isn't **paused**.
3. **Is it within its working hours?** In the agent editor, check the **Working hours** card: outside that range the agent doesn't respond automatically.
4. **Is the response mode correct?** Under **Behavior**, if the mode is set to "always human", the AI never replies on its own. Switch it to "always AI" or "hybrid" depending on what you need.
5. **Is the conversation with a human?** If you or someone on the team took over the conversation in the **Inbox** (or the customer asked to speak with a person), the AI stays paused in that conversation until **Resolve** is clicked. This is expected behavior, not a failure.
6. **Did you run out of AI messages for the month?** Go to **Settings → Billing** and look at the AI message usage bar. Each plan includes a monthly amount (for example, Emprendedor 1,000 and Starter 5,000); if it runs out, upgrade your plan or wait for the monthly reset.

If the agent **responds, but responds poorly** (makes up data, doesn't know your prices, or goes off topic):

- Feed the **Knowledge Base**: the agent answers with what you teach it. Add or correct articles and FAQs with your business's official information.
- Adjust the **rules** and the **forbidden topics** in the **Behavior** card of the agent editor.
- Test the changes without affecting real customers in **AI Agent → Test agent**: it's a simulator where you chat with your own agent.

## I can't send a campaign

The most common causes when creating or sending a campaign in **Campaigns**:

- **Your plan doesn't include campaigns or you reached this month's cap.** Emprendedor doesn't include campaigns; Starter includes 3 per month; Pro, Enterprise, and Custom have them unlimited. If you hit the cap you'll see the limit notice with the **Upgrade plan** option.
- **The WhatsApp template isn't approved.** To message customers who haven't written to you in the last 24 hours, WhatsApp requires a template reviewed and approved by Meta. Check the status in **Channels → WhatsApp → View all templates**: it must show as **Approved** (Meta's review usually takes anywhere from a few minutes to 72 hours). If it was **Rejected**, you'll see the reason; fix the text and submit it again.
- **Some recipients don't receive it.** It's normal for a few to fail: contacts who opted out (they get no more broadcasts) or numbers that no longer exist. You can see this in the campaign metrics.
- **Multiple numbers connected**: make sure you chose the correct **sender number** when creating the campaign.

## I reached my plan's limit

When a resource hits its cap (agents, contacts, campaigns, AI messages, etc.), the platform warns you with a message like "You've reached your current plan's limit" and you won't be able to create more of that resource.

- In **Settings → Billing** you'll see the usage bars: amber warning at **80%** and red alert at **95%** with the **Upgrade plan** button.
- Upgrading takes effect **instantly**: you pay for the new plan and the limits expand right away.
- Monthly counters (AI messages, campaigns, multimedia) **reset on the first day of each month**.
- You can also free up space (for example, delete an agent or contacts you don't use) instead of upgrading.

## The appointment doesn't appear in my calendar

1. First confirm the appointment exists in Parallly: go to **Appointments** and look for it in the **Calendar** tab. If it isn't there, the booking wasn't completed (the customer may not have confirmed the last step).
2. If the appointment is in Parallly but not in your Google Calendar or Outlook, go to **Appointments → Settings → Connected calendars** and check that your calendar is still **connected**. If the connection expired, click **Reconnect**.
3. If you have **several calendars connected**, the appointment may have synced to another one: each appointment goes first to the calendar assigned to the **service**, if there's none, to the assigned **staff member's**, and if not, to the business's **general** calendar. Review those assignments in the service settings.
4. Syncing is fast but not always instant: wait a couple of minutes and refresh your calendar.

## I'm not receiving the verification email

When you sign up (or reset your password), Parallly sends you a **6-digit code** by email. If it doesn't arrive:

1. Check your **spam or junk** folder, and search for "Parallly" in your inbox.
2. Wait 2 or 3 minutes: some email providers delay delivery.
3. Make sure you typed your email address correctly and request a **new code** from the same screen.
4. If you use a company email, a corporate filter may block it; try another address or ask your IT team to allow it.
5. If nothing works, write to support and tell us the email you're trying to sign up with.

## How to contact support

If you followed the steps and the problem persists:

- Write to us at [parallly-chat.cloud/support](https://parallly-chat.cloud/support).
- You can also ask the **copilot** inside the panel: many questions get resolved on the spot.

To help you faster, include: what you were trying to do, on which channel or page it happened, the approximate time, and, if you can, a screenshot of the error.

## Frequently asked questions

**Does reconnecting a channel delete my conversations or contacts?**
No. Reconnecting only renews the authorization with the provider; all your history is preserved.

**Why did the AI stop responding in just one conversation?**
Because that conversation is assigned to someone on your team. While it's taken, the AI pauses; it responds again when **Resolve** is clicked in the Inbox.

**Who can reconnect channels or change the agent's settings?**
Only the **administrator** role. If you're a supervisor or agent and you spot the problem, let your administrator know.

**When do my plan's monthly limits reset?**
On the first day of each month. Fixed limits (agents, contacts, calendars) only change when you change plans.

**How long does Meta take to approve a WhatsApp template?**
Usually anywhere from a few minutes to 72 hours. The status (Pending, Approved, or Rejected) is shown in **Channels → WhatsApp**.
