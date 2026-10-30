# Backup & Restore — Runbook operativo

_Última actualización: 2026-07-23_

Runbook canónico de backup/restore de Parallext Engine: qué se respalda, cómo verificar que está sano, cómo restaurar, y los incidentes/lecciones aprendidas. Para el **setup** inicial del offsite (crear bucket, cargar secrets, instalar rclone) ver [`backup-offsite-setup.md`](backup-offsite-setup.md).

> **TL;DR operativo:** el backup corre por cron a las **2:00 AM** (`infra/backup/backup.sh`), corre `pg_dump`/`psql` **dentro** del contenedor `parallext-postgres`, escribe un `.tar.gz` en `/backup/daily/`, espeja a un bucket S3-compatible con `rclone`, y solo entonces escribe el heartbeat `backup:last_success` en Redis. El Ops Center alerta (`backup:stale`) si ese heartbeat supera las ~26h.

---

## 1. Qué se respalda (`infra/backup/backup.sh`, 7 partes)

`pg_dump` y `psql` se ejecutan **dentro** del contenedor `parallext-postgres` (socket auth, versión de cliente siempre igual a la del servidor), así el host **no** necesita `postgresql-client` instalado.

| # | Contenido | Cómo |
|---|-----------|------|
| 1 | BD schema `public` (billing, planes, pagos, tenants) | `docker exec parallext-postgres pg_dump --schema=public --format=custom` |
| 2 | BD por cada schema de tenant activo | `SELECT schema_name FROM tenants WHERE is_active = true` → `pg_dump --schema=<tenant>` |
| 3 | BD completa (red de seguridad) | `pg_dump --format=custom` (todos los schemas) |
| 4 | Redis (RDB) | `redis-cli BGSAVE` + `docker cp dump.rdb` |
| 5 | Media (imágenes, logos) | `tar` del volumen `parallext-media-data` |
| 6 | **Facturas fiscales DIAN (XML+PDF)** | `tar` del volumen `parallext-fiscal-data` (retención legal 5 años) |
| 7 | Compresión + rotación | `tar -czf <timestamp>.tar.gz` |

**Retención:** 7 diarios + 4 semanales (domingos) + 2 mensuales (día 1) en `/backup/{daily,weekly,monthly}/`.

**Dumps pre-deploy (aparte del nocturno):** el deploy (`.github/workflows/deploy.yml`) hace un `pg_dump` completo **antes** de migrar, en `/backup/pre-deploy/predeploy_<ts>.dump` (guarda los últimos 3). Son dumps de BD **válidos** e independientes del cron nocturno — útiles como punto de rollback inmediato.

### Gate de integridad (heartbeat honesto)
El script marca `BACKUP_OK=0` si `public.dump` **o** `full_backup.dump` quedan vacíos (0 bytes). El heartbeat de Redis y el sync offsite **solo** corren con `BACKUP_OK=1`. Así un dump roto **alerta** en vez de mostrarse "verde", y nunca se sube un archivo vacío que pise un backup bueno en la nube. El script sale con código ≠ 0 si la integridad falla.

---

## 2. Offsite (S3-compatible vía rclone)

`rclone` se configura **solo por variables de entorno** (sin `rclone.conf`), leídas del `.env` de producción que el deploy regenera desde GitHub Secrets:

`OFFSITE_BUCKET`, `OFFSITE_PROVIDER` (AWS | Cloudflare | Other), `OFFSITE_REGION`, `OFFSITE_ENDPOINT`, `OFFSITE_ACCESS_KEY`, `OFFSITE_SECRET_KEY`, `OFFSITE_PATH`.

**Proveedor en producción: Cloudflare R2** (`parallext-backups-prod`) — egress gratis, free tier permanente 10 GB. `rclone sync` **espeja** todo `/backup/` al bucket, así la nube tiene la misma retención 7/4/2. Migrar de proveedor = cambiar 4 secrets, sin tocar código. Detalle en [`backup-offsite-setup.md`](backup-offsite-setup.md).

> El `NOTICE: rclone.conf not found - using defaults` en el log es **normal** (config por env vars); el sync igual funciona.

---

## 3. Verificación de salud

### El heartbeat
`backup.sh` escribe en Redis `backup:last_success` = epoch en **ms** (solo si `BACKUP_OK=1`). `PlatformMonitorService.checkBackupHeartbeat()` (cron diario 7:30 AM) lo lee y levanta el incidente **`backup:stale`** si la antigüedad supera `alertConfig.backupStaleHours` (default **26h**). Es un incidente **critical** → alerta por email/Telegram/SMS.

### Chequeo manual en el VPS
```bash
# Últimas corridas del cron
tail -n 60 /var/log/parallext-backup.log

# Valor + antigüedad del heartbeat (Redis puede requerir password)
RP=$(grep -E '^REDIS_PASSWORD=' /opt/parallext-engine/.env | cut -d= -f2-)
TS=$(docker exec parallext-redis redis-cli ${RP:+-a "$RP"} --no-auth-warning GET backup:last_success)
echo "último backup OK: $(date -d @$((TS/1000))) — hace $(( ($(date +%s%3N)-TS)/3600000 )) h"

# Backups presentes (nocturnos + pre-deploy)
ls -lh /backup/daily/ | tail -5 && ls -lh /backup/pre-deploy/ 2>/dev/null
```

### Correr un backup a mano (y limpiar la alerta)
```bash
sudo bash /opt/parallext-engine/infra/backup/backup.sh
```
Debe terminar con `Integrity: OK`, `public + N tenants` (N > 0) y **sin** `WARN: Could not write backup heartbeat to Redis`. El incidente `backup:stale` se auto-resuelve en el próximo chequeo o al instante con **"ejecutar chequeos ahora"** en el Ops Center. **`sudo bash backup.sh` corre aunque el script no sea ejecutable** (bash ignora el bit `+x`) → que un run manual funcione **no** garantiza que la cron funcione (ver §6).

---

## 4. Restore (`infra/backup/restore.sh`)

```bash
# Ver qué hay en la nube (si perdiste los locales)
sudo bash /opt/parallext-engine/infra/backup/restore.sh --list-offsite

# Probar sin aplicar
sudo bash /opt/parallext-engine/infra/backup/restore.sh <timestamp>.tar.gz --dry-run

# Restaurar (baja el archivo del bucket si no está local)
sudo bash /opt/parallext-engine/infra/backup/restore.sh <timestamp>.tar.gz
```

Restaura BD (public + tenants), media y **facturas fiscales**. Redis se restaura manualmente (los pasos los imprime el script). Un tenant que estaba `is_active=false` al momento del backup **no** tiene dump por-schema propio; sus datos viven solo dentro de `full_backup.dump`.

### Disaster recovery (VPS totalmente perdido)
En un servidor nuevo: cloná el repo, generá el `.env` (deploy o manual con las `OFFSITE_*`), instalá `rclone`, y:
```bash
sudo bash infra/backup/restore.sh --list-offsite
sudo bash infra/backup/restore.sh <ultimo>.tar.gz
```

---

## 5. Instalación de crons (`infra/scripts/setup-production-crons.sh`)

```bash
sudo bash /opt/parallext-engine/infra/scripts/setup-production-crons.sh
```
Instala (idempotente) en el crontab de root:
- Backup diario **2:00 AM** → `/var/log/parallext-backup.log`
- Cleanup semanal **domingo 5:00 AM** (Docker prune, temp, journal)
- Truncado mensual de logs > 10 MB

**Nunca** edites el crontab a mano; corré este script. Hace `chmod +x` de los scripts — pero ese chmod **solo** corre en el setup manual, no en cada deploy (ver §6).

---

## 6. Postmortem — backups nocturnos huecos ~1 mes (incidente 2026-07-23)

**Síntoma:** alerta `backup:stale` ("último backup exitoso hace 48h"). El log mostraba, cada noche desde ~24-jun, `/bin/sh: /opt/parallext-engine/infra/backup/backup.sh: Permission denied`.

**Dos fallas encadenadas:**
1. **`pg_dump: command not found` (previo):** una versión anterior del script llamaba `pg_dump` en el **host** (sin `postgresql-client`) → `public.dump`/`full_backup.dump` de 0 bytes y `public + 0 tenants`. Los `.tar.gz` pesaban ~2.9M (solo media+redis, **sin BD**) pero se veían "completos". _Ya corregido:_ el script corre `pg_dump` **dentro** del contenedor.
2. **`Permission denied` (causa raíz):** el deploy hace `git reset --hard origin/main`, que **restaura el modo de archivo versionado**. Los scripts de infra estaban en `100644` (sin `+x`) en git → cada deploy borraba el bit de ejecución que agrega `setup-production-crons.sh`. La cron invoca el script por path → sin `+x`, "Permission denied" → **cero backups nocturnos**. El heartbeat solo seguía fresco por corridas manuales ocasionales (`sudo bash`, que ignora el `+x`).

**Fix (commit `f95e0719`):** `git update-index --chmod=+x` sobre todos los scripts de infra → quedan `100755` en git y el `reset --hard` ya no puede borrar el `+x`.

**Regla permanente:** cualquier script ejecutado por cron o por `./script.sh` **debe** estar commiteado `100755`, nunca `100644`. En Windows el working tree no muestra el bit; setealo con `git update-index --chmod=+x`, no por filesystem.

**Verificación anti-regresión:**
```bash
git ls-files -s infra/backup/*.sh infra/scripts/*.sh   # deben decir 100755
```

---

## 7. Referencias

- [`backup-offsite-setup.md`](backup-offsite-setup.md) — setup del bucket + secrets + rclone (una sola vez)
- [`deploy-hardening-runbook.md`](deploy-hardening-runbook.md) — el `git reset --hard` del deploy y el hardening de SSH
- [`operations-runbook.md`](operations-runbook.md) — Ops Center / platform-monitor (dónde aparece la alerta `backup:stale`)
