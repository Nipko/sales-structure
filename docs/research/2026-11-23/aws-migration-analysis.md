# Parallly en AWS — análisis de arquitectura, servicios y costos

_Estado: **propuesta de investigación**, no aprobada. Fecha: 2026-11-23. Lo que se apruebe de aquí pasa a un ADR en `docs/decisions/`; este documento no es directiva vigente._

**Cómo leer las cifras.** Los precios son tarifas bajo demanda de `us-east-1`, leídas el 2026-11-23 de los archivos oficiales de precios de AWS (Price List). Los totales mensuales son aritmética mía sobre esas tarifas (730 h/mes). Lo marcado **[sin verificar]** no se pudo confirmar en una fuente primaria. Los tamaños por etapa parten de **supuestos de carga**, porque el repositorio no documenta cuántos tenants ni mensajes hay hoy.

---

## 1. Resumen

**Qué se propone.** Una plataforma nueva en AWS, construida desde cero como infraestructura en código, en la región `us-east-1`, con cómputo sin estado en ECS, PostgreSQL y Redis administrados en dos zonas, archivos en almacenamiento de objetos y Cloudflare en el borde. El VPS se apaga; no se traslada ningún dato (solo hay tenants de prueba).

**Las siete decisiones que definen el diseño**

| # | Decisión recomendada | Por qué |
|---|---|---|
| 1 | Región `us-east-1` (Virginia) | ~87 ms desde Colombia contra ~134 ms a São Paulo; São Paulo cuesta 50–110 % más; Meta y los proveedores de LLM están en EE. UU.; EE. UU. figura en la lista de países adecuados de la SIC |
| 2 | ECS (Fargate, ARM) y no Kubernetes | Son cinco servicios; EKS agrega $73/mes fijos y carga operativa sin beneficio a este tamaño |
| 3 | RDS PostgreSQL Multi-AZ + PgBouncer propio | El código ya está probado contra PgBouncer en modo transacción; Aurora no demostró ventaja para muchísimas tablas |
| 4 | ElastiCache Valkey, primario + réplica, sin modo cluster | BullMQ exige `noeviction` y el código tiene scripts multi-llave que el modo cluster rechaza |
| 5 | Mantener BullMQ, pgvector, la autenticación propia y la integración directa con Meta | Los equivalentes de AWS no los superan para este producto (detalle en §4) |
| 6 | Pasar de un schema por tenant a **tablas compartidas con `tenant_id`** y seguridad por fila, con directorio tenant → celda | Cada tenant crea hoy 249 tablas; es lo que usa toda la industria y cuesta entre 7 y 15 veces menos en base de datos (§6) |
| 7 | **Mantener Cloudflare** en el borde (túnel), no CloudFront | $0–25/mes, origen privado, 4 ciudades en Colombia contra 1; CloudFront solo admite origen privado desde $200/mes (§3.4) |

**Cuánto cuesta (bajo demanda, sin LLM ni tarifas de Meta)**

| Etapa | Supuesto | Costo mensual | Con $5.000 de créditos |
|---|---|---|---|
| 0 · Construcción | Un entorno, sin alta disponibilidad | ~$235 | ~21 meses |
| 1 · Lanzamiento | Producción en 2 zonas, hasta ~50 tenants | ~$420–445 (≈$660 con staging siempre encendido) | ~12 meses (≈7,5 con staging) |
| 2 · Crecimiento | ~500 tenants, ~150.000 turnos/día | ~$1.700 (≈$2.100 si se conserva el schema por tenant) | — |
| 3 · Escala | ~5.000 tenants, ~1,5 M turnos/día | ~$7.000–9.000 (≈$11.000–15.000 con schema por tenant) | — |

**El techo real.** La infraestructura escala a millones de mensajes diarios agregando tareas. Lo que **no** escala es un schema con 249 tablas por tenant: un cluster aguanta cientos de tenants, no miles, y a 5.000 tenants la base de datos sería más de la mitad de la factura. Como no hay datos reales que migrar, este es el momento más barato para cambiar el modelo (§6).

**Trabajo de código antes de encender producción:** el cambio de modelo de datos (§6), archivos a almacenamiento de objetos, adaptador de Redis para socket.io, roles de proceso separados, sacar el DDL del arranque, health checks reales y TLS hacia Redis (§5).

---

## 2. Punto de partida

Un VPS de 8 GB con docker compose: `api`, `worker`, `whatsapp`, `dashboard`, `landing`, `postgres` (pgvector, PG16), `pgbouncer`, `redis`, túnel de Cloudflare y un stack de observabilidad (Grafana, Loki, Promtail, Dozzle, Uptime Kuma).

Hallazgos del inventario del código que condicionan el diseño:

| Tema | Hecho | Referencia |
|---|---|---|
| Tablas por tenant | 249 tablas distintas (254 sentencias, 5 repetidas) y 394 índices explícitos en la plantilla; 1.000–1.400 relaciones por tenant contando llaves primarias y TOAST | `apps/api/prisma/tenant-schema.sql` |
| DDL en ejecución | 59 archivos crean tablas con `CREATE TABLE IF NOT EXISTS` fuera de la plantilla | p. ej. `widget/widget-schema.ts` |
| Arranque | API y worker recorren **todos** los schemas de tenant en `onModuleInit`, con bloqueos `ACCESS EXCLUSIVE` | `modules/prisma/prisma.service.ts` |
| Migración de tenants | Secuencial, un tenant por transacción | `apps/api/scripts/migrate-tenants.js` |
| Enrutamiento por tenant | `SET LOCAL search_path` dentro de transacción; candados solo de transacción; sin `LISTEN/NOTIFY` | `prisma.service.ts:197-221` |
| Vectores | `vector(1536)` con índice `ivfflat lists=100`; no hay HNSW | `tenant-schema.sql:326-330` |
| Proceso único | API y worker arrancan el mismo `AppModule`: la API también consume todas las colas y corre todos los crons | `main.ts`, `worker.main.ts` |
| Crons | 97 decoradores; 65 usos de candado Redis (`CronLockService`), que falla abierto; ~10 archivos sin candado; el servicio de WhatsApp no tiene ninguno | `modules/redis/cron-lock.service.ts` |
| WebSockets | 3 gateways socket.io (`/inbox`, `/agent`, `/widget`); relay por Redis solo para eventos que nacen en el worker; sin adaptador de Redis; clientes con respaldo a polling | `modules/redis/ws-relay.service.ts` |
| Redis | Una instancia para colas, candados, sesiones, caché y límites; scripts Lua multi-llave sin hash tags; sin TLS | `modules/throttle/tenant-throttle.service.ts` |
| Archivos | Media, facturas DIAN y archivos comprimidos de conversaciones en disco local; no existe abstracción de S3 | `media/media.service.ts`, `fiscal/fiscal-storage.service.ts` |
| Media pública | `GET /api/v1/media/file/:tenantId/:fileName` sin autenticación (Meta descarga de ahí) | `media/media.controller.ts:126` |
| Apagado | La API drena hasta 150 s; p99 de un turno ≈ 100 s | `main.ts`, compose |
| Salud | `/api/v1/health` responde 200 aun degradado; el worker no tiene health check | `health/health.controller.ts:31` |
| Borde | `CF-Connecting-IP` y `CF-IPCountry` leídos en varios puntos; no hay `trust proxy` | `common/utils/trusted-client-ip.util.ts` |
| Límites de cola | Los limitadores de BullMQ son globales por cola (salientes: 20/s) | `@Processor` de cada cola |

Lo que **ya** está bien para varias réplicas: el candado de crons, el relay worker → API, la idempotencia del turno (`messages.external_id`, `turn:done:*`, `dedupeId`), y la ausencia de requisitos de IP fija de salida.

---

## 3. Arquitectura objetivo

```
                    Cloudflare (DNS, WAF, CDN) — parallly-chat.cloud
        ┌────────────────────────────┬─────────────────────────────┐
        │  landing ──► Cloudflare Pages / Workers (estático)        │
        │  admin. / api. / wa. ──► túnel ──► cloudflared en ECS     │
        │  media ──► R2 (URLs firmadas)                             │
        └────────────────────────────┬─────────────────────────────┘
                                     │ túnel saliente (sin puertos abiertos)
                              cloudflared ×2 ──► ALB interno
   VPC 10.x  ·  2 zonas (3 más adelante)
   ┌─────────────────────────────────┴──────────────────────────────────┐
   │ Subredes privadas — ECS (Fargate, ARM/Graviton)                     │
   │   api (HTTP + socket.io)      ← escala por CPU / peticiones         │
   │   worker-turnos (inbound, outbound) ← escala por profundidad de cola│
   │   worker-lotes (difusión, evaluaciones, facturación, crons)         │
   │   whatsapp (webhooks Meta, Embedded Signup)                         │
   │   dashboard (Next.js)                                               │
   │   pgbouncer (modo transacción)                                      │
   │   tarea única: migraciones (pública + tenants)                      │
   ├─────────────────────────────────────────────────────────────────────┤
   │ Subredes aisladas — datos                                           │
   │   RDS PostgreSQL 17 Multi-AZ — tablas compartidas con tenant_id     │
   │   (celda 1; más celdas al crecer, vía directorio tenant → celda)    │
   │   ElastiCache Valkey: primario + réplica, noeviction                │
   └──────────────┬──────────────────────────────────────────────────────┘
                  │ NAT Gateway (salida a LLM, Meta, Wompi, Stripe, Sentry)
                  ▼
   S3: facturas (Object Lock 5 años) · archivos · logs      R2: media
   Secrets Manager / Parameter Store · KMS · ECR · CloudWatch · SES
   Respaldo: PITR de RDS + AWS Backup con copia a una segunda región
```

### 3.1 Cómputo

- **ECS sobre Fargate con ARM (Graviton).** ~20 % más barato que x86: una tarea de 1 vCPU + 2 GB cuesta $28,84/mes contra $36,04. Las imágenes `node:20-alpine` son multi-arquitectura; hay que verificar los módulos nativos (`sharp`, `bcrypt`) en ARM.
- **Cinco servicios más PgBouncer**, cada uno con al menos dos tareas en zonas distintas.
- **Separar roles con una variable (`PROCESS_ROLE`)**: `api` sin consumidores de cola; `worker-turnos` para `inbound-messages` y `outbound-messages`; `worker-lotes` para difusiones, simulaciones, evaluaciones, facturación y crons. Así una evaluación larga no le quita capacidad a los turnos de clientes y cada rol escala por su propia métrica.
- **Autoescalado:** la API por CPU o peticiones por objetivo del balanceador; `worker-turnos` por una métrica propia publicada a CloudWatch (trabajos en espera + activos de `inbound-messages`).
- **Límite de apagado de Fargate: 120 s** (verificado; hoy la API drena hasta 150 s). Dos caminos:
  - *Recomendado al inicio:* todo en Fargate, techo de drenaje en ~110 s. Con la API ya sin consumidores su drenaje es corto; en el worker, un turno que supere 110 s durante un despliegue queda «stalled» y BullMQ lo reintenta, lo cual el turno ya tolera por ser idempotente. Conviene subir `maxStalledCount` a 2.
  - *Alternativa:* `worker-turnos` sobre ECS Managed Instances (admite apagados largos, hasta 86.400 s). Cuesta el precio de EC2 más ~12 % de gestión y empaqueta varias tareas por instancia; pasa a ser atractivo en la etapa 2 por costo.
- **Fargate Spot:** solo para `worker-lotes` y entornos de prueba (~65 % menos), nunca para turnos de clientes.

### 3.2 Datos

- **RDS PostgreSQL 17, Multi-AZ, almacenamiento gp3.** La CI ya valida contra PG17. Extensiones `vector` y `uuid-ossp` disponibles. Recuperación a un punto en el tiempo de hasta 35 días.
- **Por qué no Aurora al inicio:** no hay evidencia publicada de que su almacenamiento maneje mejor cientos de miles de relaciones; la alta disponibilidad exige pagar una segunda instancia; y Aurora Serverless v2 cuesta $0,12 por ACU-hora (≈$88/mes por cada 1 ACU sostenido). Vale reevaluarlo cuando hagan falta réplicas de lectura para analítica.
- **Descartados:** Aurora DSQL (máximo 10 schemas y 1.000 tablas, sin extensiones) y Aurora Limitless (no admite el modelo de schema por tenant).
- **PgBouncer como servicio propio en ECS**, igual configuración que hoy más `server_lifetime` corto (300–600 s). Este parámetro importa: cada conexión de PostgreSQL guarda en memoria el catálogo de todas las tablas que ha tocado y nunca lo libera; reciclar conexiones es la mitigación conocida.
- **RDS Proxy:** viable en principio (el código usa `SET LOCAL`, que no fija la conexión), pero sin probar con Prisma y sin la consola `SHOW POOLS` que usa el Ops Center. Dejarlo como experimento, no como plan.
- **Redis → ElastiCache Valkey**, un primario y una réplica en zonas distintas, modo cluster desactivado, grupo de parámetros con `maxmemory-policy noeviction`, TLS y autenticación. Valkey cuesta 20 % menos que Redis OSS.
  - ElastiCache Serverless queda descartado: BullMQ lo desaconseja porque no permite `noeviction`.
  - La replicación es asíncrona: un failover puede perder segundos de escrituras (trabajos encolados o tokens de refresco). El turno es idempotente frente a duplicados, no frente a trabajos que desaparecen. MemoryDB cierra ese hueco pero solo funciona en modo cluster, que exigiría reescribir los scripts multi-llave. Queda como mejora futura.
  - En la etapa 2 separar en dos grupos: colas (BullMQ) y todo lo demás (sesiones, caché, límites).
- **pgvector se queda.** Al reconstruir conviene cambiar `ivfflat` por HNSW: `ivfflat` construido sobre una tabla vacía da mala recuperación. S3 Vectors es la única alternativa con costo casi nulo en reposo; se reevalúa si las bases de conocimiento crecen mucho.

### 3.3 Archivos

- **S3 desde el primer día** (no EFS: cuesta ~13 veces más y perpetúa el diseño de disco compartido **[sin verificar la tarifa exacta]**).
- Tres buckets: `media` (por prefijo de tenant, con ciclo de vida), `fiscal` y `archivos` (conversaciones comprimidas).
- **La media va mejor en R2 de Cloudflare que en S3:** $0,015/GB contra $0,023, sin cobro por salida de datos, y cumple la cláusula de Cloudflare que restringe servir por su CDN una proporción alta de imágenes, audio o archivos grandes que no estén alojados en sus servicios. R2 habla el protocolo de S3, así que la capa de almacenamiento es la misma con otro destino. Facturas y archivos se quedan en S3.
- **Facturas DIAN:** bucket dedicado con versionado y **Object Lock en modo cumplimiento a 5 años**: nadie, ni la cuenta raíz, puede borrar o acortar la retención. Replicación a una segunda región.
- **Media privada:** el endpoint público sin autenticación se reemplaza por URLs firmadas de corta vida (Meta las descarga igual). Subidas grandes directas a S3 con URL prefirmada, en lugar de base64 por la API (hoy el límite de cuerpo es 50 MB).

### 3.4 Borde y red

**Decisión: mantener Cloudflare.** La primera versión de este análisis proponía CloudFront Pro ($15/mes) con balanceador privado; esa combinación no existe, porque el origen privado de CloudFront empieza en el plan Business ($200/mes).

| | Cloudflare Free / Pro + túnel | CloudFront Pro | CloudFront Business |
|---|---|---|---|
| Precio base | $0 / $25 al mes | $15 al mes | $200 al mes |
| Origen privado | Sí, por el túnel | No (balanceador público) | Sí |
| Peticiones incluidas | Sin tope publicado | 10 M/mes | 125 M/mes |
| Ciudades en Colombia | 4 (Bogotá, Medellín, Cali, Barranquilla) | 1 (Bogotá) | 1 |
| Dominios propios de tenants | 100 incluidos, luego $0,10 c/u | No soportado | No soportado |
| Subida máxima / respuesta máxima | 100 MB / 125 s (fijos) | 64 GB / hasta 120 s | igual |
| SLA | No (empieza en Business, $250) | No | Sí |

Costo estimado del borde con Cloudflare, sumando el túnel y la salida de datos de AWS: ~$20/mes con 5 M de peticiones, ~$50 con 20 M, ~$147 con 50 M y 1 TB. A ese volumen todas las opciones convergen entre $100 y $230/mes: la decisión es por límites y operación.

- **Túnel:** servicio de ECS con dos tareas de `cloudflared` que apuntan a un balanceador interno. Las réplicas hacen respaldo entre sí, no reparto de carga. No hay guía oficial para Fargate; es un patrón de la comunidad. Conviene ubicarlas en subred pública ($3,65/mes de IP cada una) para que su tráfico no pase por el NAT ($0,045/GB).
- **El balanceador interno se conserva:** da health checks y permite el despliegue canario de ECS.
- **Plan:** Free durante la construcción; **Pro ($25/mes) cuando haya clientes pagando**, porque Free trae solo 5 reglas de WAF propias y una regla de límite de tasa, sin las reglas administradas ni OWASP. Webhooks públicos y pantalla de login las necesitan.
- **Límites a respetar:** 125 s de respuesta (cualquier endpoint síncrono más lento debe volverse asíncrono, p. ej. Agent Test) y 100 MB por subida. Cloudflare reinicia sus servidores en cada publicación y corta los WebSockets abiertos; socket.io reconecta solo.
- **Riesgo aceptado:** sin SLA ni soporte prioritario por debajo de Business. Para un SaaS B2B es el punto débil de esta opción; se reevalúa cuando un contrato con un cliente lo exija.
- **Ventajas que se conservan:** Cloudflare Access (gratis hasta 50 usuarios) para herramientas internas, Turnstile, y Cloudflare for SaaS si los tenants piden dominio propio para el portal de ayuda o el chat web.
- **Sin cambios de código en el borde:** `CF-Connecting-IP` y `CF-IPCountry` siguen llegando. Solo hay que declarar los rangos de `cloudflared` y del balanceador en `TRUSTED_PROXY_CIDRS`.
- **Landing:** Cloudflare Pages o Workers (estático, gratis) en lugar de un contenedor.
- **Red:** VPC con subredes públicas (solo NAT), privadas (cómputo) y aisladas (datos). Un NAT Gateway al inicio ($32,85/mes + $0,045/GB); dos cuando una caída de zona deba ser transparente. Endpoint de S3 tipo gateway (gratis **[sin verificar]**). Los endpoints de interfaz ($7,30/mes por zona cada uno) no compensan hasta que el tráfico por NAT sea alto.
- **Zona local de Bogotá** (disponible desde 2026-11-20): solo EC2 Intel, sin Fargate, RDS ni ElastiCache. No sirve como sede; queda en observación.

### 3.5 Correo

- **Amazon SES** por su interfaz SMTP: `nodemailer` funciona sin cambios de código. $0,10 por cada 1.000 correos.
- Requiere salir del modo de prueba (solicitud a AWS) y configurar DKIM, SPF y DMARC en el dominio.
- **SES Tenants** aísla la reputación por tenant ($0,005 por tenant/mes); adoptarlo si los tenants envían con su propia identidad.

---

## 4. Catálogo de AWS: qué adoptar

### Adoptar desde el inicio

| Servicio | Para qué |
|---|---|
| ECS Fargate (ARM) + ECR | Cómputo y registro de imágenes; elimina la dependencia de GHCR en el despliegue |
| Despliegues nativos de ECS | Canario para la API, gradual con reversión automática para los workers |
| ECS Exec + SSM Session Manager | Acceso de soporte sin SSH ni puertos abiertos |
| RDS PostgreSQL Multi-AZ | Base de datos con failover y recuperación a un punto en el tiempo |
| ElastiCache Valkey | Colas, candados, sesiones, caché |
| S3 + Object Lock | Archivos y retención legal |
| Cloudflare (se conserva) + ACM | Borde, WAF, DNS y túnel; ACM para el certificado del balanceador interno |
| Secrets Manager + Parameter Store | Reemplaza el `.env` regenerado en cada despliegue |
| KMS | Cifrado en reposo con pocas llaves propias |
| SES | Correo transaccional |
| CloudWatch (logs, métricas, alarmas, Synthetics) | Reemplaza Loki, Promtail, Dozzle y Uptime Kuma |
| Organizations + IAM Identity Center | Cuentas separadas y acceso del equipo sin usuarios IAM |
| OIDC de GitHub Actions | Despliegues sin llaves de larga duración |
| CloudTrail, GuardDuty, Security Hub, Access Analyzer | Auditoría y detección de amenazas |
| AWS Backup + replicación entre regiones | Respaldo fuera de la región |
| Budgets + Cost Anomaly Detection | Alertas de gasto (esencial mientras se consumen créditos) |
| CDK en TypeScript | Infraestructura en el mismo lenguaje del producto |

### Adoptar más adelante

| Servicio | Cuándo |
|---|---|
| ECS Managed Instances | Cuando el empaquetado de workers reduzca costo o haga falta un apagado > 120 s |
| EventBridge Scheduler | Para trabajos nocturnos pesados como tareas independientes (agregación de métricas, snapshots financieros) |
| SQS con «fair queues» | Si un tenant ruidoso empieza a retrasar a los demás en `inbound-messages`; es la única función nativa que supera a BullMQ aquí |
| Bedrock | Como proveedor adicional del router LLM (Claude, modelos OpenAI, Mistral, DeepSeek disponibles en `us-east-1`); útil como nivel de respaldo y posiblemente pagable con créditos **[sin verificar]** |
| S3 Vectors | Bases de conocimiento muy grandes o frías |
| Transcribe, Bedrock Data Automation | Transcripción ($0,006/min) o extracción estructurada de documentos, si sale mejor que el LLM multimodal |
| Application Signals, Managed Grafana | Cuando haga falta trazabilidad de extremo a extremo o tableros compartidos |
| Athena, Redshift Serverless, zero-ETL | Cuando la analítica entre tenants empiece a pesar sobre la base transaccional |
| Fault Injection Service | Simulacro de caída de zona antes del lanzamiento |
| Aurora Global, pooled con RLS | Etapas 3–4 |

### No adoptar

| Servicio | Motivo |
|---|---|
| EKS (Kubernetes) | Costo fijo y complejidad sin beneficio para cinco servicios |
| CloudFront, AWS WAF, Route 53 | Cloudflare cubre lo mismo por $0–25/mes con origen privado y más presencia en Colombia (§3.4) |
| App Runner, Copilot CLI | Cerrado a clientes nuevos y sin soporte, respectivamente |
| Lambda para el núcleo | No puede alojar socket.io ni workers de BullMQ |
| API Gateway WebSocket, AppSync Events | socket.io usa su propio protocolo; exigiría reescribir los tres gateways y los clientes |
| End User Messaging Social (WhatsApp por AWS) | Solo vincula un WABA propio y AWS toma su control; no reemplaza el Embedded Signup multi-tenant y agrega una tarifa por mensaje |
| Cognito | La autenticación actual (5 roles, impersonación auditada, rotación de refresh) es parte del producto; Cognito obligaría a reconstruirla |
| Bedrock Knowledge Bases | El modelo de conocimiento de 5 niveles y las reglas R3–R7 viven en el código |
| Step Functions | El backend ya es dueño del flujo |
| ElastiCache Serverless, Aurora DSQL, Aurora Limitless | Incompatibles con BullMQ o con schema por tenant |
| RDS Proxy (por ahora) | Sin probar con Prisma; PgBouncer ya está validado |
| Network Firewall, Client VPN, Shield Advanced, Macie | Costo fijo alto ($288/mes por zona, $73/mes, $3.000/mes) para el riesgo actual |
| EFS | S3 desde el primer día |

**Sobre mantener BullMQ.** El producto depende de trabajos diferidos de más de 15 minutos, prioridad por plan, `dedupeId`, limitadores por cola y reintentos con rescate de «stalled». SQS no ofrece ninguno de forma nativa. La ganancia de migrar no paga la reescritura.

**Sobre los crons.** El candado de Redis ya resuelve la doble ejecución con N réplicas. Lo razonable es cerrar los ~10 huecos, hacer que falle cerrado donde un duplicado causa daño, y concentrar los crons en `worker-lotes`; no reescribir 97 crons hacia EventBridge.

---

## 5. Cambios de código requeridos

Ordenados por dependencia. Los marcados **bloqueante** deben estar antes de correr dos réplicas.

| # | Cambio | Tipo |
|---|---|---|
| 1 | Capa de almacenamiento sobre S3 para media, facturas y archivos de conversaciones (hoy `fs` directo en 6+ servicios) | **Bloqueante** |
| 2 | Media por URL firmada en lugar del endpoint público sin autenticación | **Bloqueante** (seguridad) |
| 3 | `PROCESS_ROLE`: la API deja de consumir colas y correr crons; dos tipos de worker | **Bloqueante** para escalar por rol |
| 4 | Adaptador de Redis para socket.io (o publicar siempre al relay) y transporte solo-websocket o sesiones pegajosas en el balanceador | **Bloqueante** |
| 5 | Sacar del arranque el DDL que recorre todos los tenants; moverlo a la tarea de migración | **Bloqueante** (arranque crece con los tenants y bloquea tablas) |
| 6 | Health checks reales: listo/no-listo con 503 para el balanceador; sonda para el worker | **Bloqueante** |
| 7 | Redis con TLS y autenticación; revisar `maxRetriesPerRequest` y reconexión ante failover | **Bloqueante** |
| 8 | Techo de drenaje ≤ 110 s y `maxStalledCount` 2 | Necesario en Fargate |
| 9 | Candado en los ~10 crons sin protección y en el servicio de WhatsApp | Necesario |
| 10 | Rangos de proxy confiables para `cloudflared` y el balanceador interno (las cabeceras de Cloudflare no cambian) | Necesario |
| 11 | Ops Center: reemplazar lecturas de disco/RAM del contenedor y `SHOW POOLS` por métricas de CloudWatch; el latido de backup pasa a AWS Backup | Necesario |
| 12 | Publicar la profundidad de colas como métrica de CloudWatch | Necesario para autoescalar |
| 13 | Directorio tenant → celda (`tenants.cell_id` y un cliente de base de datos por celda), aunque exista una sola | Barato ahora, caro después |
| 14 | **Modelo de datos: tablas compartidas con `tenant_id` y seguridad por fila**, en tres fases (§6) | El cambio más grande y el de mayor retorno; hacerlo antes de tener clientes reales |
| 15 | Revisar el limitador global de salientes (20/s ≈ 1,7 M mensajes/día) | Etapa 3 |
| 16 | HNSW en lugar de `ivfflat` en la plantilla | Recomendado |

**Aprovechar el arranque limpio**

- **Línea base de migraciones:** hay 106 migraciones de Prisma más la plantilla de tenant y 59 creadores de tablas en ejecución. Un entorno nuevo permite consolidar en una línea base y comprobar que `prisma migrate deploy` + la plantilla levantan una plataforma completa desde cero. Esa comprobación debe quedar en la CI.
- **Retirar lo que solo existía por historia:** barridos de reparación al arranque, scripts de corte de octubre, backup por `docker exec`, y lo que quede de rutas `legacy`. Cada retiro necesita revisar quién lo cita.
- **Llaves nuevas:** todos los secretos (`ENCRYPTION_KEY`, JWT, llaves internas) se generan de nuevo en Secrets Manager; ninguno se copia del VPS.

---

## 6. Modelo de datos: de schema por tenant a tablas compartidas

Esta es la decisión de mayor impacto en costo de todo el análisis.

### 6.1 Qué hay hoy

La plantilla define **249 tablas distintas** (254 sentencias: `courses`, `eval_runs` y `operational_notice_outbox` están dos veces y `customer_memory_erasure` tres) y 394 índices. Cada tenant recibe las 249, sea cual sea su tipo de negocio: entre 1.000 y 1.400 relaciones por tenant contando llaves primarias y TOAST (estimación, no medida).

Clasificación tras revisar el uso de cada tabla en `apps/api/src`:

| Clase | Tablas | Qué son |
|---|---|---|
| Núcleo | 79 | Mensajería, identidad, CRM, consentimiento, configuración del agente, conocimiento, citas |
| Función opcional | 35 | Automatización, difusiones, formularios, pagos del tenant, HubSpot, reseñas, turnos de personal, e-commerce |
| Vertical | 52 | Restaurantes, tours, alojamiento, gimnasios, seguros, vehículos, mascotas, educación, etc. Solo las usa el tipo de negocio correspondiente |
| Operativas / telemetría | 70 | Trazas, evaluaciones, simulaciones, certificación, bandejas de salida, registros de webhooks, métricas. Casi ninguna tiene llave foránea hacia el núcleo |
| Sin uso aparente | 13 | `business_rules`, `tool_configs`, `carla_*` (3), `campaign_courses`, `intake_sources`, `wait_jobs`, `knowledge_chunks`, `knowledge_approvals`, `kb_health_issues`, `dashboard_preferences`, `conversation_memory` |

Solo 25 de las 249 tienen ya columna `tenant_id`. Un tenant de restaurante carga hoy con 170 tablas que nunca va a usar.

### 6.2 Cómo lo hacen las plataformas grandes

Ninguna de las verificadas da un schema a cada cliente.

| Empresa | Modelo |
|---|---|
| Salesforce | Tablas compartidas; cada fila lleva el identificador de la organización |
| Shopify | Tablas compartidas con `shop_id`; tiendas agrupadas en «pods»; un enrutador sabe en qué pod vive cada tienda; mudanzas en línea entre pods |
| Notion | 480 fragmentos lógicos sobre 32 bases PostgreSQL; cada fragmento contiene muchos clientes |
| Slack, HubSpot, Intercom | Tablas compartidas repartidas en fragmentos (Vitess) |
| Figma | Fragmentación horizontal de PostgreSQL por llave |
| Zendesk | Pods; un cliente grande puede tener fragmento propio |
| Atlassian (Jira) | La excepción: una base por cliente, ~4 M de bases en ~3.000 servidores, con equipo de plataforma dedicado y herramientas propias; parte ya migra a otro motor |

El único caso documentado de schema por cliente a escala (17.000–19.000 schemas) es un rescate de consultoría que recomendó consolidar.

**El patrón común:** tablas compartidas con columna de tenant, tenants agrupados en celdas, un directorio tenant → celda, y los clientes muy grandes en celda propia.

### 6.3 El mecanismo propuesto

Un schema `shared` con las tablas una sola vez, cada una con `tenant_id` y seguridad por fila:

```sql
CREATE TABLE shared.turn_traces (
  tenant_id uuid NOT NULL DEFAULT current_setting('app.tenant_id')::uuid,
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ...
);
ALTER TABLE shared.turn_traces ENABLE ROW LEVEL SECURITY;
ALTER TABLE shared.turn_traces FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON shared.turn_traces
  USING      (tenant_id = (SELECT current_setting('app.tenant_id')::uuid))
  WITH CHECK (tenant_id = (SELECT current_setting('app.tenant_id')::uuid));
```

El ayudante que hoy fija el schema del tenant pasa a fijar también el tenant, en la misma transacción:

```sql
SET LOCAL search_path TO "<schema_del_tenant>", shared, public;
SELECT set_config('app.tenant_id', $1, true);
```

**Por qué esto abarata el cambio.** Unas 1.750 llamadas (`executeInTenantSchema` y `transactionInTenantSchema`, en ~200 archivos) usan nombres de tabla sin calificar. Con este mecanismo siguen funcionando sin tocarlas: el `SELECT` lo filtra la política, el `INSERT` recibe el `tenant_id` por defecto, y `UPDATE`/`DELETE` quedan acotados. Si alguien olvida fijar el tenant, `current_setting` lanza error: falla cerrado, no filtra datos.

Es compatible con PgBouncer en modo transacción, igual que el `SET LOCAL search_path` actual.

**Modo mixto.** Mientras convivan tablas por tenant y compartidas, el `search_path` resuelve cada nombre donde esté. Eso permite mover tablas por tandas y tener un sistema funcional en cada paso.

### 6.4 Lo que sí hay que cambiar

| Trabajo | Tamaño medido |
|---|---|
| Plantilla: `tenant_id`, índices encabezados por `tenant_id`, restricciones únicas que lo incluyan | 249 tablas, 394 índices |
| Cláusulas `ON CONFLICT (...)` cuyo destino cambia al agregar `tenant_id` a la restricción única | ~125 apariciones en 78 archivos (parte son de tablas públicas) |
| Consultas con el schema escrito a mano (`"${schema}".tabla`) que no pasan por el ayudante | ~500 en 46 archivos; los mayores: `ai-tool-executor.service.ts` (104), `spend-ledger.ts` (49), `dashboard-analytics.service.ts` (43) |
| Creación de tablas en ejecución | 59 archivos; todas duplican la plantilla y se eliminan |
| Entorno aislado de «Probar agente» (schemas `tenant_eval_*` clonados) y el hash de estructura de `evaluation-revision` | Rediseño |
| Baja, exportación y borrado de un tenant (hoy `DROP SCHEMA` y `pg_dump` por schema) | Herramientas por `tenant_id` |
| Rol de base de datos del runtime: no dueño de las tablas y sin `BYPASSRLS`; rol aparte para migraciones | Configuración |
| Copias heredadas en `public` con el mismo nombre que tablas de tenant (13 en la lista de purga) | Eliminarlas: hoy una consulta sin calificar cae en ellas si falta la tabla del tenant |
| Prueba automática de aislamiento | Una comprobación en CI: toda tabla de `shared` tiene RLS activa, forzada y con política |

Los 32 servicios programados que recorren tenants siguen funcionando igual; más adelante pueden volverse una sola consulta.

### 6.5 Orden recomendado

Sin datos reales no hay que rellenar ni migrar nada: mover una tabla es cambiar la plantilla y revisar el código que la usa. Esa ventaja termina el día que entra el primer cliente real.

| Fase | Tablas | Contenido | Tablas por tenant al terminar |
|---|---|---|---|
| 1 · Limpieza y telemetría | 83 | Eliminar las 13 sin uso; pasar a `shared` las 70 operativas. Son las de más filas y las más fáciles: casi sin llaves foráneas al núcleo | 166 |
| 2 · Verticales y funciones | 87 | Pasar a `shared` las 52 verticales y las 35 de funciones opcionales. La mayoría de tenants tiene cero filas en ellas | 79 |
| 3 · Núcleo | 79 | Mensajes, contactos, conversaciones, CRM, conocimiento, citas | 0 |

- **Recomendación: llegar a la fase 3 antes de lanzar.** Es el diseño que usa la industria y el que cuesta entre 7 y 15 veces menos.
- **Si el tiempo aprieta, lanzar al terminar la fase 2 es aceptable:** quedan 79 tablas por tenant (un tercio), cada celda rinde unas tres veces más, y la fase 3 se hace después con relleno por tenant, que con pocos clientes es barato.
- **Alternativa descartada: crear las tablas verticales bajo demanda.** Ya existe la primitiva (`ensureCanonicalTables`), pero obligaría a que `migrate-tenants.js` y la reparación de schemas conozcan el manifiesto de capacidades (hoy recrearían todas las tablas en cada despliegue), a romper llaves foráneas del núcleo hacia `courses`, y cada tabla creada invalidaría el hash de evaluaciones previas. Más trabajo que compartirlas, y con peor resultado.

### 6.6 Simplificaciones que conviene hacer de paso

- **Modelos duplicados:** dos modelos de embudo (`opportunities`/`stage_history` y `deals`/`stage_transitions`, sincronizados en cada arranque); `persona_config` y `agent_personas`; `products`, `ecommerce_products` y `vi_items`; `properties` y `cm_listings`.
- **Cinco familias de «corridas»** con forma parecida: `simulation_runs`, `eval_runs`, `benchmark_runs`, `agent_certification_runs`, `rehearsal_runs`.
- **Unas nueve bandejas de salida** con la misma estructura.
- **Cinco nombres en la lista de clonado de evaluación que no existen** en ninguna plantilla: `tool_approval_events`, `appointment_settings`, `appointment_holds`, `appointment_blocked_dates`, `class_waitlist`.

Cada fusión es una decisión de producto aparte; aquí solo quedan señaladas.

### 6.7 Vectores en tablas compartidas

Los índices aproximados filtran por tenant **después** de buscar, así que en una tabla compartida devolverían pocos resultados del tenant correcto. Para tenants pequeños la recomendación de pgvector es búsqueda exacta sobre un índice B-tree por `tenant_id`; un índice HNSW parcial o una partición propia solo para tenants con decenas de miles de fragmentos. El umbral exacto no está medido en ninguna fuente **[sin verificar]**; hay que probarlo con datos propios. El índice actual (`ivfflat lists=100` por tenant, creado sobre tabla vacía) ya es deficiente, así que el cambio mejora la recuperación.

### 6.8 Lo que se pierde y cómo se compensa

| Se pierde | Compensación |
|---|---|
| Aislamiento físico por schema: un filtro olvidado podría cruzar datos | Seguridad por fila forzada como red de respaldo, rol sin privilegios, prueba de aislamiento en CI |
| Restaurar un solo tenant con `pg_dump -n` | Restaurar el respaldo a una instancia temporal y extraer por `tenant_id` |
| Borrar un tenant con `DROP SCHEMA` | Borrado por `tenant_id` en todas las tablas, con verificación |
| Un tenant pesado ya no está apartado | `statement_timeout`, límites por tenant y, llegado el caso, celda propia |
| Una migración afecta a todos a la vez | Es también la ganancia: una migración en lugar de N; la regla expand-contract sigue vigente |

### 6.9 Celdas

El directorio tenant → celda se mantiene desde el primer día, con una sola celda. En tablas compartidas el límite de una celda deja de ser el número de tenants y pasa a ser almacenamiento y consultas por segundo. Estimación de partida: **5.000–20.000 tenants pequeños por celda**, sin dato publicado que la respalde; hay que medirla. Un cliente grande o un plan superior puede tener celda dedicada.

### 6.10 Diferencia de costo

Supuestos del cálculo (no medidos): ~5.000 mensajes al mes y ~0,1 GB al año por tenant; picos de 5 a 10 veces el promedio.

| | 5.000 tenants | 100.000 tenants |
|---|---|---|
| Schema por tenant, celdas de 300 | 17 instancias, ~$5.900/mes | 334 instancias, ~$117.000/mes |
| Tablas compartidas | 1 instancia, ~$460–820/mes | 4–8 fragmentos, ~$8.000–13.500/mes |
| Por tenant al mes | ~$1,20 contra ~$0,09–0,16 | ~$1,17 contra ~$0,08–0,14 |

La cifra de 300 tenants por celda puede ser conservadora (Atlassian empaqueta ~4.000 bases por cluster), pero llegar ahí le exigió herramientas propias.

**Qué significa «millones».** Millones de mensajes al día y millones de contactos finales: alcanzables con cualquiera de los dos modelos. Cientos de miles o millones de *tenants*: solo con tablas compartidas.

---

## 7. Cuentas, seguridad y políticas

**Cuentas (AWS Organizations)**

| Cuenta | Contenido |
|---|---|
| Administración | Solo facturación, Organizations e Identity Center. Sin cargas de trabajo |
| Producción | La plataforma |
| Staging | Copia reducida, apagable |
| (Etapa 2) Seguridad / registro | Registros de auditoría inmutables |

Control Tower automatiza esta estructura sin costo propio, pero activa AWS Config, cuyo costo crece con recursos efímeros. Para un equipo pequeño alcanza con Organizations + Identity Center + un rastro de CloudTrail de toda la organización; Control Tower puede sumarse después.

**Confirmar:** en qué cuenta quedaron los $5.000 de créditos. Para que cubran producción y staging esa cuenta debe ser la pagadora de la organización, con el uso compartido de créditos activo **[sin verificar el comportamiento exacto]**.

**Políticas base**

- **Identidad:** nadie usa la cuenta raíz ni usuarios IAM; acceso por Identity Center con MFA. GitHub Actions asume un rol por OIDC limitado al repositorio y a la rama `main`.
- **Mínimo privilegio por servicio:** un rol de tarea por servicio. Solo `worker` y `api` leen/escriben los buckets que usan; solo la tarea de migración tiene el usuario de base de datos con permiso de DDL; el runtime usa otro usuario sin `CREATE SCHEMA` (hoy el runtime hace DDL: hay que separar esos permisos).
- **Red:** grupos de seguridad encadenados (borde → balanceador → servicios → PgBouncer → base de datos). Bases de datos sin ruta a internet.
- **Cifrado:** en reposo con KMS (RDS, ElastiCache, S3, logs) y en tránsito con TLS, incluido Redis.
- **Secretos:** en Secrets Manager, referenciados por ARN en la definición de tarea. Desaparece la regla de «agregar la variable en GitHub Secrets y en `deploy.yml`».
- **Datos personales (Colombia):** la Circular 005 de 2017 de la SIC incluye a EE. UU. entre los países con nivel adecuado; aun así el responsable debe demostrar medidas apropiadas. Un abogado debe confirmar que la lista no cambió con las circulares de 2025–2026.
- **Gasto:** presupuesto mensual con alertas al 50/80/100 % y detección de anomalías desde el día uno.

---

## 8. Entrega e infraestructura como código

- **CDK en TypeScript**, en una carpeta `infra/cdk/` con pilas separadas: red, datos, servicios, borde, observabilidad. Terraform/OpenTofu es una alternativa razonable, con más sentido si Cloudflare se conservara.
- **Flujo de despliegue** (GitHub Actions se mantiene; CodePipeline no aporta):
  1. `validate` y `e2e-smoke` como hoy.
  2. Construir imágenes ARM y subirlas a ECR.
  3. Ejecutar la **tarea de migración** (pública + tenants) y exigir su línea de resumen, igual que hoy.
  4. Desplegar workers (gradual, con reversión automática), luego API (canario), luego dashboard.
- La regla expand-contract sigue vigente: el código viejo convive con el schema nuevo durante el despliegue.
- **Reversión:** volver a la definición de tarea anterior; sin reconstruir.
- **Entornos efímeros** para candidatos: ECS Express Mode o una pila de CDK descartable.

---

## 9. Observabilidad, respaldo y recuperación

- **Logs:** stdout (Pino JSON) → CloudWatch Logs con retención corta (14–30 días) y exportación a S3 para historia. Clase de acceso infrecuente ($0,25/GB) para grupos verbosos.
- **Métricas y alarmas:** Container Insights, métricas de RDS/ElastiCache/ALB, y las propias (profundidad de colas, latencia de turno).
- **Disponibilidad externa:** 3–5 sondas de CloudWatch Synthetics cada 5 min.
- **Errores:** Sentry se mantiene tal cual.
- **Ops Center:** se conserva como vista de producto, alimentado por CloudWatch en lugar de leer el host.
- **Respaldo:** PITR de RDS; AWS Backup con copia diaria a una segunda región (`us-east-2`); versionado y replicación de S3; snapshots de ElastiCache.
- **Recuperación ante desastre («luz piloto»):** respaldos, buckets e imágenes replicados, y las pilas de CDK listas para desplegarse en la segunda región. Costo: decenas de dólares al mes a tamaños pequeños (estimación mía). Objetivo realista: pérdida de minutos, restablecimiento en horas.
- **Prueba obligatoria antes de lanzar:** restaurar de verdad un respaldo y simular la caída de una zona.

---

## 10. Costos

Tarifas base usadas (`us-east-1`, bajo demanda):

| Recurso | Tarifa | Mensual |
|---|---|---|
| Fargate ARM, 1 vCPU / 1 GB | $0,03238/h · $0,00356/h | $23,64 · $2,60 |
| RDS PostgreSQL db.t4g.medium Multi-AZ | $0,129/h | $94,17 |
| RDS PostgreSQL db.m8g.large Multi-AZ | $0,336/h | $245,28 |
| RDS PostgreSQL db.r8g.large Multi-AZ | $0,478/h | $348,94 |
| Almacenamiento gp3 Multi-AZ | $0,23/GB-mes | — |
| Valkey cache.t4g.small / m7g.large (por nodo) | $0,0256 / $0,1264 por h | $18,69 / $92,27 |
| ALB | $0,0225/h + $0,008 por LCU-h | $16,43 + uso |
| NAT Gateway | $0,045/h + $0,045/GB | $32,85 + uso |
| IPv4 pública | $0,005/h | $3,65 |
| S3 Standard | $0,023/GB-mes | — |
| CloudWatch Logs | $0,50/GB ingerido | — |
| Salida a internet | $0,09/GB | — |

### Etapa 0 — Construcción (~$235/mes)

Un entorno sin alta disponibilidad para adaptar el código y probar los scripts desde cero.

| Concepto | Detalle | Mensual |
|---|---|---|
| Cómputo | 1 tarea por servicio + PgBouncer | $66 |
| Base de datos | db.t4g.medium Single-AZ + 20 GB | $50 |
| Redis | 1 × cache.t4g.small | $19 |
| Balanceador | ALB | $19 |
| NAT + IP | 1 NAT Gateway | $39 |
| Borde | Cloudflare Free + 1 tarea de túnel | $7 |
| Resto | Logs, secretos, KMS, ECR, S3, seguridad base | $34 |

### Etapa 1 — Lanzamiento (~$420–445/mes)

Producción en dos zonas, hasta ~50 tenants y ~15.000 turnos/día.

| Concepto | Detalle | Mensual |
|---|---|---|
| Cómputo | api 2×(0,5 vCPU/1 GB), worker 2×(1/2), whatsapp 2×(0,25/0,5), dashboard 2×(0,25/1), pgbouncer 2×(0,25/0,5) | $132 |
| Base de datos | db.t4g.medium Multi-AZ + 50 GB | $106 |
| Redis | 2 × cache.t4g.small | $37 |
| Balanceador | ALB + uso | $22 |
| NAT + IP | 1 NAT Gateway | $40 |
| Borde | Cloudflare Free ($0) o Pro ($25) + túnel 2×(0,25/0,5) | $14–39 |
| Observabilidad | Logs ~20 GB, métricas, alarmas, sondas | $30 |
| Seguridad y respaldo | GuardDuty, Security Hub, CloudTrail, Backup, KMS, secretos | $37 |
| Almacenamiento | S3, ECR | $3 |

Staging siempre encendido suma ~$235; apagado fuera de pruebas, una fracción. Soporte Business+ es opcional desde $29/mes.

### Etapa 2 — Crecimiento (~$1.700/mes con tablas compartidas; ~$2.100 con celdas por schema)

Supuesto: ~500 tenants, ~150.000 turnos/día (300 por tenant), hora pico = 10 % del día.

| Concepto | Detalle | Mensual |
|---|---|---|
| Cómputo | worker ~10 tareas promedio (16 en pico), api 4×(1/2), dashboard 3, whatsapp 2, pgbouncer 2 | $505 |
| Base de datos | 1 × db.r8g.large Multi-AZ + 300 GB (con schema por tenant serían 2 celdas, $790) | $418 |
| Redis | 2 × cache.m7g.large | $185 |
| Red | ALB interno, 2 NAT Gateways, ~300 GB por NAT | $120 |
| Borde | Cloudflare Pro + túnel 2×(0,5/1) + salida de datos | $75 |
| Observabilidad | ~200 GB de logs | $115 |
| Seguridad, respaldo, almacenamiento | — | $130 |
| Soporte Business+ | 9 % del gasto | ~$140 |

Costo de infraestructura por tenant: **~$3,4/mes**. Con compromisos a 1 año baja a ~$1.400.

### Etapa 3 — Escala (~$7.000–9.000/mes con tablas compartidas; ~$11.000–15.000 con celdas por schema)

Supuesto: ~5.000 tenants, ~1,5 M turnos/día.

| Concepto | Detalle | Mensual |
|---|---|---|
| Cómputo | ~100 tareas de worker promedio, api 12×(2/4), resto | ~$3.900 |
| Base de datos | 2 × db.r8g.xlarge Multi-AZ + 600 GB, dimensionado con holgura (con schema por tenant: ~17 celdas, ~$6.700) | ~$1.500 |
| Redis | 2 grupos r7g.large | ~$500 |
| Borde y red | Cloudflare Pro o Business, túnel, NAT, 1–3 TB de salida | ~$700 |
| Observabilidad | ~1–2 TB de logs con muestreo | ~$600 |
| Seguridad, respaldo, almacenamiento, soporte | — | ~$1.200 |

Con tablas compartidas el cómputo pasa a ser el mayor costo, y ese sí crece en proporción al uso real. Costo por tenant: **~$1,4–1,8/mes** contra ~$2,2–2,8 con schema por tenant.

### Cómo bajar la factura

- **Compromisos a 1 año sin pago inicial:** −20 % a −27 % en cómputo (Compute Savings Plan), −33 % en RDS m8g/r8g con instancias reservadas, −32 % en ElastiCache. Comprar solo cuando la carga base sea estable (etapa 2). Las `t4g` de base de datos solo admiten reserva.
- **Spot** para `worker-lotes` y staging.
- **Apagar staging** fuera de horario.
- **Retención corta de logs** y muestreo de los verbosos: los logs son el costo que más se descontrola.
- **Créditos:** revisar vencimiento y servicios excluidos en la consola de facturación. Los $5.000 cubren la construcción y aproximadamente el primer año de producción.

### Lo que este modelo no incluye

Tokens de LLM, tarifas de Meta por mensaje, Sentry, Expo/EAS, comisiones de Wompi y Stripe. Es muy probable que el LLM sea el mayor costo variable del producto, por encima de toda la infraestructura.

---

## 11. Plan de construcción

No hay migración de datos, así que el plan es de construcción y validación.

| Fase | Contenido | Criterio de salida |
|---|---|---|
| A · Cimientos | Organización, cuentas, Identity Center, presupuestos, CloudTrail, OIDC, repositorio de CDK | Nadie usa la cuenta raíz; alertas de gasto activas |
| B · Código | Cambios 1–12 del §5, desarrollados contra el entorno de la etapa 0 | Dos réplicas de cada servicio funcionando sin disco compartido |
| C · Desde cero | Línea base de migraciones; tarea de migración; alta de un tenant de prueba de punta a punta | Un entorno vacío queda operativo con un solo comando, verificado en CI |
| D · Producción | Topología de la etapa 1, despliegue canario, sondas, respaldos | Simulacro de caída de zona y restauración real de un respaldo superados |
| E · Corte | Apuntar el túnel de Cloudflare a AWS (el DNS no cambia); dar de baja los tenants de prueba; reconfigurar webhooks de Meta, Telegram, Wompi y Stripe; redirecciones OAuth | Mensaje real de WhatsApp atendido de extremo a extremo |
| F · Apagado | Retirar el VPS, el túnel, GHCR en el despliegue y los scripts que ya no aplican | Documentación actualizada (K4) y ADR aprobado |

Las URL públicas no cambian (`api.`, `admin.`, `wa.`), así que las aplicaciones de Meta, las redirecciones OAuth y la app móvil siguen apuntando a los mismos nombres.

---

## 12. Riesgos y puntos sin verificar

| Riesgo | Mitigación |
|---|---|
| El tamaño de celda (5.000–20.000 tenants en tablas compartidas; 250–400 con schema por tenant) es una estimación | Prueba de carga con tenants sintéticos antes de la etapa 2 |
| Failover de Redis puede perder segundos de trabajos | Idempotencia existente + barrido de mensajes entrantes sin turno; evaluar durabilidad síncrona más adelante |
| Módulos nativos en ARM | Probar en la fase B; x86 cuesta 25 % más si hiciera falta |
| Turnos > 110 s cortados en despliegues | `maxStalledCount` 2; Managed Instances si resulta frecuente |
| Cloudflare sin SLA por debajo de Business; el túnel es infraestructura propia | Dos réplicas de `cloudflared`, alarma sobre su salud; subir de plan cuando un contrato lo exija |
| Un filtro de tenant olvidado en tablas compartidas | Seguridad por fila forzada, rol sin privilegios y prueba de aislamiento en CI (§6.8) |
| Endpoints síncronos > 125 s tras Cloudflare | Identificarlos en la fase B y volverlos asíncronos |
| Costo de logs y de NAT crece sin avisar | Presupuestos, retención corta, endpoint de S3 |
| Créditos que vencen o excluyen servicios | Revisar en la consola antes de crear recursos |

**Sin verificar en fuente primaria:** vencimiento y exclusiones de los créditos Activate; cobertura de WebSockets en los planes de tarifa plana de CloudFront; gratuidad del endpoint gateway de S3, Parameter Store estándar y certificados de ACM; tarifa por ejecución de Synthetics; ubicación de los servidores de Meta y de los proveedores de LLM; latencia medida desde Bogotá (la cifra citada es de una sola prueba residencial en el Eje Cafetero); si la lista de países adecuados de la SIC cambió en 2025–2026; comportamiento de BullMQ durante un failover más allá de reconexión y rescate de «stalled».

---

## 13. Decisiones

**Ya resueltas por el dueño (2026-11-23)**

- En el VPS solo hay tenants de prueba y pruebas gratuitas abandonadas: se dan de baja. No hay facturas DIAN que conservar. No se migra nada.
- El borde debe costar casi cero: se mantiene Cloudflare (§3.4).
- **Modelo de datos (2026-11-24):** tablas compartidas con `tenant_id` y seguridad por fila, llevadas **hasta la fase 3 (núcleo incluido) antes de lanzar** (§6.5). Formalizado en [ADR 0034](../../decisions/0034-tablas-compartidas-con-tenant-id.md); plan de la fase 1 en [shared-tables-phase-1-plan.md](shared-tables-phase-1-plan.md).

**Pendientes**

1. **Orden de trabajo:** si el cambio de modelo de datos se hace primero en el VPS actual o directamente sobre el entorno de construcción en AWS.
2. **Staging:** siempre encendido (~$235/mes) o bajo demanda.
3. **Worker:** Fargate con drenaje de 110 s, o Managed Instances desde el inicio.
4. **Media:** R2 de Cloudflare (recomendado) o S3.
5. **Fusiones de modelos duplicados** señaladas en §6.6: cuáles se abordan en este ciclo.

---

## Fuentes

- Precios: archivos oficiales AWS Price List (`pricing.us-east-1.amazonaws.com/offers/v1.0/aws/...`) para ECS, EC2, RDS, ElastiCache, MemoryDB, ELB, VPC, S3, CloudFront, WAF, CloudWatch y SES; archivos de Savings Plans de cómputo y de bases de datos. Consultados el 2026-11-23.
- Límites de ECS/Fargate: [parámetros de tarea de Fargate](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task_definition_parameters.html), [Managed Instances](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/task_definition_parameters-managed-instances.html), [despliegues canario nativos](https://aws.amazon.com/about-aws/whats-new/2025/10/amazon-ecs-built-in-linear-canary-deployments/).
- RDS Proxy: [causas de fijación de conexión](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/rds-proxy-pinning.html).
- BullMQ: [ElastiCache](https://docs.bullmq.io/guide/redis-tm-hosting/aws-elasticache), [paso a producción](https://docs.bullmq.io/guide/going-to-production), [Redis Cluster](https://docs.bullmq.io/patterns/redis-cluster).
- Aurora DSQL y Limitless: [cuotas de DSQL](https://docs.aws.amazon.com/aurora-dsql/latest/userguide/CHAP_quotas.html), [límites de Limitless](https://docs.aws.amazon.com/AmazonRDS/latest/AuroraUserGuide/limitless-reference.DDL-limitations.html).
- Multi-tenencia: [modelos silo, bridge y pool](https://docs.aws.amazon.com/prescriptive-guidance/latest/saas-multitenant-managed-postgresql/matrix.html), [arquitectura por celdas](https://docs.aws.amazon.com/wellarchitected/latest/reducing-scope-of-impact-with-cell-based-architecture/what-is-a-cell-based-architecture.html), [Crunchy Data sobre multi-tenencia](https://crunchydata.com/blog/designing-your-postgres-database-for-multi-tenancy).
- Multi-tenencia a gran escala: [Shopify pods](https://shopify.engineering/a-pods-architecture-to-allow-shopify-to-scale), [Notion](https://www.notion.com/blog/sharding-postgres-at-notion), [Slack](https://slack.engineering/scaling-datastores-at-slack-with-vitess/), [Figma](https://www.figma.com/blog/how-figmas-databases-team-lived-to-tell-the-scale/), [Salesforce](https://architect.salesforce.com/fundamentals/platform-multitenant-architecture), [Atlassian](https://www.atlassian.com/blog/atlassian-engineering/migrating-jira-database-platform-to-aws-aurora), [caso de 17.000 schemas](https://www.commandprompt.com/about/success-stories-case-studies/from-unrecoverable-to-under-control-taming-multi-tenant-postgresql-at-17000-schemas/).
- Seguridad por fila y vectores: [documentación de PostgreSQL](https://www.postgresql.org/docs/current/ddl-rowsecurity.html), [rendimiento de RLS (Supabase)](https://supabase.com/docs/guides/troubleshooting/rls-performance-and-best-practices-Z5Jjwv), [pgvector: filtrado](https://github.com/pgvector/pgvector/blob/master/README.md).
- Cloudflare: [planes](https://www.cloudflare.com/plans/network-cdn.md), [límites de conexión](https://developers.cloudflare.com/fundamentals/reference/connection-limits/), [disponibilidad del túnel](https://developers.cloudflare.com/cloudflare-one/networks/connectors/cloudflare-tunnel/configure-tunnels/tunnel-availability/), [términos específicos del servicio](https://www.cloudflare.com/service-specific-terms-application-services/), [precios de R2](https://developers.cloudflare.com/r2/pricing/).
- Borde de AWS (descartado): [planes de tarifa plana de CloudFront](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/flat-rate-pricing-plan.html), [WebSockets en VPC origins](https://aws.amazon.com/about-aws/whats-new/2026/05/amazon-cloudfront-websockets-vpc-origins/), [cuotas de CloudFront](https://docs.aws.amazon.com/AmazonCloudFront/latest/DeveloperGuide/cloudfront-limits.html).
- Mensajería: [End User Messaging Social](https://docs.aws.amazon.com/social-messaging/latest/userguide/getting-started-whatsapp.html), [SES Tenants](https://aws.amazon.com/about-aws/whats-new/2025/08/amazon-ses-tenant-isolation-automated-reputation-policies/).
- Región y latencia: [prueba de la zona local de Bogotá](https://dev.to/dcastillogi/aws-local-zone-en-bogota-latencia-y-costos-frente-a-virginia-ohio-y-sao-paulo-325g), [anuncio de la zona local](https://aws.amazon.com/about-aws/whats-new/2026/11/aws-local-zone-bogota-colombia/).
- Datos personales: [Circular Externa 005 de 2017 de la SIC](https://normograma.dian.gov.co/dian/compilacion/docs/circular_superindustria_0005_2017.htm).
- Programas: [AWS Activate](https://aws.amazon.com/startups/credits), [planes de soporte](https://aws.amazon.com/premiumsupport/pricing/), [Database Savings Plans](https://aws.amazon.com/savingsplans/database-pricing/).
