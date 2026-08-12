---
id: probar-agente
title: "Test your agent before going live"
routes: ["/admin/agent", "/admin/agent/simulation", "/admin/procedures"]
roles: ["tenant_admin"]
keywords: ["test agent", "simulation", "simulate conversation", "test chat", "scenarios", "synthetic", "historical", "baseline", "regression", "score", "agent quality", "evaluate agent", "procedures", "sop", "standard operating procedure", "compile steps", "trigger keywords", "step by step flow", "test bot", "before going live"]
---

# Test your agent before going live

Before letting your AI agent talk to real customers, it's worth checking how it responds. Parallly gives you three tools for that:

- **Test chat** — talk to the agent yourself, as if you were a customer.
- **Simulations** — dozens of "simulated customers" chat with your agent and an evaluator AI scores every conversation.
- **Procedures (SOP)** — write your processes in plain language so the agent follows them step by step, without improvising.

> These tools are available to the **admin** role. **AI Agent** and **Procedures** are under **AI & Growth**.

## How to chat with your agent (test chat)

This is the fastest way to see your agent in action:

1. In the sidebar, go to **AI & Growth** → **AI Agent**.
2. Open the agent you want to review.
3. Click the **Test agent** button.
4. Type as if you were a customer ("What are your prices?", "Do you have availability on Saturday?") and press **Send**.
5. **Reset** clears the conversation so you can start from scratch.

The test chat is a safe space: it doesn't create contacts, doesn't show up in your inbox, and doesn't touch any real conversation. Use it every time you change the personality, the rules, or the business information, to confirm the agent responds the way you expect.

## How to run a simulation

When you want a more thorough evaluation than a few manual messages, use simulations. Think of them as an automated "quality check" for your agent.

1. Open **AI Agent**, choose the agent, and select **Test agent**.
2. In the **New simulation** panel, pick the **Agent** you want to evaluate.
3. Under **Scenario source**, choose how the test customers are generated:
   - **Synthetic** — the AI generates varied, realistic customers from your industry: easy ones, skeptics, upset customers, price shoppers, and so on.
   - **Historical** — replays real conversations your customers already had, to see how the agent would handle them with its current setup.
4. Set the **Number of scenarios** to run (50 by default; you can adjust it).
5. (Optional) Under **Compare with (baseline)**, pick a previous simulation: its exact scenarios are reused to detect whether anything got worse after your changes.
6. Press **Run simulation**.

The simulation runs in the background: you can keep working and come back later. In the **History** panel you'll see each run with its status — **Queued**, **Running**, **Completed**, or **Failed** — and the progress of scored scenarios.

> **It's 100% safe:** the simulation never creates real appointments, orders, or discounts. The agent's actions are disabled during the test; nothing reaches your customers.

## How to read the results

When you open a completed simulation you'll see:

- **Average score** (0 to 10) — the overall quality of the agent's responses.
- **Resolution rate** — the percentage of conversations the agent managed to resolve.
- **Sub-scores by dimension** — **Resolution**, **Tone**, **Accuracy**, and **Empathy**, so you know exactly where the agent is strong and where it slips.
- **Regressions** — if you picked a baseline, you'll see **Regression detected** when a response got worse compared to the previous run, or **No regressions** if everything held steady or improved.
- **Scenario table** — click any scenario to see the full **transcript** (customer vs. agent) and the **issues** the evaluator found in that conversation.

**Recommendation:** run a simulation every time you change your agent's personality, rules, knowledge base, or procedures, and compare it against the previous baseline. That way you ship changes backed by evidence, not gut feeling.

## How to create a procedure (SOP)

Procedures teach your agent to run your business processes **step by step**: refunds, warranties, complaints, lead qualification… The agent decides how to phrase each message naturally, but the flow is controlled by the procedure — that's why it never skips or invents steps.

1. In the sidebar, go to **AI & Growth** → **Procedures**.
2. Choose how to create it:
   - **Write SOP** (recommended) — describe the procedure in plain language, for example: *"When a customer asks for a refund, ask for the order number and check its status; if delivered, offer a coupon, otherwise escalate to an agent."* Then press **Compile to steps**: the AI turns it into a sequence of concrete steps that stays as a **Draft** for your review.
   - **Blank** — build the steps manually, one by one, with **Add step**.
3. Review and adjust the steps. Each step is one of these types:

| Type | What it does |
|------|--------------|
| **Message** | Communicates something to the customer |
| **Ask** | Requests a piece of information from the customer and saves it (e.g., order number) |
| **Tool** | Performs an action (look up an order, search for a product…) |
| **Condition** | Evaluates a value and branches the flow based on the result |
| **Handoff** | Transfers the conversation to a person on your team |

4. Press **Save**.

### Activating the procedure

- Define the **Trigger keywords** (e.g., "refund, return, warranty"). When a customer mentions any of them, the procedure starts automatically.
- Use **Activate** to put it live or **Deactivate** to pause it without deleting it.
- Every change bumps the procedure's **version**, so you always know which version is in use.

**Tip:** after activating or modifying a procedure, try it in the test chat by mentioning one of its trigger keywords, then run a simulation to verify the rest of your conversations weren't affected.

## Frequently asked questions

**Can the simulation send messages to my real customers?**
No. Everything happens in an isolated environment: no real appointments, orders, discounts, or conversations are created, and no message goes out through your connected channels.

**What's the difference between the test chat and the simulation?**
The test chat is you talking to the agent: great for quick, targeted checks. The simulation runs dozens of varied conversations with automatic scoring: ideal before shipping major changes.

**What is the "baseline" and what is it for?**
It's a previous simulation you use as a point of comparison. By reusing its exact scenarios, Parallly can tell you whether a change you made **worsened** a response that used to come out fine (a "regression").

**What should I do if "Regression detected" appears?**
Open the flagged scenarios, read the transcript and the detected issues, adjust the agent's configuration (personality, rules, knowledge, or procedures), and run the simulation again against the same baseline.

**Does a good score guarantee the agent is perfect?**
No, but it greatly reduces the risk. As a reference: 8 or above is a good result; between 5 and 8, review the lowest-scoring scenarios; below 5, review the configuration before going live.

**Who can use these tools?**
Only the **admin** role. If you don't see these options in the menu and you need them, ask your account administrator for access. Questions? Write to us at https://parallly-chat.cloud/support
