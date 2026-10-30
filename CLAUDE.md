# Parallext Engine — Claude Code

@AGENTS.md

`AGENTS.md` is the single source of agent context for this repository (unified in K3, 2026-10-30). Edit conventions there, not here.

Claude-specific notes:
- Per-app context: `apps/api/CLAUDE.md`, `apps/dashboard/CLAUDE.md`, `apps/whatsapp/CLAUDE.md`.
- Do not keep project memory inside the repository (the old `.claude-memory/` was removed); durable rules belong in `AGENTS.md` or an ADR in `docs/decisions/`.
- `.claude/settings.local.json` is per developer and git-ignored.
