# Parallly Assist runtime knowledge base

These Markdown files are the product-help source loaded by `CopilotService`. They are separate from tenant knowledge, FAQs, and policies, which answer each tenant's customers.

The collection currently has 26 equivalent articles in each locale (`es`, `en`,
`pt`, `fr`). `centro-calidad-agente` covers the read-only Agent quality center for
Tenant Admin and Tenant Supervisor; agent editing remains Admin-only.

## Contract

- Keep the same article `id`, `routes`, and `roles` in `es`, `en`, `pt`, and `fr`.
- Use the frontmatter fields `id`, `title`, `routes`, `roles`, and `keywords`. Array fields must be valid JSON arrays.
- Use only canonical dashboard routes declared in `apps/dashboard/src/lib/navigation-contract.ts`.
- Roles are limited to `tenant_admin`, `tenant_supervisor`, and `tenant_agent`. Grant only the roles that can safely use the article.
- Describe menu locations using the current information architecture: Essentials, AI & Growth, Operations, Insights, Administration, and Settings.
- Do not copy prices, trial durations, quotas, or plan matrices into articles. Direct users to **Administration → Plan & Billing**, whose account-specific values are authoritative.
- Keep credentials, secrets, tenant content, customer FAQs, and customer policies out of this repository knowledge base.

The API image copies `kb/assistant` at build time. Deploy a new API image (or restart a process with the updated files mounted) for changes to reach the in-process cache.

Run the contract test after every edit:

```bash
npm test -- --runInBand src/modules/copilot/assistant-kb-contract.spec.ts
```
