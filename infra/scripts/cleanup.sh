#!/bin/bash
# ============================================
# Parallext Engine — Weekly Cleanup Script
# Removes stale Docker resources, temp files, and dangling data.
#
# Crontab (recommended):
#   0 5 * * 0 /opt/parallext-engine/infra/scripts/cleanup.sh >> /var/log/parallext-cleanup.log 2>&1
# ============================================

set -euo pipefail

echo "========================================"
echo "Parallext Cleanup — $(date '+%Y-%m-%d %H:%M')"
echo "========================================"

BEFORE=$(df / --output=used -B1 | tail -1)

# ── 1. Docker: dead containers, dangling images, build cache ──
echo "[1/5] Docker cleanup..."
docker container prune -f --filter "until=72h" 2>/dev/null || true
docker image prune -a -f --filter "until=168h" 2>/dev/null || true
docker builder prune -f --filter "until=168h" 2>/dev/null || true
docker volume prune -f --filter "dangling=true" 2>/dev/null || true
echo "  OK"

# ── 2. Temp files ──
echo "[2/5] Temp files..."
find /tmp -type f -mtime +7 -delete 2>/dev/null || true
find /var/tmp -type f -mtime +14 -delete 2>/dev/null || true
echo "  OK"

# ── 3. Old systemd journal logs (keep 7 days) ──
echo "[3/5] Journal logs..."
if command -v journalctl &> /dev/null; then
  journalctl --vacuum-time=7d 2>/dev/null || true
fi
echo "  OK"

# ── 4. APT cache (Ubuntu) ──
echo "[4/5] Package cache..."
if command -v apt-get &> /dev/null; then
  apt-get autoremove -y -qq 2>/dev/null || true
  apt-get clean -qq 2>/dev/null || true
fi
echo "  OK"

# ── 5. Disk usage report ──
echo "[5/5] Disk report..."
AFTER=$(df / --output=used -B1 | tail -1)
FREED=$(( (BEFORE - AFTER) / 1048576 ))

echo ""
echo "========================================"
echo "Cleanup complete!"
echo "  Freed: ~${FREED} MB"
echo ""
echo "Disk usage:"
df -h / | tail -1 | awk '{printf "  Total: %s | Used: %s (%s) | Free: %s\n", $2, $3, $5, $4}'
echo ""
echo "Top space consumers:"
du -sh /var/lib/docker/volumes/parallext-* 2>/dev/null | sort -rh | head -8
echo ""
echo "Backup directory:"
du -sh /backup 2>/dev/null || echo "  (no backups found)"
echo "========================================"

# ── Alert if disk >80% ──
USAGE_PCT=$(df / --output=pcent | tail -1 | tr -d ' %')
if [ "${USAGE_PCT}" -gt 80 ]; then
  echo ""
  echo "WARNING: Disk usage at ${USAGE_PCT}% — consider upgrading or cleaning more aggressively"
fi
