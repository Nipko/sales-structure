# Backups offsite + retención de facturas — Guía de setup

Guía para respaldar **fuera del VPS** (a) los backups completos de base de datos y (b) los documentos fiscales DIAN (retención legal 5 años), usando un bucket S3-compatible sincronizado con `rclone`.

El código ya está listo (`infra/backup/backup.sh` + `restore.sh` + `deploy.yml`). Lo que falta es una configuración de una sola vez: crear el bucket, cargar 5-7 GitHub Secrets, e instalar `rclone` en el VPS.

---

## 1. Qué se respalda y dónde

Cada noche a las 2:00 AM, `backup.sh` genera un `.tar.gz` que incluye:

| Contenido | Origen |
|---|---|
| BD schema `public` (billing, planes, pagos, tenants) | `pg_dump --schema=public` |
| BD por cada schema de tenant | `pg_dump --schema=tenant_*` |
| BD completa (red de seguridad) | `pg_dump` full |
| Redis (RDB) | `BGSAVE` |
| Media (imágenes, logos) | volumen `parallext-media-data` |
| **Facturas fiscales DIAN (XML+PDF)** | volumen `parallext-fiscal-data` |

Retención local: **7 diarios + 4 semanales + 2 mensuales** en `/backup/`. Con offsite configurado, `rclone` **espeja** esa carpeta al bucket, así que la nube tiene exactamente la misma retención.

> Las facturas fiscales viven en **tres copias**: el volumen local (inmediato), Factus (el proveedor), y el bucket offsite (diario). Suficiente para la retención legal de 5 años.

---

## 2. Qué proveedor conviene (costo-beneficio)

`rclone` habla el protocolo S3, así que sirve cualquiera de estos tres cambiando solo variables. Para ~25 GB (BD + facturas del primer año):

| Proveedor | Storage /mes | **Egress (restaurar)** | Free tier | Nota |
|---|---|---|---|---|
| **AWS S3 Standard** | ~US$0.023/GB (~$0.58) | **US$0.09/GB** (~$2.25 restaurar 25 GB) | 5 GB, **12 meses** | Estándar de la industria. El egress muerde justo en la contingencia. |
| **Cloudflare R2** | US$0.015/GB (~$0.38) | **US$0 — gratis** | 10 GB, **permanente** | Mejor costo-beneficio para backups. Ya usás Cloudflare (tunnel). |
| **Backblaze B2** | US$0.006/GB (~$0.15) | gratis hasta 3× storage/día | 10 GB, permanente | El más barato en storage. |

**Recomendación honesta:** para *backups* el patrón es "escribís mucho, leés casi nunca — pero cuando leés, necesitás todo y con urgencia". Ahí el **egress gratis de R2/B2 gana**: con AWS, bajar un backup completo en una emergencia te cobra transferencia en el peor momento. **R2** es mi primera opción (egress gratis + free tier permanente de 10 GB + una consola menos, ya que usás Cloudflare).

**Pero** AWS S3 que ya tenés funciona perfecto y el free tier de 5 GB cubre el arranque. Como todo pasa por `rclone`, **migrar de AWS a R2 después es cambiar 4 variables**, sin tocar código. Podés arrancar con AWS y reevaluar.

Esta guía usa **AWS S3** como camino principal; al final está la nota de qué cambia para R2/B2.

---

## 3. Setup con AWS S3

### 3.1 Crear el bucket
1. Consola AWS → **S3** → **Create bucket**.
2. Nombre único global, p.ej. `parallext-backups-prod`. Región: `us-east-1` (o la más cercana; anotala).
3. **Block all public access: ON** (los backups son privados).
4. **Bucket Versioning: ON** (recomendado — protege contra borrado accidental o ransomware que sobrescriba).
5. Encryption: **SSE-S3** (por defecto, gratis).

### 3.2 Usuario IAM con permisos mínimos
No uses tu usuario root. Creá un usuario IAM solo para backups:
1. Consola AWS → **IAM** → **Users** → **Create user** → `parallext-backup`.
2. **Sin** acceso a consola (solo programático).
3. Adjuntá esta política inline (reemplazá el nombre del bucket):

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "ParallextBackupBucket",
      "Effect": "Allow",
      "Action": ["s3:PutObject", "s3:GetObject", "s3:DeleteObject", "s3:ListBucket"],
      "Resource": [
        "arn:aws:s3:::parallext-backups-prod",
        "arn:aws:s3:::parallext-backups-prod/*"
      ]
    }
  ]
}
```

4. Creá un **Access Key** para ese usuario. Guardá el `Access Key ID` y el `Secret Access Key` (el secret se muestra una sola vez).

### 3.3 (Opcional) Lifecycle para bajar costos
Si los backups crecen mucho, en el bucket → **Management → Lifecycle rules** podés transicionar objetos con más de 30 días a **S3 Standard-IA** o **Glacier Instant Retrieval** (más baratos, misma velocidad de acceso instantáneo). No lo necesitás al arrancar; con el free tier y datos chicos el costo es centavos.

---

## 4. Cargar los GitHub Secrets

En **https://github.com/Nipko/sales-structure/settings/secrets/actions** → *New repository secret*, cargá:

| Secret | Valor (ejemplo AWS S3) |
|---|---|
| `OFFSITE_BUCKET` | `parallext-backups-prod` |
| `OFFSITE_PROVIDER` | `AWS` |
| `OFFSITE_REGION` | `us-east-1` |
| `OFFSITE_ACCESS_KEY` | el Access Key ID del usuario IAM |
| `OFFSITE_SECRET_KEY` | el Secret Access Key |
| `OFFSITE_PATH` | `parallext` *(opcional; prefijo dentro del bucket)* |
| `OFFSITE_ENDPOINT` | *(dejar vacío en AWS)* |

El próximo deploy inyecta estos valores al `.env` de producción automáticamente. **No hace falta `rclone config`** — las credenciales se leen del `.env`.

---

## 5. Instalar rclone en el VPS (una vez)

SSH al VPS y:
```bash
curl https://rclone.org/install.sh | sudo bash
rclone version   # verificar
```
Eso es todo — no se corre `rclone config`; el remote se arma solo desde las variables del `.env`.

---

## 6. Desplegar y probar

1. **Deploy** — pusheá cualquier commit a `main` (o re-run del último deploy). Se regenera el `.env` con las `OFFSITE_*`.
2. **Backup manual de prueba** en el VPS:
   ```bash
   sudo bash /opt/parallext-engine/infra/backup/backup.sh
   ```
   En el log deberías ver:
   ```
   Syncing offsite → AWS:parallext-backups-prod/parallext/ ...
     OK — offsite sync complete
   ...
   Offsite: synced → parallext-backups-prod
   ```
3. **Verificar en el bucket** — deberías ver `parallext/daily/<timestamp>.tar.gz` en S3.

---

## 7. Recuperación ante contingencia

### Restaurar en el mismo VPS
```bash
# Ver qué hay en la nube (útil si perdiste los backups locales)
sudo bash /opt/parallext-engine/infra/backup/restore.sh --list-offsite

# Probar sin aplicar cambios
sudo bash .../restore.sh 20260721_020000.tar.gz --dry-run

# Restaurar (baja el archivo del bucket automáticamente si no está local)
sudo bash .../restore.sh 20260721_020000.tar.gz
```

### VPS totalmente perdido (disaster recovery)
En un servidor nuevo: cloná el repo, generá el `.env` (deploy o manual con las `OFFSITE_*`), instalá `rclone`, y:
```bash
sudo bash infra/backup/restore.sh --list-offsite          # ver backups disponibles
sudo bash infra/backup/restore.sh <ultimo>.tar.gz         # baja + restaura BD, media y facturas
```

`restore.sh` restaura BD (public + tenants), media y **facturas fiscales**; Redis se restaura manualmente (los pasos los imprime el script).

---

## 8. Salvaguardas ya incluidas en el código

- **Heartbeat honesto:** `backup:last_success` (que vigila el ops-center) solo se escribe si los dumps de BD son válidos (> 0 bytes). Un backup roto ahora **alerta** en vez de mostrarse "verde".
- **No se sube basura:** si el dump falla, el sync offsite se salta — nunca reemplaza un backup bueno en la nube por uno vacío.
- **Salida con error:** `backup.sh` sale con código ≠ 0 si la integridad falla, así el cron/log lo evidencia.

---

## 9. Camino elegido: Cloudflare R2 (recomendado)

R2 es la opción de mejor costo-beneficio para backups (egress gratis, free tier permanente de 10 GB, S3-compatible). Los pasos reemplazan la sección 3 (AWS); el resto de la guía (Secrets, rclone, deploy, recuperación) es idéntico.

### 9.1 Crear el bucket
1. Dashboard de Cloudflare → **R2** → **Create bucket**.
2. Nombre: p.ej. `parallext-backups-prod`. Location: **Automatic** (o la región más cercana).
3. Dejalo **privado** (por defecto lo es).

### 9.2 Anotar el Account ID y el endpoint S3
- En **R2 → Overview**, copiá tu **Account ID** (también aparece en la URL del dashboard).
- El endpoint S3 de R2 es: `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`

### 9.3 Crear el token de API (credenciales S3)
1. **R2 → Manage R2 API Tokens → Create API Token**.
2. Permisos: **Object Read & Write**.
3. Alcance (scope): **Apply to specific buckets only → `parallext-backups-prod`** (mínimo privilegio).
4. Al crearlo, R2 muestra un **Access Key ID** y un **Secret Access Key** (S3-compatible) — copialos, el secret se muestra una sola vez.

### 9.4 Cargar los GitHub Secrets (para R2)

| Secret | Valor |
|---|---|
| `OFFSITE_BUCKET` | `parallext-backups-prod` |
| `OFFSITE_PROVIDER` | `Cloudflare` |
| `OFFSITE_REGION` | `auto` |
| `OFFSITE_ENDPOINT` | `https://<ACCOUNT_ID>.r2.cloudflarestorage.com` |
| `OFFSITE_ACCESS_KEY` | el Access Key ID del token R2 |
| `OFFSITE_SECRET_KEY` | el Secret Access Key del token R2 |
| `OFFSITE_PATH` | `parallext` *(opcional)* |

Después seguí desde la **sección 5** (instalar rclone) → **6** (deploy + prueba) → **7** (recuperación). Todo igual.

---

## 10. Backblaze B2 (alternativa más barata)

Solo cambian estos Secrets respecto a R2:

| Secret | Valor |
|---|---|
| `OFFSITE_PROVIDER` | `Other` |
| `OFFSITE_REGION` | p.ej. `us-west-004` |
| `OFFSITE_ENDPOINT` | `https://s3.us-west-004.backblazeb2.com` |
| `OFFSITE_ACCESS_KEY` / `OFFSITE_SECRET_KEY` | del Application Key de B2 |
