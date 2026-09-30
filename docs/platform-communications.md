# Comunicaciones generales de Parallly

La sección **Superadmin → Operación de plataforma → Comunicaciones**, en `/admin/communications`, permite preparar y enviar correos administrativos a usuarios de los negocios. Requiere una sesión de plataforma con rol `super_admin`; no está disponible para tenants ni durante la impersonación.

## Preparar y enviar un comunicado

1. Crear un borrador o elegir **Usar aviso de Meta** para cargar el comunicado sobre los pagos de WhatsApp del 1 de octubre de 2026. Esa acción solo carga contenido editable.
2. Darle un nombre interno y seleccionar audiencia: todos los negocios activos o aquellos con una cuenta de WhatsApp activa. Elegir todos sus usuarios activos o únicamente administradores. Se puede limitar a negocios específicos.
3. Escribir asunto y cuerpo en español. Completar inglés, portugués y francés cuando corresponda. Si falta una traducción, se usa español; la vista previa muestra esta alternativa. El idioma del destinatario procede del tenant.
4. Agregar opcionalmente un botón con texto y una URL HTTPS. El cuerpo admite texto y saltos de línea; se escapa al generar HTML.
5. Guardar. Enviar una prueba al correo del superadmin autenticado y revisar el resultado. La prueba utiliza el contenido guardado, no agrega destinatarios a la campaña.
6. Generar la vista previa de audiencia. Se guarda una lista con los destinatarios, idioma y dirección. Revisar el total y las filas antes de confirmar.
7. Confirmar el envío. La API lo deja en cola y el proceso de fondo realiza envíos individuales en lotes.
8. Consultar resultados por destinatario. Los fallos de rechazo confirmado admiten un reintento manual, con un máximo de tres intentos por destinatario.

Modificar un borrador invalida la vista previa anterior. Un comunicado que inició el envío queda cerrado a modificaciones y eliminación. Las solicitudes repetidas de envío con la misma versión no vuelven a crear destinatarios.

## Audiencia y alcance

- Solo usuarios y tenants activos. La opción «todos los usuarios» incluye los roles `tenant_admin`, `tenant_supervisor` y `tenant_agent`. Los usuarios sin tenant, superadmins y el rol heredado `tenant_viewer` quedan fuera.
- La opción de administradores incluye `tenant_admin`.
- Se normalizan y deduplican correos antes de guardar la audiencia. Una dirección inválida se omite.
- Los correos de facturación sin una cuenta de usuario asociada no se agregan automáticamente.
- La lista confirmada puede reducirse si un usuario se desactiva, cambia de dirección o deja de cumplir el filtro antes del envío. No se incorporan usuarios nuevos después de la vista previa.
- El filtro WhatsApp se basa en una conexión activa registrada por Parallly; no filtra por método de pago ni por preparación para enviar. Esos datos se consultan por separado en la configuración de WhatsApp.

Los avisos del dashboard y Novedades siguen administrándose en sus secciones existentes. Este envío general por correo no utiliza las campañas de contactos de un tenant.

## Cómo interpretar los resultados

| Estado | Significado |
| --- | --- |
| Pendiente | Está en la audiencia guardada y espera procesamiento. |
| Procesando | Un proceso tomó el destinatario para intentar el envío. |
| Aceptado | El servidor de correo aceptó el mensaje. No confirma entrega en bandeja ni lectura. |
| Fallido | No hubo aceptación; admite reintento manual si no alcanzó el máximo. |
| Incierto | No se pudo determinar si el servidor aceptó el mensaje. Revisar los registros del proveedor antes de enviar otro comunicado a esa dirección. |
| Omitido | El destinatario dejó de cumplir la audiencia o cambió de dirección después de la vista previa. |

No hay seguimiento de aperturas, webhooks de rebotes, programación futura, adjuntos ni reenvío automático de resultados inciertos en esta versión. Para compartir una guía desde el comunicado, publicarla en un destino accesible y usar el botón de enlace o la URL en texto.

La guía de Meta en español se incluyó en `apps/dashboard/public/help/meta-whatsapp-pagos-2026-10.pdf`, con enlaces en las cuatro versiones del comunicado y en la configuración de WhatsApp. Desplegar el dashboard y comprobar su URL pública antes de enviar esa plantilla.

## Operación y despliegue

- Aplicar la migración Prisma `20260930000000_add_platform_communications` con el procedimiento habitual de despliegue y `DIRECT_DATABASE_URL`. Regenerar el cliente Prisma al compilar la API.
- Reutiliza la configuración SMTP existente; no agrega credenciales ni variables de entorno nuevas.
- Tablas globales: `platform_communications` y `platform_communication_recipients`. Se guardan creador, editor y actor del envío, versiones, fechas y resultados.
- El procesador corre cada 15 segundos y toma hasta cinco destinatarios por ejecución. API y worker cargan el mismo módulo; las filas se reclaman atómicamente con `SKIP LOCKED` para impedir que dos procesos tomen el mismo destinatario.
- Una fila que quedó procesando más de 15 minutos se marca incierta. Esto evita repetir automáticamente un correo que pudo haber sido aceptado antes de que el proceso se interrumpiera.
- Los errores del servidor de correo se representan con códigos controlados. La interfaz no muestra credenciales ni la respuesta SMTP completa.

La migración y los cambios de código por sí solos no acreditan despliegue ni envío. Validar la sección con una cuenta superadmin, realizar una prueba al propio correo y después confirmar el comunicado real.

## Verificación de la integración del 30 de septiembre de 2026

Se avanzó `main` desde `8dd6b292` hasta `origin/main` en `72bdb96f` (866 commits),
se recuperaron los cambios locales y se resolvieron los conflictos conservando los
flujos de WhatsApp y los contratos de permisos del remoto. Las dependencias se
instalaron desde el lockfile con `npm ci --ignore-scripts`, sin modificarlo.

- Cliente Prisma regenerado, compilación de shared y TypeScript de API, dashboard y landing sin errores.
- 188 pruebas de API: módulo de comunicaciones, permisos, inventario de efectos externos, SMTP local/TLS y compatibilidad del correo fiscal. Todas pasaron.
- 106 pruebas de dashboard: permisos, navegación, contratos de conexión, preparación de WhatsApp y accesibilidad. Todas pasaron.
- Antes de la integración, la interfaz de Comunicaciones se probó en navegador con una API local simulada y correos ficticios: plantilla, guardado, revisión de destinatarios, confirmación, resultado y bloqueo del envío al editar la audiencia. No se enviaron mensajes a clientes reales.
- El enlace local del PDF respondió HTTP 200 con tipo `application/pdf`. La guía se actualizó después para describir la comprobación de financiación y los pendientes de conexión; verificar la copia desplegada antes de distribuirla.
- La prueba de arranque completo se volvió a intentar en el árbol integrado y quedó bloqueada por la dependencia nativa local `bcrypt`: falta su binario para este entorno Windows ARM64. La reconstrucción previa requería herramientas C++ ausentes. Las suites grandes de Jest se ejecutaron con 8 GB de heap de Node tras agotar el límite predeterminado de 4 GB.
- Pendiente validar la migración y el procesamiento con PostgreSQL/SMTP reales en el entorno de despliegue.

## Contratos de código

- API: `apps/api/src/modules/platform-communications/`.
- Correo: `EmailService.sendWithOutcome()` distingue aceptación, rechazo y resultado incierto; `send()` conserva su interfaz booleana.
- Dashboard: `apps/dashboard/src/app/admin/communications/`.
- Navegación y acceso: `packages/shared/src/dashboard-page-access.ts`, `navigation-contract.ts`, `roles.ts`, `AppSidebar.tsx`.
- Contenido del aviso de Meta: `meta-whatsapp-template.json` y el [paquete de comunicación](communications/meta-whatsapp-2026-10/README.md).
- Orientación sobre pagos: `WhatsAppRouteBrief.tsx` antes del registro, `WhatsAppPaymentMethodNotice.tsx` en el estado de conexión y `WhatsappFundingPanel.tsx` en la configuración del canal. Incluyen la guía y la ayuda de Meta.
- Lectura de evidencia: `GET /whatsapp/spend/funding-readiness`. Comprobación en Meta: `POST /channels/whatsapp/connection/check-funding`, restringida a administradores autorizados. La lectura `attached` no garantiza que Meta acepte un cargo; `unknown` no equivale a ausencia.
- Preparación operativa: `WhatsAppConnectedState.tsx` distingue pagos, zona horaria y pendientes del registro. El cupo gratuito comercial de Meta no elimina las comprobaciones técnicas de Parallly ni las pausas activas.
