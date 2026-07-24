---
id: pipeline
title: "Sales funnel (pipeline)"
routes: ["/admin/pipeline", "/admin/settings/pipeline"]
roles: ["tenant_admin", "tenant_supervisor", "tenant_agent"]
keywords: ["funnel", "sales funnel", "pipeline", "kanban", "stages", "opportunities", "deals", "auto-advance", "automatic progression", "move card", "drag and drop", "probability", "stage colors", "deal approval", "approve", "reject", "re-sync", "multiple pipelines", "won stage", "lost stage"]
---

# Sales funnel (pipeline)

The sales funnel is your kanban board: every sales opportunity is a card and every column is a stage in your process (for example: new → qualified → proposal → won). You'll find it in the sidebar under **Sales Funnel**.

Each contact shows up as **a single card**, even if they message you through several channels, so the board doesn't fill up with duplicates.

At the top of the board you'll see four indicators: **Total value** (the sum of all open opportunities), **Weighted** (value × probability of each opportunity's current stage), **Opportunities** (how many there are) and **Average** (average value per opportunity).

## How to create an opportunity

1. Go to **Sales Funnel** in the sidebar.
2. Click **New deal**.
3. Fill in the form: **Contact**, **Title** (e.g. "Product X sale"), **Value ($)**, initial **Stage** and optional **Notes**.
4. Save. The card appears in the column of the stage you chose.

On top of that, when your customers chat with the AI agent, opportunities are created and moved forward automatically (see "Auto-advance" below).

## How to move an opportunity to another stage

Simply **drag the card** to the column you want. All roles (admin, supervisor and agent) can move cards.

Two things can block the move:

- **Stage conditions**: if the target stage requires certain data (email, phone, full name, minimum score, assigned rep, booked appointment or an active quote), you'll see a message telling you exactly what's missing.
- **Approval**: if the stage requires approval, the card stays in **Pending approval** until a supervisor or admin reviews it.

Clicking a card opens the deal detail: value, **Probability**, **Days in stage**, **Stage history**, assigned owner, and shortcuts to **View conversation** and **View contact**. From there you can also **Archive** the opportunity (it gets marked as lost).

## How to customize the stages (order, color and probability)

Admins and supervisors only. There are two ways in: the **Customize stages** button on the board, or **Settings → Pipeline Stages**.

1. **Drag** the stages to reorder them.
2. Edit each stage's **Name**, **Color** (8 colors available) and closing **Probability**. The probability feeds the **Weighted** indicator on the board.
3. Mark your closing stages as **Terminal stage (closed)** — for example "Won" and "Lost". The rest stay as **Active stage**.
4. Use **Add stage** to create new ones, or delete the ones you don't use.
5. If you'd rather start from a template, use **Load Industry Presets** to load the typical stages for your industry, or **Reset to defaults** to start over.
6. Save your changes (you'll see the "You have unsaved changes" notice while edits are pending).

### Conditions for entering a stage

On the same page, each stage has its **Transition Conditions** section: rules the contact must meet before entering that stage. You can require a registered email, phone number, full name, a minimum score, an assigned rep, a booked appointment, an active commercial quote, or a custom attribute with a specific value. If you don't set any conditions, the move is unrestricted.

## How to turn auto-advance on or off

With **Auto-advance** on, the AI agent moves opportunities through the funnel based on signals from the conversation: interest shown, price questions, buying intent, a booked appointment, and so on. It's on by default.

To turn it on or off:

1. Go to **Sales Funnel**.
2. In the board header, use the **Auto-advance** toggle.

If you turn it off, you and your team manage the stages manually and the AI doesn't move anything. You can turn it back on whenever you like.

Next to the toggle is the **Re-sync** button: it re-aligns existing opportunities with the stage they should be in based on their conversations. When it finishes you'll see how many were updated (e.g. "12 opportunities re-synced"). It's handy after changing your stages or after having auto-advance off for a while. The same option exists in **Settings → Pipeline Stages**, under the **Automatic stage progression** section.

> Auto-advance also respects your **Transition Conditions**: if the contact doesn't meet a stage's requirements, the AI won't move them there.

## How deal approval works

For sensitive stages (for example, "Closing") you can require a supervisor to approve the move:

1. An agent moves the card to the stage that requires approval → the card shows the **Pending approval** badge.
2. A supervisor or admin reviews it and chooses **Approve** or **Reject** (when rejecting, they enter the **Rejection reason**).
3. Only once approved does the opportunity move to the target stage.

## How to have more than one funnel

If you run different sales processes (e.g. direct sales vs. after-sales), you can create several pipelines, each with its own board and stages:

1. In **Sales Funnel**, use the tab selector at the top and click **New pipeline**.
2. Give it a **Name** (e.g. "Services pipeline") and an optional **Description**.
3. Switch between pipelines by clicking their tab. From a deal's detail view you can move it to another pipeline (it enters the first stage of the new one).

If you delete a pipeline, its deals move to the default pipeline; the default pipeline can't be deleted.

### Limits per plan

| Plan | Pipelines | Stages per plan |
|------|-----------|-----------------|
| Emprendedor | 1 | 3 |
| Starter | 1 | 5 |
| Pro | 3 | 15 |
| Enterprise | 10 | Unlimited |
| Custom | Unlimited | Unlimited |

> **Tip:** use separate pipelines when the processes are genuinely different. To split by product within the same process, tags or custom fields work better.

## Frequently asked questions

**Why can't I move a card to a certain stage?**
That stage has **Transition Conditions** the contact doesn't meet yet (the message tells you what's missing), or it requires supervisor approval.

**Does auto-advance undo my manual moves?**
The AI only advances opportunities based on new signals from the conversation. If you want full control over the stages, turn off the **Auto-advance** toggle on the board.

**Who can edit the funnel stages?**
Admins and supervisors only. Agents can view the board and move cards.

**Why do I see a single card when the customer messaged me on both WhatsApp and Instagram?**
The funnel shows one card per contact, unifying their conversations across all channels.

**Can I recover an archived opportunity?**
When you archive it, the opportunity is marked as lost and leaves the board. Its history remains available on the contact's profile.

**Need more help?** Write to us at https://parallly-chat.cloud/support
