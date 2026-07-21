#!/bin/bash
# ============================================
# Parallext Engine — Setup Production Crontabs
# Run once on the VPS to configure automated backups + cleanup.
#
# Usage: sudo bash /opt/parallext-engine/infra/scripts/setup-production-crons.sh
# ============================================

set -euo pipefail

PROJECT_DIR="/opt/parallext-engine"

echo "========================================"
echo "Setting up production crontabs..."
echo "========================================"

# ── 1. Make scripts executable ──
chmod +x "${PROJECT_DIR}/infra/backup/backup.sh"
chmod +x "${PROJECT_DIR}/infra/backup/restore.sh"
chmod +x "${PROJECT_DIR}/infra/scripts/cleanup.sh"

# ── 2. Create backup directory ──
mkdir -p /backup/daily /backup/weekly /backup/monthly
echo "  OK — /backup/ directories created"

# ── 3. Create log directory ──
touch /var/log/parallext-backup.log
touch /var/log/parallext-cleanup.log
echo "  OK — log files created"

# ── 4. Install crontab entries (idempotent — removes old entries first) ──
CRON_MARKER="# parallext-engine"

# Remove existing parallext cron entries
crontab -l 2>/dev/null | grep -v "${CRON_MARKER}" | crontab - 2>/dev/null || true

# Add new entries
(crontab -l 2>/dev/null; cat <<EOF

# ── Parallext Engine automated tasks ──
# Daily backup at 2:00 AM (DB + media + Redis)  ${CRON_MARKER}
0 2 * * * DATABASE_HOST=localhost DATABASE_PORT=5432 DATABASE_USER=parallext DATABASE_NAME=parallext_engine BACKUP_DIR=/backup ${PROJECT_DIR}/infra/backup/backup.sh >> /var/log/parallext-backup.log 2>&1  ${CRON_MARKER}

# Weekly cleanup at 5:00 AM Sunday (Docker prune, temp files, journal)  ${CRON_MARKER}
0 5 * * 0 ${PROJECT_DIR}/infra/scripts/cleanup.sh >> /var/log/parallext-cleanup.log 2>&1  ${CRON_MARKER}

# Log rotation for backup/cleanup logs (monthly, keep 3 months)  ${CRON_MARKER}
0 0 1 * * find /var/log -name "parallext-*.log" -size +10M -exec truncate -s 0 {} \;  ${CRON_MARKER}
EOF
) | crontab -

echo "  OK — crontab updated"
echo ""
echo "Current crontab:"
crontab -l | grep -A1 "parallext"
echo ""

# ── 5. Verify pg_dump is available ──
if command -v pg_dump &> /dev/null; then
  echo "  OK — pg_dump found: $(pg_dump --version | head -1)"
else
  echo "  WARN — pg_dump not found. Install: apt-get install postgresql-client-16"
  echo "         Backup script will fail without it."
fi

# ── 6. Check rclone for offsite (S3-compatible) ──
if command -v rclone &> /dev/null; then
  echo "  OK — rclone found (offsite sync available)"
  echo "         Credentials come from .env (OFFSITE_* GitHub Secrets) — no 'rclone config' needed."
  echo "         Setup guide: docs/backup-offsite-setup.md"
else
  echo "  INFO — rclone not installed (offsite sync disabled until installed)"
  echo "         Install: curl https://rclone.org/install.sh | sudo bash"
  echo "         Then set the OFFSITE_* GitHub Secrets and redeploy (see docs/backup-offsite-setup.md)."
fi

echo ""
echo "========================================"
echo "Setup complete!"
echo ""
echo "Backup:  Daily 2:00 AM → /backup/"
echo "Cleanup: Weekly Sun 5:00 AM"
echo "Logs:    /var/log/parallext-backup.log"
echo "         /var/log/parallext-cleanup.log"
echo ""
echo "Test backup now:  sudo bash ${PROJECT_DIR}/infra/backup/backup.sh"
echo "Test restore:     sudo bash ${PROJECT_DIR}/infra/backup/restore.sh --dry-run"
echo "========================================"
