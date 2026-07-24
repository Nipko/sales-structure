---
id: crm-contactos
title: "Contacts and CRM"
routes: ["/admin/contacts", "/admin/contacts/segments", "/admin/identity", "/admin/settings/custom-attributes"]
roles: ["tenant_admin", "tenant_supervisor", "tenant_agent"]
keywords: ["contacts", "crm", "leads", "customers", "score", "lead scoring", "stages", "segments", "filters", "import", "export", "csv", "excel", "duplicates", "merge", "archive", "bulk actions", "custom attributes", "custom fields", "vip"]
---

# Contacts and CRM

Parallly's CRM is where all your contacts live: every person who messages you through WhatsApp, Instagram, Messenger, Telegram, Email, or your website chat is registered here automatically, along with their full history. You can also add contacts by hand or import them from Excel.

You'll find it in the sidebar: open **CRM** and go to the first option, **CRM**. You'll land on the **Contacts** page, with a table showing name, channel, conversations, value, last interaction, score, stage, and tags. Up top you have quick chips to filter by group: **All**, **New**, **Leads**, **Qualified**, **Customers**, and **Churned**, plus a search box.

Every role can view, create, and edit contacts. Archiving and bulk actions are reserved for administrators and supervisors.

## How to create a contact manually

1. On **Contacts**, click **Add contact**.
2. Fill out the **New contact** form: **First name**, **Last name**, **Phone** (required), **Email**, and initial **Stage**.
3. Click **Create contact**.

> The phone number is cleaned and normalized automatically to the international format (it works with numbers from Colombia, Argentina, Mexico, Brazil, Chile, Peru, Ecuador, and the US/Canada). You can type `3001234567` or `+573001234567`: both are saved correctly.

## The contact detail (360° profile)

Click any contact to open their full profile:

- **Edit**: with the **Edit** button you change name, email, phone, stage, the **VIP** flag, and the **Tags** right in the profile. Save with **Save**.
- **Score breakdown**: click the score to see the 5 factors that make it up — **Recency**, **Engagement**, **Intent**, **Stage**, and **Profile**.
- **AI Insights**: automatic analysis of the contact's behavior (likelihood to close, next best action, detected signals).
- **Custom fields**: the extra attributes you've defined for your business (see below).
- **Opportunities**: this contact's open deals in the pipeline.
- **History** (activity timeline), **Notes** (internal team notes), and **Tasks** (follow-ups, calls, meetings) tabs.

### What is the score?

It's a rating that ranks your contacts by how "hot" they are: how recent their last interaction was, how much they talk, what buying words they use, what stage they're in, and how complete their profile is. Administrators and supervisors can adjust the weight of each factor under **Settings → Lead Scoring**, including decay (the score drops on its own if the contact goes many days without activity).

### Stages

Each contact has a sales stage (new, contacted, qualified, won, lost…). The stages are the same ones from your pipeline and are customized under **Settings → Pipeline stages**. You can change it from the contact's profile or let the AI agent advance it on its own (see the Sales pipeline article).

## How to use advanced filters

1. On **Contacts**, open **Advanced filters**.
2. Combine criteria: **Score range** (minimum and maximum), **Date range**, **Filter by tags**.
3. Click **Apply filters**. Use **Clear filters** to go back to the full list.

## How to import contacts from Excel or CSV

1. On **Contacts**, click **Import**.
2. In the **Import contacts** window, drag your Excel file (.xlsx, .xls) or CSV, click to browse for it on your computer, or copy and paste the cells directly.
3. If you prefer, use **Download CSV template** to start from a template with the correct columns and an instructions sheet.
4. Click **Import**. When it finishes you'll see the summary: **Imported**, **Skipped**, and **Errors** (with the detail of each problem row).

Useful format details:

- The only required column is the **phone** (it's the contact's unique identifier).
- Columns accept synonyms in English and Spanish (e.g. "telefono", "mobile", "phone") and the delimiter can be a comma or a semicolon.
- Optional columns: first name, last name, email, stage, company, source, is_vip, preferred channel, and campaign attributes (UTM).
- If you include the stage column, the valid values are: `nuevo`, `contactado`, `respondio`, `calificado`, `tibio`, `caliente`, `listo_cierre`, `ganado`, `perdido`, `no_interesado`.

## How to export your contacts

On **Contacts**, click **Export**. An Excel file downloads with all your contacts, ready to open or share.

## Bulk actions

For administrators and supervisors:

1. Check the boxes for the contacts you want (you'll see how many you have **selected**).
2. In the bar that appears at the bottom, choose the action: **Change stage**, **Add tag**, or **Archive**.
3. Fill in the detail (the new stage or the tag name) and click **Apply**.

## How to archive a contact

Archiving removes the contact from your lists and from the pipeline (for example, test contacts or people who asked not to be contacted).

1. Open the contact's profile and click **Archive**.
2. Confirm in the **Archive contact** window.

You can also archive several at once with bulk actions. Treat it as a permanent action: review carefully before confirming.

## Saved segments

A segment is a group of contacts defined by filters that updates on its own: "hot leads", "VIP customers from Instagram", etc. They're useful, for example, to choose the audience for a campaign.

1. On **Contacts**, click **Segments** (or go to the CRM Segments page).
2. Click **New segment**.
3. Give it a **Name** (e.g. "Hot leads") and an optional **Description**.
4. Use **Add filter** to combine criteria: **Stage**, **Score**, **Phone**, **Email**, **Source**, **VIP**, or **Creation date**, with operators like "equals", "greater than", or "contains".
5. Use **Preview** to see how many contacts match and click **Create segment**.

## Custom attributes

If you need to store data specific to your business (birthdays, size, policy number…), create fields tailored to you. Available for administrators and supervisors:

1. Go to **Settings** and, in the **Operation** section, open **Custom Attributes**.
2. Click **New attribute**.
3. Choose the **Entity type** (Contact, Lead, Company, or Conversation), write the **Label** (e.g. "Birthday") and the **Data type**: Text, Number, Date, Boolean, List (with options separated by commas), or URL. You can mark it as a **Required field**.
4. Save. The field will appear in the **Custom fields** section of each contact's profile.

## Duplicate contacts: automatic and manual merge

If the same person messages you through two channels with the same phone or email, Parallly links the profiles automatically. For the cases the system can't resolve on its own, administrators and supervisors have the **Identity** page (type `/admin/identity` at the end of your panel's address):

- **Automatic suggestions**: pairs of very similar contacts detected by the system, with their **Confidence** level. Review each pair and choose **Approve** (they merge) or **Reject**.
- **Merge manually**: search for and select the first and second contact, then click **Merge contacts**. They become a single profile with all their history.

## Plan limits

| Plan | Contacts | Saved segments | Custom attributes |
|------|----------|----------------|-------------------|
| Emprendedor | 100 | Not included | Not included |
| Starter | 500 | 3 | 5 |
| Pro | 5,000 | 15 | 20 |
| Enterprise | 50,000 | Unlimited | Unlimited |
| Custom | Unlimited | Unlimited | Unlimited |

As you approach your plan's contact limit, you'll see a notice to expand it from **Settings → Billing**.

## Frequently asked questions

**Are contacts created automatically?**
Yes. Every person who messages you through any connected channel is registered automatically along with their conversation. Creating by hand or importing is only for contacts who haven't messaged you yet.

**Why does a contact have a low score if they bought from me months ago?**
The score rewards recent activity: if you set up decay, it drops with days of no interaction. You can adjust the weights under **Settings → Lead Scoring**.

**What happens if I import a phone that already exists?**
The phone is the unique identifier: the row is marked as skipped or updates the existing contact, no duplicates are created. The import summary shows you the detail.

**Can I undo a contact merge?**
Not from the panel. Before approving a suggestion or merging manually, review both profiles carefully. If you merged by mistake, reach out to support.

**Who can archive or make bulk changes?**
Only administrators and supervisors. Agents can view, create, and edit contacts.

**Need more help?** Reach out to us at https://parallly-chat.cloud/support
