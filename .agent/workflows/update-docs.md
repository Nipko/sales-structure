---
description: How to update documentation after code changes
---

# Documentation Update Workflow

After every code change, modification, or new feature, update the corresponding documentation files.

## Documents to update:

// turbo-all

1. **`docs/CHANGELOG.md`** — Add entry under current version with what changed
2. **`docs/API_REFERENCE.md`** — If new endpoints, WebSocket events, or migrations were added
3. **`docs/SECURITY.md`** — If auth, roles, or security-related changes were made
4. **`MANUAL.md`** — If new modules, pages, or major features were added
5. **`README.md`** — If architecture or tech stack changed

## Steps:

1. Identify which docs are affected by the change
2. Update each affected doc with the new information
3. Update the version date in affected docs
4. Add a new entry to CHANGELOG.md
5. Commit docs with the code changes (same commit)

## Changelog format:
```markdown
## [X.Y.Z] — YYYY-MM-DD

### Category (emoji + name)
- **Component** — Description of change
```

## When creating new modules:
- Add module to the modules table in `API_REFERENCE.md`
- Add endpoints to the corresponding section
- Add migration to the migrations table
- Update `MANUAL.md` module list
