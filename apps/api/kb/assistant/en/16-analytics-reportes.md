---
id: analytics-reportes
title: "Analytics and reports"
routes: ["/admin", "/admin/analytics-v2", "/admin/crm-analytics", "/admin/agent-analytics", "/admin/report-builder", "/admin/settings/alerts"]
roles: ["tenant_admin", "tenant_supervisor", "tenant_agent"]
keywords: ["analytics", "metrics", "reports", "statistics", "kpi", "dashboard", "csat", "satisfaction", "survey", "funnel", "pipeline velocity", "win loss", "won lost deals", "custom report", "scheduled report", "export csv", "agent performance", "resolution rate", "conversion rate"]
---

# Analytics and reports

Parallly measures everything that happens in your conversations and sales so you can make decisions with data. Analytics live in the sidebar, under the **Management** section, inside the **Analytics** menu, which groups five views: **Overview**, **CRM Analytics**, **Agent performance**, **Attribution** and **Custom Reports**.

Full analytics are for administrators and supervisors. Users with the agent role see only their own metrics.

## The main dashboard

When you log in you land on the **Dashboard**: your overview for the day. It adapts to your industry — a clinic sees "Appointments today" and "New patients"; a restaurant sees "Orders today" and "Daily revenue"; a general business sees "Conversations today", "New leads" and "Response rate". If your account is new, you'll also see a checklist with the steps still pending to activate it (connect a channel, customize your agent, and so on).

## How to see your general business metrics

1. In the sidebar, open **Analytics** → **Overview**.
2. Pick the period at the top: **7 days**, **30 days**, **90 days** or **Custom** (a date range of your choosing).
3. Move through the tabs: **Overview** (conversations, messages, AI resolution, response time, average CSAT), **AI & Bot**, **AI Resolution**, **Quality (QA)**, **CRM & Sales**, **Agents**, **Automation**, **Campaigns**, **Channels**, **CSAT**, **Anomalies** and **Cohorts**.
4. Use **Export CSV** to download the data and work with it in your spreadsheet.

### The AI resolution rate

On the **AI Resolution** tab you can see what percentage of conversations your AI agent resolved on its own, without a human having to step in, along with its trend over time and the breakdown by channel. As a reference:

| Rate | What it means |
|------|---------------|
| Over 80% | Excellent: your agent and knowledge base are well tuned |
| 60–80% | Good: review which questions go unanswered so you can improve |
| Under 60% | Needs attention: you're probably missing FAQs, or your escalation rules are too sensitive |

If the rate is low on a specific channel, look at the type of questions coming in there: perhaps that audience needs its own content in your knowledge base.

## How to review your agents' and channels' performance

1. Go to **Analytics** → **Agent performance**.
2. At the top you see four indicators for the period: **Conversations**, **Avg. response time**, **Resolution rate** and **Average CSAT**.
3. Go through the tabs:
   - **Summary** — daily conversation volume.
   - **Agents** — a comparison table by agent (conversations, resolved, response time and CSAT), with an **AI** or **Human** badge.
   - **Channels** — how many conversations arrive through each channel and what percentage of the total they represent.
   - **CSAT** — your customers' satisfaction (see below).

If your role is agent, in this same section you see only your own numbers: your conversations, your response time and your results.

## How satisfaction measurement (CSAT) works

When a conversation closes, Parallly can send the customer a short survey through the same channel where they chatted: it asks for a rating from **1 to 5** (where 5 is very satisfied) and an optional comment.

The results appear on the **CSAT** tab of **Agent performance**:

- **Average CSAT** for the period, with the total number of responses.
- **Distribution by stars** — how many customers rated 5, how many rated 4, and so on.
- **Recent comments** — exactly what your customers wrote.

On top of that, every time a customer answers a survey, the notification bell lets you know.

## How to analyze your sales funnel (CRM Analytics)

1. Go to **Analytics** → **CRM Analytics**.
2. At the top you see the key indicators: **Total leads**, **Active opportunities**, **Pipeline value**, **Average score** and **Conversion rate**.
3. Explore the tabs:
   - **Summary** — leads by stage, lead sources, and the **Won vs Lost** block: how many deals you won, how many you lost, your **Win rate**, the total value won and the most frequent **Loss reasons**.
   - **Funnel** — how your contacts move stage by stage and where they drop off.
   - **Velocity** — how many days an opportunity spends on average in each stage. If a stage piles up a lot of days, that's your bottleneck.
   - **Agents** — a team ranking by deals closed and value sold.

The **Attribution** view (in the same **Analytics** menu) complements this by measuring the full path of your ads: clicks → conversations → leads → sales, with the return of each ad campaign.

## How to create a custom report

If you need a report with exactly the metrics you care about:

1. Go to **Analytics** → **Custom Reports**.
2. Click **New report**.
3. Type the **Report name** (e.g. "Weekly performance") and an optional **Description**.
4. Choose the **Chart type**: **Bar**, **Line**, **Area** or **Pie**.
5. Under **Select metrics**, check the ones you want to combine. They're grouped into **Conversations** (conversations, messages, transfers), **Artificial intelligence** (AI resolution, containment), **Performance** (response and resolution times), **CRM** (leads, conversion rate, pipeline value) and **Operations** (appointments, no-shows, campaigns, CSAT).
6. Adjust the **Date range** and check the **Preview**.
7. Click **Save**.

Your saved reports stay on the same page, ready to consult whenever you like. Each one has options to **Edit**, **Duplicate** (handy for creating variants) and **Delete**.

## How to receive automatic reports by email

You can get a summary of your indicators in your inbox without opening the dashboard:

1. Go to **Settings** → **Integrations & alerts** section → **System alerts**.
2. Scroll down to **Scheduled reports**.
3. Choose the **Frequency**: **Weekly (Monday 8 AM)** or **Monthly (1st, 8 AM)**.
4. Under **Recipients**, enter the email addresses separated by commas.
5. Check the box to mark it **Enabled** and click **Save changes**.

Below you'll see the date of the last send. Scheduled reports are available from the **Pro** plan onward.

On that same page you can create **system alerts**: email notifications when a metric crosses a limit you define (active conversations, messages for the day, escalations, among others). They're checked every 15 minutes.

## Frequently asked questions

**Who can see the analytics?**
Administrators and supervisors see everything. Agents see only their own metrics under **Agent performance**.

**Why does a tab say "no data"?**
The chosen period has no activity. Widen the date range (for example, from 7 to 30 days) or check that your channels are connected and receiving conversations.

**Can I download the data?**
Yes: use **Export CSV** in the Analytics Overview, or set up **Scheduled reports** to receive them by email.

**Are scheduled reports on every plan?**
No. They're available on the **Pro**, **Enterprise** and **Custom** plans. On Emprendedor and Starter you can consult all analytics inside the dashboard.

**How do I improve my CSAT?**
Read the **Recent comments** on the CSAT tab: that's where your customers tell you what to adjust. It usually helps to fine-tune your AI agent's tone, complete your knowledge base, and respond quickly to escalated conversations.

Need more help? Write to us at https://parallly-chat.cloud/support
