# Help panel media (GIF / screenshots)

Animated GIFs / annotated screenshots shown inside each page's help panel
(`<HelpPanel>`), as the visual support agreed for the help-content rollout.

## How it works (zero broken images)
`HelpPanel` accepts a `mediaKey` prop. When set, it auto-loads
`/help/{mediaKey}.gif` and renders it **only if the file exists** — a missing
asset hides itself silently. So you can pre-wire pages now and assets "light up"
the moment you drop the file here.

Wiring a page (one line):
```tsx
<HelpPanel
  title={tHelp("pipeline.title")}
  description={tHelp("pipeline.description")}
  tips={tHelp.raw("pipeline.tips") as string[]}
  mediaKey="pipeline"            // ← add this
/>
```

For multiple images or a YouTube video instead of the convention GIF, use the
existing `images` / `videoUrl` props (they take precedence over `mediaKey`).

## Asset spec
- **Filename**: `{helpKey}.gif` (exact key below). Lowercase, matches the i18n `help.{key}`.
- **Format**: animated GIF (or static screenshot saved as `.gif`). Keep < ~2 MB.
- **Dimensions**: ~720px wide, 16:9-ish. Rendered responsive (full panel width).
- **Content**: show the ONE core action of the page (the first tip is a good script).
- Annotate (arrows/highlights) the button or field referenced in the tips.

## Pages that already have a help panel (drop a `{key}.gif` for each)
| key | page | suggested GIF |
|-----|------|----------------|
| dashboard | /admin | overview cards + "Recent activity" |
| agent | /admin/agent | create agent from template |
| agentAnalytics | /admin/agent-analytics | sort Agents tab by a column |
| analyticsV2 | /admin/analytics-v2 | switch tabs + Export CSV |
| appointments | /admin/appointments | save availability + create appointment |
| automation | /admin/automation | 3-step rule wizard |
| automationTemplates | /admin/automation/templates | filter + install a template |
| dripSequences | /admin/automation/drip-sequences | add steps with delays |
| broadcast | /admin/broadcast | create + pick audience + send |
| channels | /admin/channels | connect a channel (badge turns green) |
| compliance | /admin/compliance | create legal text + assign chips |
| contacts | /admin/contacts | advanced filters + open 360° detail |
| crmAnalytics | /admin/crm-analytics | funnel + velocity tabs |
| pipeline | /admin/pipeline | drag a card between stages |
| inbox | /admin/inbox | reply + handoff badge + right panel |
| knowledge | /admin/knowledge | bulk upload + add URL |
| properties | /admin/properties | new property + amenities |
| reportBuilder | /admin/report-builder | pick metrics + preview + save |
| settings | /admin/settings | navigate sections |
| tenants | /admin/tenants | overview table + impersonate |
| users | /admin/users | invite user + roles |
| financials | /admin/financials | tabs (super admin) |
| featureRequests | /admin/feature-requests | submit + vote |

## Phase 1 — Wave A (added, drop a `{key}.gif` for each)
| key | page | suggested GIF |
|-----|------|----------------|
| agentSimulation | /admin/agent/simulation | run a synthetic test + open transcript |
| attribution | /admin/attribution | range selector + per-ad table + funnel |
| organizations | /admin/contacts/organizations | new org + forecast KPIs |
| coupons | /admin/coupons | create coupon (type/expiry/max) |
| identity | /admin/identity | approve a merge suggestion |
| inventory | /admin/inventory | adjust stock (in/out/adjust) |
| managed | /admin/managed | enroll account + target % |
| orders | /admin/orders | filter by status + change status |
| procedures | /admin/procedures | write SOP → compile to steps |
| verticalAnalytics | /admin/vertical-analytics | overview bar → drilldown |

## Phase 1 — Wave B (added, drop a `{key}.gif` for each)
| key | page | suggested GIF |
|-----|------|----------------|
| audit | /admin/audit | filter by tenant/action + expand a row |
| catalog | /admin/catalog | hub cards navigation |
| campaigns | /admin/catalog/campaigns | create campaign + entry source |
| catalogCourses | /admin/catalog/courses | new course (price/modality) |
| offers | /admin/catalog/offers | new offer (type/validity) |
| complianceAdmin | /admin/compliance-admin | deletions tab + export |
| segments | /admin/contacts/segments | build filters + preview |
| conversations | /admin/conversations | status filter + sentiment |
| funnel | /admin/funnel | period toggle + by-source |
| health | /admin/health | status banner + failed jobs inspector |
| faqs | /admin/knowledge/faqs | new FAQ + tags |
| landings | /admin/landings | new landing + publish |
| llmStats | /admin/llm-stats | range toggle + top tenants |
| plans | /admin/plans | edit plan + save (cache invalidation) |
| usage | /admin/usage | sort by usage + over-quota tile |
| webhooks | /admin/webhooks | channel/status filter + pause |

## Phase 2 — Settings (added, keys prefixed `settings…`)
36 Settings sub-tabs now have help (keys `settingsAiConfig`, `settingsApiKeys`,
`settingsSecurity`, `settingsPipeline`, … one per tab). GIFs are optional here —
most config tabs are self-explanatory; add `/help/{key}.gif` only for the few
that benefit from a walkthrough (e.g. `settingsSecurity`, `settingsScoringConfig`,
`settingsPrechat`). `settings/integrations` is a redirect (no panel).

## New pages to add help to (later phases — see docs/help-panel-audit-2026-06.md)
When adding `HelpPanel` to a new page, also add `mediaKey="{newKey}"` and a
matching `help.{newKey}` entry in all 4 `messages/*.json`.
