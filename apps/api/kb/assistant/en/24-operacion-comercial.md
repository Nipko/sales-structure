---
id: operacion-comercial
title: "Advanced commercial operations"
routes: ["/admin/contacts", "/admin/contacts/organizations", "/admin/identity", "/admin/attribution", "/admin/catalog", "/admin/catalog/offers", "/admin/crm-analytics", "/admin/report-builder", "/admin/landings"]
roles: ["tenant_admin", "tenant_supervisor"]
keywords: ["commercial operations", "organizations", "identity", "merge contacts", "attribution", "catalog", "offers", "crm analytics", "reports", "landings", "sales", "forecast", "stalled deals"]
---

# Advanced commercial operations

Beyond contacts and pipeline, Parallly brings together tools to keep data clean, run offers, and measure results.

- **Organizations** groups contacts from the same company.
- **Identity** detects duplicate profiles across channels and lets people review merges.
- **Attribution** connects contacts and deals to their source.
- **Catalog and offers** centralizes products, services, and proposals available to sales teams and AI agents.
- **CRM Analytics** and **Custom Reports** compare funnel, velocity, sources, and performance.
- **Landings** captures new contacts from campaign pages.

Correct identities and sources before interpreting reports. **Catalog** and **Landings** are gated by vertical capabilities and may not appear for every business. Available actions also depend on role; a supervisor should not assume administrator-only configuration permissions.

## Organizations and sales forecast

Under **Customers → Organizations**, each business account shows its contacts, open opportunities, and weighted value. The pipeline forecast appears above the list:

- **Weighted pipeline**: the sum of each open opportunity's value times its stage probability.
- **Committed**: the value of opportunities in stages with a probability of 80% or more.
- **Best case**: the total value of the open pipeline.
- **Avg days to win**: average days from creation to win over the last 90 days.
- **Stalled deals**: open opportunities with no changes for more than 14 days, so your team can pick them up again.

The forecast depends on the probabilities you set on your pipeline stages; if you do not adjust them, the weighted figures do not reflect your reality.
