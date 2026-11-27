#!/usr/bin/env bash
# Creates the platform super_admin in the Mac mini environment.
# Same result as apps/api/prisma/seed-admin.ts, in plain JavaScript: ts-node
# cannot load that .ts file inside the production image (ERR_UNKNOWN_FILE_EXTENSION).
# The password is read without echo and is never printed.
#   infra/scripts/mac/create-admin.sh you@example.com
set -euo pipefail
DC="$(cd "$(dirname "$0")" && pwd)/dc.sh"
EMAIL="${1:-}"
if [ -z "$EMAIL" ]; then read -r -p "Correo del super_admin: " EMAIL; fi
read -r -s -p "Contraseña (12+ caracteres): " PASS; echo
read -r -s -p "Repite la contraseña: " PASS2; echo
[ "$PASS" = "$PASS2" ] || { echo "Las contraseñas no coinciden." >&2; exit 1; }
[ "${#PASS}" -ge 12 ] || { echo "La contraseña debe tener 12 caracteres o más." >&2; exit 1; }

ADMIN_EMAIL="$EMAIL" ADMIN_PASSWORD="$PASS" "$DC" run --rm --no-deps -T \
  -e ADMIN_EMAIL -e ADMIN_PASSWORD api node - <<'JS'
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');
const prisma = new PrismaClient();
(async () => {
  const email = process.env.ADMIN_EMAIL.trim().toLowerCase();
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    console.log(`Ya existe un usuario con ese correo (rol ${existing.role}). No se cambió nada.`);
    return;
  }
  const password = await bcrypt.hash(process.env.ADMIN_PASSWORD, 12);
  const user = await prisma.user.create({
    data: { email, password, firstName: 'Admin', lastName: 'Parallext',
            role: 'super_admin', tenantId: null, isActive: true },
  });
  console.log(`super_admin creado: ${email} (id ${user.id})`);
})().catch((e) => { console.error(e.message); process.exit(1); })
  .finally(() => prisma.$disconnect());
JS
