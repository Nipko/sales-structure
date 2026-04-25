# Manual de Offboarding — Parallly

## Resumen

Este documento describe cómo desconectar, suspender o eliminar un tenant (cliente) de la plataforma Parallly, incluyendo todos los canales conectados (WhatsApp, Instagram, Messenger, Telegram, SMS) y servicios integrados (Google Calendar, Microsoft Calendar).

---

## 1. Estados del Tenant

```
active → grace_period → suspended → archived → deleted
           (7 días)       (30 días)   (90 días)
```

| Estado | Descripción | Canales | Login | Datos |
|--------|------------|---------|-------|-------|
| `active` | Operación normal | Activos | Permitido | Intactos |
| `grace_period` | Pago fallido, 7 días de gracia | Activos (banner de aviso) | Permitido | Intactos |
| `suspended` | Gracia expirada / cancelación voluntaria / admin | Desconectados | Bloqueado (pantalla de suspensión) | Intactos pero inaccesibles |
| `archived` | 30 días después de suspensión | N/A | Bloqueado | Exportados, schema marcado |
| `deleted` | 90 días después de suspensión | N/A | N/A | Schema eliminado, PII borrado |

---

## 2. Escenarios de Offboarding

### 2.1 Cancelación Voluntaria (el usuario quiere irse)

1. Usuario va a Settings → Subscription → Cancel
2. Se marca `cancelAtPeriodEnd = true` en Stripe
3. El tenant sigue activo hasta el fin del periodo pagado
4. Al expirar → auto-suspensión

**Qué hacer manualmente (si no hay Stripe aún):**
```bash
# En la DB directamente:
UPDATE tenants SET is_active = false, subscription_status = 'cancelled' WHERE id = '<tenant-id>';
```

### 2.2 Fallo de Pago (tarjeta declinada)

1. Stripe envía webhook `invoice.payment_failed`
2. Se marca `subscriptionStatus = 'past_due'`
3. Inicia periodo de gracia de 7 días
4. Si paga dentro de 7 días → restaurar a `active`
5. Si no paga → auto-suspensión

### 2.3 Suspensión por Admin (violación de políticas)

1. Super admin ejecuta suspensión
2. Desconexión inmediata de todos los canales
3. Sesiones de usuario revocadas
4. Razón registrada en audit log

### 2.4 Downgrade de Plan

- Los canales NO se desconectan
- Se desactivan agentes/calendarios que excedan el nuevo límite
- El usuario debe elegir cuáles mantener

---

## 3. Desconexión Canal por Canal

### 3.1 WhatsApp (Embedded Signup / Cloud API)

**Lo que se conectó originalmente:**
- El WABA (WhatsApp Business Account) del cliente se asignó al System User de Parallly
- Se generó un token permanente con permisos `whatsapp_business_management` + `whatsapp_business_messaging`
- La app se suscribió a los webhooks del WABA
- El token encriptado se guardó en `whatsapp_credentials`

**Pasos de desconexión:**

1. **Desuscribir webhooks del WABA:**
   ```
   DELETE https://graph.facebook.com/v21.0/{wabaId}/subscribed_apps
   Headers: Authorization: Bearer {system_user_token}
   ```

2. **Remover System User del WABA:**
   ```
   DELETE https://graph.facebook.com/v21.0/{wabaId}/assigned_users?user={SYSTEM_USER_ID}
   Headers: Authorization: Bearer {client_token_or_admin_token}
   ```

3. **Marcar credencial como revocada:**
   ```sql
   UPDATE whatsapp_credentials 
   SET rotation_state = 'revoked', updated_at = NOW() 
   WHERE tenant_id = '<tenant-id>';
   ```

4. **Desactivar channel_account:**
   ```sql
   UPDATE channel_accounts 
   SET is_active = false 
   WHERE tenant_id = '<tenant-id>' AND channel_type = 'whatsapp';
   ```

5. **Actualizar schema del tenant:**
   ```sql
   UPDATE "tenant_xxx".whatsapp_channels 
   SET channel_status = 'disconnected', updated_at = NOW();
   ```

**¿Qué pasa con el número de WhatsApp?**
- El número PERMANECE con el cliente en su WABA
- El cliente puede conectar el número a otro proveedor (BSP)
- Los message templates creados durante la conexión se quedan en el WABA del cliente
- Parallly ya no puede enviar ni recibir mensajes por ese número

**¿El cliente puede desconectar desde Meta directamente?**
Sí. En Meta Business Suite → Settings → Business Settings → Partners → remover Parallly. Esto revoca el acceso inmediatamente. Parallly debería implementar el **Deauthorize Callback** para detectar esto automáticamente.

### 3.2 Instagram / Messenger

**Desconexión:**
1. Revocar permisos (opcional, el token expira):
   ```
   DELETE https://graph.facebook.com/v21.0/me/permissions?access_token={page_token}
   ```

2. Desactivar en DB:
   ```sql
   UPDATE channel_accounts 
   SET is_active = false 
   WHERE tenant_id = '<tenant-id>' AND channel_type IN ('instagram', 'messenger');
   ```

3. Marcar credenciales como revocadas:
   ```sql
   UPDATE whatsapp_credentials 
   SET rotation_state = 'revoked' 
   WHERE tenant_id = '<tenant-id>' AND credential_type IN ('instagram_token', 'messenger_token');
   ```

**Impacto:** La página de Instagram/Facebook del cliente NO se ve afectada. Solo se pierde la capacidad de Parallly de leer/responder mensajes.

### 3.3 Telegram

**Desconexión:**
1. Remover webhook del bot:
   ```
   POST https://api.telegram.org/bot{token}/deleteWebhook
   ```

2. Desactivar en DB:
   ```sql
   UPDATE channel_accounts 
   SET is_active = false 
   WHERE tenant_id = '<tenant-id>' AND channel_type = 'telegram';
   ```

**Impacto:** El bot sigue existiendo en Telegram (BotFather lo creó). Deja de responder porque el webhook fue removido. El cliente conserva el token del bot.

### 3.4 SMS (Twilio)

**Desconexión:**
1. Desactivar en DB:
   ```sql
   UPDATE channel_accounts 
   SET is_active = false 
   WHERE tenant_id = '<tenant-id>' AND channel_type = 'sms';
   ```

2. Las credenciales de Twilio (accountSid, authToken) pertenecen al cliente. Parallly solo deja de usarlas.

**Nota:** Opcionalmente, el cliente debería remover el webhook URL de su número en la consola de Twilio.

### 3.5 Google Calendar

**Desconexión:**
1. Revocar OAuth token:
   ```
   POST https://oauth2.googleapis.com/revoke?token={refresh_token}
   ```

2. Desactivar en DB:
   ```sql
   UPDATE "tenant_xxx".calendar_integrations 
   SET is_active = false, updated_at = NOW();
   ```

**Impacto:** Los eventos creados por Parallly permanecen en el calendario del cliente. Son datos del cliente.

### 3.6 Microsoft Calendar (Outlook)

**Desconexión:**
1. Revocar sesiones:
   ```
   POST https://graph.microsoft.com/v1.0/me/revokeSignInSessions
   ```

2. Desactivar en DB (igual que Google).

---

## 4. Proceso Completo de Offboarding

### Orden de ejecución:

```
1. Detener procesamiento de mensajes entrantes
2. Drenar cola de mensajes salientes (BullMQ)
3. Desconectar WhatsApp (más complejo primero)
4. Desconectar Instagram / Messenger
5. Desconectar Telegram
6. Desconectar SMS
7. Desconectar calendarios (Google/Microsoft)
8. Revocar todas las credenciales
9. Revocar sesiones de usuario
10. Cancelar suscripción (Stripe)
11. Marcar tenant como suspendido
12. Enviar email de confirmación
13. Registrar en audit log
```

### Script de offboarding manual (emergencias):

```bash
# Variables
TENANT_ID="xxxxx"
SCHEMA="tenant_xxx"

# 1. Desactivar tenant
docker exec parallext-postgres psql -U parallext -d parallext_engine -c "
  UPDATE tenants SET is_active = false, subscription_status = 'cancelled' WHERE id = '${TENANT_ID}';
"

# 2. Desactivar canales
docker exec parallext-postgres psql -U parallext -d parallext_engine -c "
  UPDATE channel_accounts SET is_active = false WHERE tenant_id = '${TENANT_ID}';
"

# 3. Revocar credenciales
docker exec parallext-postgres psql -U parallext -d parallext_engine -c "
  UPDATE whatsapp_credentials SET rotation_state = 'revoked' WHERE tenant_id = '${TENANT_ID}';
"

# 4. Desactivar calendarios
docker exec parallext-postgres psql -U parallext -d parallext_engine -c "
  UPDATE \"${SCHEMA}\".calendar_integrations SET is_active = false;
"

# 5. Revocar sesiones Redis
docker exec parallext-redis redis-cli KEYS "refresh:*" | xargs -I{} docker exec parallext-redis redis-cli DEL {}
# Nota: esto revoca TODAS las sesiones. Para revocar solo las del tenant, 
# necesitás los user IDs del tenant.

echo "Tenant ${TENANT_ID} offboarded"
```

---

## 5. Retención de Datos

| Fase | Tiempo | Qué pasa |
|------|--------|----------|
| Suspensión | Día 0 | Canales desconectados, cuenta bloqueada. Datos intactos. |
| Aviso de archivo | Día 30 | Email: "Tus datos serán archivados en 7 días" |
| Archivo | Día 37 | Datos exportados como ZIP encriptado en cold storage. Schema marcado. |
| Aviso de eliminación | Día 90 | Email: "Tus datos serán eliminados permanentemente en 7 días" |
| Eliminación | Día 97 | `DROP SCHEMA tenant_xxx CASCADE`. PII eliminado. Media borrado. |

### Datos que se conservan permanentemente:
- Registros de pagos/facturas (requerimiento legal)
- Audit logs (compliance)
- Registro del tenant (soft-deleted con timestamp)
- Métricas agregadas (sin PII)

### Datos que se eliminan:
- Conversaciones completas
- Contactos (nombre, teléfono, email)
- Leads y oportunidades
- Archivos multimedia (`/data/media/{tenantId}/`)
- Credenciales encriptadas
- Configuración de agentes

---

## 6. Reactivación

**Dentro de los 90 días (antes de eliminación):**

1. Usuario intenta hacer login → ve pantalla "Cuenta suspendida" con botón "Reactivar"
2. Reactivación requiere: método de pago válido + selección de plan
3. Sistema crea nueva suscripción en Stripe
4. Restaura `tenantStatus = 'active'`, `isActive = true`
5. **Los canales deben reconectarse manualmente** (los tokens fueron revocados)
6. Datos (conversaciones, contactos, agentes, KB) siguen ahí

**Después de los 90 días:**
- El schema fue eliminado
- Reactivación crea un tenant nuevo (schema nuevo, datos limpios)
- Los datos anteriores son irrecuperables

---

## 7. Gestión desde Meta Business Suite

### Ver qué clientes están conectados:

1. Ir a [business.facebook.com](https://business.facebook.com)
2. Settings (⚙️) → Business Settings
3. **Users → Partners**: muestra qué negocios compartieron su WABA con tu app
4. **Accounts → WhatsApp Accounts**: muestra todos los WABAs vinculados

### Desconectar un cliente desde Meta:

1. Business Settings → WhatsApp Accounts
2. Seleccionar el WABA del cliente
3. "Remove" quita el acceso de tu app
4. El cliente conserva su número

### Meta Developer Dashboard:

1. [developers.facebook.com](https://developers.facebook.com) → Tu app
2. WhatsApp → Getting Started → Números registrados
3. Aquí ves los números de prueba, no los de clientes (los de clientes están en Business Suite)

---

## 8. Callbacks de Meta (por implementar)

### Deauthorize Callback

Cuando un cliente revoca acceso a tu app desde Meta:

```
POST /api/v1/webhooks/meta/deauthorize
Body: { signed_request: "..." }
```

Acción: detectar el tenant afectado → auto-desconectar canales → notificar admin.

### Data Deletion Request

Cuando Meta envía una solicitud de eliminación de datos:

```
POST /api/v1/webhooks/meta/data-deletion
Body: { signed_request: "..." }
```

Acción: iniciar eliminación de datos del tenant → responder con URL de status + código de confirmación.

Estos URLs se configuran en: Facebook App Dashboard → Settings → Basic → Data Deletion URL / Deauthorize Callback URL.

---

## 9. Checklist de Offboarding

- [ ] Notificar al cliente por email (fecha de suspensión, qué pasa con sus datos)
- [ ] Desconectar WhatsApp (webhook + system user + credenciales)
- [ ] Desconectar Instagram/Messenger (revocar tokens)
- [ ] Desconectar Telegram (deleteWebhook)
- [ ] Desconectar SMS (desactivar)
- [ ] Desconectar calendarios (revocar OAuth + desactivar)
- [ ] Revocar todas las sesiones de usuario
- [ ] Cancelar suscripción en Stripe
- [ ] Marcar tenant como inactivo
- [ ] Registrar en audit log
- [ ] Verificar que no quedan jobs en BullMQ para este tenant
- [ ] Confirmar que webhooks ya no llegan (verificar logs por 24h)

---

## 10. FAQ

**¿Qué pasa si el cliente vuelve a conectar WhatsApp con otro proveedor?**
Nada. El número está en su WABA. Pueden conectarlo con cualquier BSP. Solo necesitan pasar por el proceso de migración si cambian de Cloud API a On-Premise o viceversa.

**¿Los message templates se pierden?**
No. Los templates pertenecen al WABA del cliente, no a Parallly. Se quedan con ellos.

**¿Puedo ver los mensajes después de desconectar?**
Los mensajes están en la DB de Parallly hasta que se elimine el schema (90 días). El cliente puede solicitar un export.

**¿Qué pasa con las citas agendadas?**
Las citas en la DB permanecen. Los eventos en Google/Microsoft Calendar del cliente permanecen. Solo se pierde la sincronización bidireccional.

**¿El offboarding es reversible?**
Sí, dentro de los primeros 90 días. Después de eso, el schema se elimina y los datos son irrecuperables.
