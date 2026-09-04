# Parallly Assist runtime knowledge base

These Markdown files are the product-help source loaded by `CopilotService`. They are separate from tenant knowledge, FAQs, and policies, which answer each tenant's customers.

The collection currently has 26 equivalent articles in each locale (`es`, `en`,
`pt`, `fr`). `centro-calidad-agente` covers Agent health on Home and Insights, the
read-only Quality center, proactive signals, and the privacy-bounded Parallly Assist
coach for Tenant Admin and Tenant Supervisor; agent editing remains Admin-only. It also
covers what `channel_connection` versus `channel_coverage` really check, the context bar
shown on the destination screen after **Review**, and the read-only guided tours.
`primeros-pasos` documents the real onboarding order (sign-up → 4-step welcome wizard →
the three-step "Meet your agent" assistant → non-blocking email verification) and the
plan-aware essential Getting started card that replaced the retired floating `8/9`
progress pill.

## Contract

- Keep the same article `id`, `routes`, and `roles` in `es`, `en`, `pt`, and `fr`.
- Use the frontmatter fields `id`, `title`, `routes`, `roles`, and `keywords`. Array fields must be valid JSON arrays.
- Use only canonical dashboard routes declared in `apps/dashboard/src/lib/navigation-contract.ts`.
- Roles are limited to `tenant_admin`, `tenant_supervisor`, and `tenant_agent`. Grant only the roles that can safely use the article.
- Describe menu locations using the current information architecture: Essentials, AI & Growth, Operations, Insights, Administration, and Settings.
- Do not copy prices, trial durations, quotas, or plan matrices into articles. Direct users to **Administration → Plan & Billing**, whose account-specific values are authoritative.
- Keep credentials, secrets, tenant content, customer FAQs, and customer policies out of this repository knowledge base.
- Do not describe Agent health badges as a score: they count only open Critical and
  High signals. The global banner is limited to an active Critical signal or an At
  risk status; snoozing manages attention and does not resolve the cause.
- Do not promise email, push, or automatic prompt/knowledge edits from Agent health
  or Parallly Assist. Quality context must stay free of transcripts, customer text,
  conversation IDs, prompts, judge prose, retrieval queries, and secrets.
- Never promise that a guided tour ("Show me where" / "Show me how") changes
  configuration. A tour opens a screen and highlights where the change is made; the
  person makes the change and saves it.
- Do not describe the quality context bar as a notification. It is part of the
  destination screen, rendered from the URL a quality signal produced; nothing is sent
  to the user by email, push, or SMS.
- Do not describe a WhatsApp test/sandbox number as a connection route. The certified
  routes are coexistence (recommended), a new number, and migration from another
  provider.

The API image copies `kb/assistant` at build time. Deploy a new API image (or restart a process with the updated files mounted) for changes to reach the in-process cache.

Run the contract test after every edit:

```bash
npm test -- --runInBand src/modules/copilot/assistant-kb-contract.spec.ts
```
