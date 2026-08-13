---
id: analytics-reportes
title: "Analytics and reports"
routes: ["/admin", "/admin/analytics-v2", "/admin/crm-analytics", "/admin/agent-analytics", "/admin/report-builder", "/admin/settings/alerts"]
roles: ["tenant_admin", "tenant_supervisor"]
keywords: ["analytics", "metrics", "reports", "statistics", "kpi", "dashboard", "csat", "satisfaction", "survey", "funnel", "pipeline velocity", "win loss", "won lost deals", "custom report", "scheduled report", "export csv", "agent performance", "resolution rate", "conversion rate"]
---

# Analytics and reports

Parallly measures conversations and sales so you can make decisions with data. Under **Insights** you'll find **Analytics**, **CRM Analytics**, **Agent performance**, **Attribution**, and **Custom Reports**.

Analytics are for administrators and supervisors. Users with the agent role cannot access these views; they should request the information they need from a supervisor or administrator.

## The main dashboard

When you log in you land on the **Dashboard**: your overview for the day. It adapts to your industry — a clinic sees "Appointments today" and "New patients"; a restaurant sees "Orders today" and "Daily revenue"; a general business sees "Conversations today", "New leads" and "Response rate". If your account is new, you'll also see a checklist with the steps still pending to activate it (connect a channel, customize your agent, and so on).

## How to see your general business metrics

1. In the sidebar, open **Insights → Analytics**.
2. Choose one of the available periods or define a custom range.
3. Move through the tabs: **Overview** (conversations, messages, AI resolution, response time, average CSAT), **AI & Bot**, **AI Resolution**, **Quality (QA)**, **CRM & Sales**, **Agents**, **Automation**, **Campaigns**, **Channels**, **CSAT**, **Anomalies** and **Cohorts**.
4. Use **Export CSV** to download the data and work with it in your spreadsheet.

### The AI resolution rate

On the **AI Resolution** tab you can see what percentage of conversations your AI agent resolved on its own, without a human having to step in, along with its trend over time and the breakdown by channel. This is an operational signal, not a quality grade: a high rate can coexist with incorrect answers, while a low rate can reflect safe handoffs. If it changes sharply by channel, review the questions, assigned agent, and knowledge gaps.

## How to review your agents' and channels' performance

1. Go to **Insights → Agent performance**.
2. At the top you see four indicators for the period: **Conversations**, **Avg. response time**, **Resolution rate** and **Average CSAT**.
3. Go through the tabs:
   - **Summary** — daily conversation volume.
   - **Agents** — a comparison table by agent (conversations, resolved, response time and CSAT), with an **AI** or **Human** badge.
   - **Channels** — how many conversations arrive through each channel and what percentage of the total they represent.
   - **CSAT** — your customers' satisfaction (see below).

## How satisfaction measurement (CSAT) works

The **CSAT** tab in **Agent performance** displays ratings that have already been registered in the account:

- **Average CSAT** for the period, with the total number of responses.
- **Distribution by stars** — how many customers rated 5, how many rated 4, and so on.
- **Recent comments** — exactly what your customers wrote.

In the current release, closing a conversation does not automatically send or capture a survey through the channel, and it does not create a notification-bell alert. If you need to collect CSAT, use a process or integration enabled for your account and confirm that responses appear before relying on this view.

## How to analyze your sales funnel (CRM Analytics)

1. Go to **Insights → CRM Analytics**.
2. At the top you see the key indicators: **Total leads**, **Active opportunities**, **Pipeline value**, **Average score** and **Conversion rate**.
3. Explore the tabs:
   - **Summary** — leads by stage, lead sources, and the **Won vs Lost** block: how many deals you won, how many you lost, your **Win rate**, the total value won and the most frequent **Loss reasons**.
   - **Funnel** — how your contacts move stage by stage and where they drop off.
   - **Velocity** — how many days an opportunity spends on average in each stage. If a stage piles up a lot of days, that's your bottleneck.
   - **Agents** — a team ranking by deals closed and value sold.

The **Attribution** view (under **Insights**) complements this by measuring the full path of your ads: clicks → conversations → leads → sales, with the return of each ad campaign.

## How to create a custom report

If you need a report with exactly the metrics you care about:

1. Go to **Insights → Custom Reports**.
2. Click **New report**.
3. Type the **Report name** (e.g. "Weekly performance") and an optional **Description**.
4. Choose the **Chart type**: **Bar**, **Line**, **Area** or **Pie**.
5. Under **Select metrics**, check the ones you want to combine. They're grouped into **Conversations** (conversations, messages, transfers), **Artificial intelligence** (AI resolution, containment), **Performance** (response and resolution times), **CRM** (leads, conversion rate, pipeline value) and **Operations** (appointments, no-shows, campaigns, CSAT).
6. Adjust the **Date range** and check the **Preview**.
7. Click **Save**.

Your saved reports stay on the same page, ready to consult whenever you like. Each one has options to **Edit**, **Duplicate** (handy for creating variants) and **Delete**.

## How to receive automatic reports by email

You can get a summary of your indicators in your inbox without opening the dashboard:

1. Go to **Settings → Governance & alerts → System alerts**.
2. Scroll down to **Scheduled reports**.
3. Choose one of the frequencies and delivery times available for your account.
4. Under **Recipients**, enter the email addresses separated by commas.
5. Check the box to mark it **Enabled** and click **Save changes**.

Below you'll see the date of the last send. If the option is missing, check its availability in **Plan & Billing**.

On that same page you can create **system alerts**: email notifications when a metric crosses a limit you define (active conversations, messages for the day, escalations, among others). The platform evaluates them automatically.

## Frequently asked questions

**Who can see the analytics?**
Administrators and supervisors can access these views. Agents do not have direct access to analytics pages.

**Why does a tab say "no data"?**
The chosen period has no activity. Widen the date range (for example, from 7 to 30 days) or check that your channels are connected and receiving conversations.

**Can I download the data?**
Yes: use **Export CSV** in the Analytics Overview, or set up **Scheduled reports** to receive them by email.

**Are scheduled reports available for my account?**
The screen and **Plan & Billing** show current availability. The views you can consult remain visible according to your role and configuration.

**How do I improve my CSAT?**
Read the **Recent comments** on the CSAT tab: that's where your customers tell you what to adjust. It usually helps to fine-tune your AI agent's tone, complete your knowledge base, and respond quickly to escalated conversations.

Need more help? Write to us at https://parallly-chat.cloud/support
