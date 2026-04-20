---
name: i18n Remaining Spanish Strings Audit
description: Exact state of remaining 92 hardcoded Spanish strings across 24 dashboard files — for continuation in next session
type: project
originSessionId: d5aaa220-582d-4f39-aed4-0a7831ce3013
---

## STATUS: COMPLETED — April 18, 2026

All 92 Spanish strings eliminated. Dashboard is now 100% i18n-ready with 4 languages (es/en/pt/fr).
Final count: 0 accented characters in TSX files (excluding book/[tenantSlug] which is intentionally multilingual).

---
(Original audit below for historical reference)

## Status as of April 18, 2026

92 lines with Spanish accented characters remain across 24 files.
Previous session reduced from 138 → 92. CopilotWidget (41) was the biggest win.

## Remaining by file (sorted by count):

| Count | File | Notes |
|-------|------|-------|
| 16 | automation/page.tsx | Wizard step descriptions, condition labels, button texts |
| 10 | settings/localization/page.tsx | Timezone labels (México, Perú, España), currency names, language options |
| 8 | settings/notifications/page.tsx | Notification category labels and descriptions |
| 8 | agent/page.tsx | AI agent config labels |
| 6 | TopBar.tsx | Notification menu labels |
| 6 | onboarding/page.tsx | Registration form labels |
| 6 | WhatsAppEmbeddedSignup.tsx | OAuth flow messages |
| 5 | settings/alerts/page.tsx | Alert metric descriptions, report options |
| 4 | AuthContext.tsx | Error messages (internal) |
| 4 | settings/channels/page.tsx | Credential field descriptions |
| 2 | settings/profile/page.tsx | Form labels |
| 2 | settings/platform/page.tsx | Platform settings |
| 2 | settings/appearance/page.tsx | Theme labels |
| 2 | settings/ai-config/page.tsx | AI config descriptions |
| 2 | contacts/page.tsx | Contact-related labels |
| 1 | useApiData.tsx | Data source label |
| 1 | ConfigTab.tsx (appointments) | One remaining string |
| 1 | Heatmap.tsx | Day label |
| 1 | setup-password/page.tsx | Label |
| 1 | settings/media/page.tsx | Confirm dialog |
| 1 | pipeline/page.tsx | Drag instruction |
| 1 | ai/page.tsx | Table header |
| 1 | AppSidebar.tsx | Tooltip |
| 1 | broadcast/page.tsx | One label |

## Detection command:
```bash
grep -rn '[áéíóúñÁÉÍÓÚÑ¿¡]' apps/dashboard/src/ --include="*.tsx" | grep -v "node_modules|.next|// |/\*|import|console\.|className|style="
```

## What was completed:
- CopilotWidget rewritten (41 → 0) with English system prompt + copilot i18n namespace
- Settings layout sidebar fully i18n (all nav items use t())
- Security page fully rewritten with i18n
- Business hours page i18n (day names, descriptions)
- All design tokens unified (0 gray-*, 0 font-bold, 0 rounded-2xl)
- PageHeader component applied to 14 pages
- TabNav component applied to appointments
- Breadcrumbs applied to contact detail

## How to apply:
Each file needs: check if useTranslations exists → add t/tc hook → add i18n keys to 4 language files → replace hardcoded string with t() call
