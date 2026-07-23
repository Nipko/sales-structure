#!/bin/bash
# ============================================
# Parallext Engine — VPS Security Hardening
# Run once on fresh VPS. Safe to re-run (idempotent).
#
# Usage: sudo bash /opt/parallext-engine/infra/scripts/harden-vps.sh
# ============================================

set -euo pipefail

echo "========================================"
echo "Parallext VPS Hardening — $(date '+%Y-%m-%d %H:%M')"
echo "========================================"

# ── 1. System updates ──
echo "[1/7] System updates..."
apt-get update -qq
apt-get upgrade -y -qq
echo "  OK"

# ── 2. Unattended security upgrades ──
echo "[2/7] Unattended upgrades..."
apt-get install -y -qq unattended-upgrades apt-listchanges > /dev/null 2>&1

cat > /etc/apt/apt.conf.d/50unattended-upgrades <<'UNATTENDED'
Unattended-Upgrade::Allowed-Origins {
    "${distro_id}:${distro_codename}-security";
    "${distro_id}ESMApps:${distro_codename}-apps-security";
};
Unattended-Upgrade::AutoFixInterruptedDpkg "true";
Unattended-Upgrade::Remove-Unused-Kernel-Packages "true";
Unattended-Upgrade::Remove-Unused-Dependencies "true";
Unattended-Upgrade::Automatic-Reboot "false";
UNATTENDED

cat > /etc/apt/apt.conf.d/20auto-upgrades <<'AUTO'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
AUTO

systemctl enable unattended-upgrades 2>/dev/null || true
echo "  OK — security patches auto-installed daily"

# ── 3. Firewall (UFW) ──
echo "[3/7] Firewall (UFW)..."
apt-get install -y -qq ufw > /dev/null 2>&1

# Reset to defaults
ufw --force reset > /dev/null 2>&1

# Default policies
ufw default deny incoming
ufw default allow outgoing

# Allow SSH (critical — don't lock yourself out)
ufw allow 22/tcp comment 'SSH'

# Cloudflare Tunnel handles all HTTP/HTTPS traffic — no ports needed.
# If you need direct access to monitoring tools from specific IPs:
# ufw allow from YOUR_IP to any port 3003 comment 'Uptime Kuma'
# ufw allow from YOUR_IP to any port 3004 comment 'Grafana'
# ufw allow from YOUR_IP to any port 9999 comment 'Dozzle'

ufw --force enable
echo "  OK — only SSH (22) open, all HTTP via Cloudflare Tunnel"

# ── 4. Fail2ban (SSH brute-force protection) ──
echo "[4/7] Fail2ban..."
apt-get install -y -qq fail2ban > /dev/null 2>&1

cat > /etc/fail2ban/jail.local <<'JAIL'
[DEFAULT]
bantime = 3600
findtime = 600
maxretry = 5
backend = systemd

[sshd]
enabled = true
port = ssh
filter = sshd
maxretry = 3
bantime = 7200
JAIL

systemctl enable fail2ban 2>/dev/null || true
systemctl restart fail2ban 2>/dev/null || true
echo "  OK — 3 failed SSH attempts = 2 hour ban"

# ── 5. Swap (2 GB safety net) ──
echo "[5/7] Swap space..."
if swapon --show | grep -q '/swapfile'; then
  echo "  SKIP — swap already configured"
else
  if [ ! -f /swapfile ]; then
    fallocate -l 2G /swapfile
    chmod 600 /swapfile
    mkswap /swapfile
    swapon /swapfile
    echo '/swapfile none swap sw 0 0' >> /etc/fstab
    echo "  OK — 2 GB swap created and enabled"
  else
    swapon /swapfile 2>/dev/null || true
    echo "  OK — existing swapfile activated"
  fi
fi

# Optimize swap behavior (prefer RAM, use swap only under pressure)
sysctl vm.swappiness=10 > /dev/null 2>&1
echo 'vm.swappiness=10' > /etc/sysctl.d/99-parallext-swap.conf

# ── 6. Kernel tuning for Docker/networking ──
echo "[6/7] Kernel tuning..."
cat > /etc/sysctl.d/99-parallext-network.conf <<'SYSCTL'
# Max open file descriptors (for many WebSocket connections)
fs.file-max = 65535

# Network tuning for high-connection servers
net.core.somaxconn = 4096
net.ipv4.tcp_max_syn_backlog = 4096
net.ipv4.ip_local_port_range = 1024 65535

# Reuse TIME_WAIT sockets (helps with PgBouncer connection cycling)
net.ipv4.tcp_tw_reuse = 1

# Faster TCP keepalive detection (helps with stale WebSocket connections)
net.ipv4.tcp_keepalive_time = 300
net.ipv4.tcp_keepalive_intvl = 30
net.ipv4.tcp_keepalive_probes = 5
SYSCTL

sysctl --system > /dev/null 2>&1
echo "  OK — file descriptors, TCP keepalive, port range optimized"

# ── 7. SSH hardening ──
echo "[7/7] SSH hardening..."
SSHD_CONFIG="/etc/ssh/sshd_config"

# Disable root login (use sudo instead)
if grep -q "^PermitRootLogin" "${SSHD_CONFIG}"; then
  sed -i 's/^PermitRootLogin.*/PermitRootLogin prohibit-password/' "${SSHD_CONFIG}"
else
  echo "PermitRootLogin prohibit-password" >> "${SSHD_CONFIG}"
fi

# Disable password auth if SSH keys are set up
# Uncomment the next lines ONLY after confirming SSH key access works:
# sed -i 's/^#PasswordAuthentication.*/PasswordAuthentication no/' "${SSHD_CONFIG}"
# sed -i 's/^PasswordAuthentication.*/PasswordAuthentication no/' "${SSHD_CONFIG}"

# Reduce login grace time
if ! grep -q "^LoginGraceTime" "${SSHD_CONFIG}"; then
  echo "LoginGraceTime 30" >> "${SSHD_CONFIG}"
fi

# Limit max auth tries
if ! grep -q "^MaxAuthTries" "${SSHD_CONFIG}"; then
  echo "MaxAuthTries 3" >> "${SSHD_CONFIG}"
fi

systemctl reload sshd 2>/dev/null || systemctl reload ssh 2>/dev/null || true
echo "  OK — root login restricted, auth limits set"

# ── Summary ──
echo ""
echo "========================================"
echo "Hardening complete!"
echo ""
echo "  Firewall:     UFW enabled (SSH only)"
echo "  Fail2ban:     3 attempts = 2h ban"
echo "  Swap:         2 GB (/swapfile)"
echo "  Auto-updates: Security patches daily"
echo "  SSH:          Root restricted, 3 max tries"
echo "  Kernel:       Tuned for Docker/WebSocket"
echo ""
echo "Verify:"
echo "  ufw status verbose"
echo "  fail2ban-client status sshd"
echo "  swapon --show"
echo "  sysctl vm.swappiness"
echo ""
echo "IMPORTANT: After confirming SSH key access works,"
echo "uncomment PasswordAuthentication lines in this script"
echo "and re-run to disable password login entirely."
echo "========================================"
