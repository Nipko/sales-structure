---
id: base-conocimiento
title: "Agent knowledge base"
routes: ["/admin/knowledge", "/admin/knowledge/faqs"]
roles: ["tenant_admin", "tenant_supervisor"]
keywords: ["knowledge base", "knowledge", "upload documents", "pdf", "faq", "frequently asked questions", "import url", "web page", "crawl", "articles", "categories", "edit document", "versions", "quality", "suggestions", "gaps", "public portal", "help center for customers", "agent doesn't know the answer"]
---

# Agent knowledge base

The knowledge base is your AI agent's "memory": the documents, FAQs and pages you upload here are the information it uses to answer your customers. The more complete and up to date it is, the more accurate its replies.

You'll find it under **AI & Growth → Knowledge Base**. Inside you'll see the **Library**, **FAQs**, **Search in context**, **Quality**, **Analytics** and **Gaps** tabs.

> This section is managed by the **administrator** and **supervisor** roles.

## Availability and capacity

The screen shows whether documents, web importing, and analytics are enabled, together with current usage. If you reach capacity, you'll see **Document limit reached**; check **Plan & Billing**.

## How to upload documents (PDF, Word and more)

1. On the **Library** tab, click **Bulk import**.
2. Click **Select files**. Supported formats: **PDF, DOCX, TXT, MD, CSV** (up to 20 files per batch).
3. If you want, type a **category** for all the files (for example, "Pricing" or "Policies").
4. Click **Upload all**.

When it finishes you'll see a summary of how many were imported successfully. Each document is processed and marked **Ready** so the agent can use it in its replies.

## How to create an article by writing the text

1. In **Library**, click **Create**.
2. In the **New knowledge resource** window, enter the **Resource title** and paste or write the **Text content** (policies, promotions, internal manual, whatever you need).
3. Save and you're done: the agent can use it right away.

## How to import a web page (with automatic updates)

When web importing is enabled:

1. In **Library**, click **Import URL**.
2. Enter the **Page URL** (for example, your site's FAQ page). The **Title** is optional: it's detected automatically.
3. Click import. Parallly reads the page and turns it into an article in your knowledge base.

Imported pages stay current on their own: **once a week the platform reviews them automatically** and, if the content changed, it updates the article. You can also force it anytime with the document's **Refresh content** button — if nothing changed you'll see "No changes detected".

## How to create FAQs

FAQs are question-and-answer pairs the agent uses to give exact replies, word for word when needed.

1. Go to the **FAQs** tab.
2. Click **New FAQ**.
3. Fill in **Question** and **Answer** (both required). You can add a **Category**, **Tags** and the **Order** in which it appears.
4. Keep the **Published (visible to agent)** option enabled so the agent uses it.
5. Click **Save**.

> Tip: use FAQs for anything that should always be answered the same way (prices, hours, return policies), and documents for longer information.

## Organizing with categories and languages

- When creating or editing any document you can assign it a **category**. In **Library** they appear as one-click filters so you can find everything faster.
- Each document's language is **detected automatically**. If you have content in several languages, a language filter appears; the agent prioritizes content in the language the customer is writing in.

## Editing an article and restoring earlier versions

- To edit: in **Library**, click the document's **edit** button (pencil) and change its name, content or category. Save with **Save changes**.
- Every edit creates a new version. With the **Version history** button (clock icon) you can view earlier versions and click **Restore** to go back to one of them.

## Quality and AI suggestions

- On the **Quality** tab, each document gets a score from 0 to 100 based on its content, whether it has a category, how often it's queried and how relevant it is in replies. Start by improving the ones in red.
- On the **Analytics** tab, the **Article suggestions (AI)** section analyzes the questions your customers asked that the agent couldn't answer, and proposes new articles with an outline. Click **Generate suggestions** and then **Create** on the one you want to write.

## Analytics: what's queried and what's missing

When enabled, the **Analytics** tab shows:

- **Unique queries**, **hit rate** and the daily volume of the agent's searches in your knowledge base.
- **Most queried documents** — your star content.
- **Unanswered questions** — what customers asked that the agent couldn't find. From there you can **create an article** with one click or mark them as **Resolve**.

## Gaps: find the holes in your content

The **Gaps** tab organizes what needs your attention:

- **Unanswered queries** — create an article or FAQ that covers them.
- **Low satisfaction docs** — articles that got negative reactions from your team in the inbox; review and improve them.
- **Outdated docs** — content that hasn't changed in a long time (prices and policies tend to go stale).

In addition, the **KB Health — Contradictions** section detects information that contradicts itself across your documents (two different prices for the same thing, conflicting policies). Click **Scan now** and resolve whatever it finds.

> Tip: review Gaps once a week. Every gap you close is a customer better served.

## Public portal: a help center for your customers

You can publish part of your knowledge base as an online help center, with no password, so your customers can look things up on their own:

1. In **Library**, click the **Public/Private** button (globe-with-lock icon) on the document you want to publish. Published ones show the **Public** label.
2. Share your portal link: `https://admin.parallly-chat.cloud/kb/tu-identificador` (your business identifier in Parallly). Perfect for linking from your website or social media.

Only the documents you marked as public are shown; everything else stays private.

## How the agent uses your knowledge base

When a customer asks something, the agent searches your documents and FAQs for the most relevant fragments and uses them as sources to reduce unsupported answers. Like any generative AI, it can still make mistakes: test critical cases and keep the content current. To make this work:

- In **AI agent**, open your agent and, in its tools, make sure the **Knowledge base** card is enabled. Right there you can adjust how many fragments it uses per reply and how strict it is about relevance.
- Test what the agent would find with the **Search in context** tab: type a question the way a customer would, and you'll see the fragments the AI would use, with their relevance percentage. If nothing useful shows up, there's your next article.

## Frequently asked questions

**The agent replies "I don't have that information", what do I do?**
That's a sign content is missing. Type the same question in **Search in context**: if there are no results, create an article or FAQ that covers it. Also check **Analytics → Unanswered questions**, where that query was logged.

**Can I import my entire website?**
You can import page by page with **Import URL** up to the limit shown on screen. Start with your highest-value pages: FAQs, pricing, and policies.

**Do changes on my website show up on their own?**
Yes. Imported pages are reviewed automatically every week and updated if they changed. If you need the change now, use **Refresh content** on the document.

**Can my customers see my internal documents?**
No. Everything is private except what you mark as **Public** for the help portal. The agent does use all content (public and private) to answer, but it never shows the documents themselves.

**I edited a document and it turned out worse, can I go back?**
Yes. Open the document's **Version history** and click **Restore** on the earlier version.

**Why don't I see the Analytics tab with data?**
Knowledge analytics must be enabled and fill with real customer conversations. If you just started, give them time to collect data.

Need more help? Write to us at https://parallly-chat.cloud/support
