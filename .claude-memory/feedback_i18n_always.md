---
name: Always update i18n with code changes
description: Every page edit/creation must include translation updates in all 4 JSON files
type: feedback
---

Every time a page is created, edited, or rewritten, update the translation files (es.json, en.json, pt.json, fr.json) in the SAME commit.

**Why:** User found that i18n was forgotten after the appointments page rewrite, leaving new strings hardcoded in Spanish only.

**How to apply:**
1. Any new hardcoded Spanish string in a page → extract to t('key') 
2. Add the key to ALL 4 message files (es, en, pt, fr)
3. Include the JSON changes in the same commit as the page change
4. Never commit a page change without the corresponding i18n update
