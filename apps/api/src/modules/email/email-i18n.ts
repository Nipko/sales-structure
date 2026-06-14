/**
 * Parallly — Email i18n
 *
 * Lang-keyed message map for admin/tenant-user facing emails.
 * Mirrors the `MESSAGES` + `msg()` pattern used by booking-engine.service.ts,
 * but for transactional/billing email HTML built in email-layouts.ts.
 *
 * Conventions:
 *  - Keys are namespaced and descriptive: `verification.greeting`, `footer.tagline`, ...
 *  - Variable placeholders use double braces: `{{name}}`, `{{planName}}`.
 *  - emsg() normalizes the lang (first 2 chars, e.g. "es-CO" -> "es") and falls back to "es".
 *  - HTML-significant strings keep their inline tags (e.g. <strong>) so the layout
 *    stays identical across languages — only the human-readable text is translated.
 *
 * NOTE: logs/console strings are intentionally NOT translated (internal only).
 */

export const EMAIL_MSG: Record<'es' | 'en' | 'pt' | 'fr', Record<string, string>> = {
    es: {
        // ── Shared layout / footer ──
        'footer.tagline': 'Automatización conversacional inteligente',
        'footer.needHelp': '¿Necesitas ayuda? <a href="{{supportUrl}}" style="color:{{brandColor}};text-decoration:none;">Contacta a soporte</a>',

        // ── Security ──
        'security.header': '&#128274; Mantente seguro',
        'security.tip1': 'Nunca compartas tu contraseña o código de acceso con nadie. El equipo de Parallly <strong>nunca</strong> te pedirá tus datos de acceso.',
        'security.tip2': 'Activa la <strong>autenticación de dos factores (2FA)</strong> en tu perfil para mayor seguridad.',

        // ── Verification (OTP login) ──
        'verification.greeting': 'Hola {{name}},',
        'verification.body': 'Usa este código para completar tu inicio de sesión en <a href="{{siteUrl}}" style="color:{{brandColor}};text-decoration:none;font-weight:600;">Parallly</a>:',
        'verification.validity': 'Válido por 10 minutos. No compartas este código con nadie.',
        'verification.ifNotYou': 'Si no fuiste tú, <a href="{{loginUrl}}" style="color:{{brandColor}};">restablece tu contraseña</a> inmediatamente.',

        // ── Password reset ──
        'passwordReset.body': 'Recibimos una solicitud para restablecer tu contraseña en <a href="{{siteUrl}}" style="color:{{brandColor}};text-decoration:none;font-weight:600;">Parallly</a>. Usa este código:',
        'passwordReset.validity': 'Válido por 10 minutos. Si no solicitaste esto, ignora este correo.',
        'passwordReset.tip': 'Después de restablecer tu contraseña, te recomendamos activar la autenticación de dos factores (2FA) para mayor protección.',

        // ── Two-factor ──
        'twoFactor.body': 'Tu código de autenticación de dos factores para <a href="{{siteUrl}}" style="color:{{brandColor}};text-decoration:none;font-weight:600;">Parallly</a> es:',
        'twoFactor.validity': 'Válido por 5 minutos. Si no intentaste iniciar sesión, cambia tu contraseña inmediatamente.',

        // ── Welcome (tenant owner) ──
        'welcome.title': 'Bienvenido a Parallly',
        'welcome.subtitle': 'Tu cuenta para <strong>{{companyName}}</strong> ha sido creada exitosamente.',
        'welcome.feat1.title': 'Conecta tus canales',
        'welcome.feat1.desc': 'WhatsApp, Instagram, Messenger, Telegram y SMS en un solo lugar.',
        'welcome.feat2.title': 'Configura tu agente de IA',
        'welcome.feat2.desc': 'Personaliza respuestas, horarios y personalidad para automatizar ventas.',
        'welcome.feat3.title': 'Pipeline de ventas',
        'welcome.feat3.desc': 'Gestiona contactos, oportunidades y seguimiento desde el CRM integrado.',
        'welcome.feat4.title': 'Agenda citas',
        'welcome.feat4.desc': 'Booking automatizado con Google Calendar y confirmación por chat.',
        'welcome.cta': 'Ir al Dashboard',
        'welcome.tip': 'Comienza conectando tu primer canal de comunicación. El agente IA puede empezar a responder en minutos.',
        'welcome.closing': 'Si necesitas ayuda, estamos para ti.',

        // ── Password changed ──
        'passwordChanged.title': 'Contraseña actualizada',
        'passwordChanged.body': 'Hola {{name}}, tu contraseña en <a href="{{siteUrl}}" style="color:{{brandColor}};text-decoration:none;font-weight:600;">Parallly</a> ha sido cambiada exitosamente.',
        'passwordChanged.warning': '<strong>&#9888;&#65039; Si no realizaste este cambio</strong>, alguien podría tener acceso a tu cuenta. <a href="{{resetUrl}}" style="color:{{brandColor}};font-weight:600;">Restablece tu contraseña</a> y contacta a soporte inmediatamente.',

        // ── New trusted device ──
        'trustedDevice.title': 'Nuevo dispositivo de confianza',
        'trustedDevice.body': 'Hola {{name}}, se agregó un nuevo dispositivo de confianza a tu cuenta de <a href="{{siteUrl}}" style="color:{{brandColor}};text-decoration:none;font-weight:600;">Parallly</a>.',
        'trustedDevice.labelDevice': 'Dispositivo',
        'trustedDevice.labelIp': 'Dirección IP',
        'trustedDevice.labelDate': 'Fecha',
        'trustedDevice.note': 'Este dispositivo podrá iniciar sesión sin verificación de dos factores por 30 días.',
        'trustedDevice.warning': '<strong>&#9888;&#65039; Si no fuiste tú</strong>, ve a <a href="{{securityUrl}}" style="color:{{brandColor}};font-weight:600;">Configuración de seguridad</a> y revoca todos los dispositivos de confianza. Luego cambia tu contraseña.',

        // ── Invitation ──
        'invitation.introNamed': '<strong>{{inviter}}</strong> te invitó a unirte a <strong>{{tenant}}</strong> en Parallly como <strong>{{role}}</strong>.',
        'invitation.introAnon': 'Te invitaron a unirte a <strong>{{tenant}}</strong> en Parallly como <strong>{{role}}</strong>.',
        'invitation.title': 'Te estamos esperando',
        'invitation.cta': 'Aceptar invitación',
        'invitation.feat1.title': 'Bandeja unificada',
        'invitation.feat1.desc': 'Atiende conversaciones de todos los canales en un solo lugar.',
        'invitation.feat2.title': 'Asistente IA',
        'invitation.feat2.desc': 'Un copiloto inteligente que te sugiere respuestas y automatiza tareas.',
        'invitation.feat3.title': 'CRM integrado',
        'invitation.feat3.desc': 'Contactos, pipeline y seguimiento sin salir de la plataforma.',
        'invitation.expires': 'Este enlace expira el <strong>{{expires}}</strong>.',
        'invitation.ignore': 'Si no esperabas esta invitación, podés ignorar este correo.',
        'invitation.subject': 'Te invitaron a unirte a {{tenant}} en Parallly',

        // ── Welcome team member ──
        'teamWelcome.title': 'Bienvenido al equipo',
        'teamWelcome.subtitle': 'Hola {{name}}, ya formas parte de <strong>{{tenant}}</strong> como <strong>{{role}}</strong>.',
        'teamWelcome.feat1.title': 'Bandeja de entrada',
        'teamWelcome.feat1.desc': 'Accede a las conversaciones asignadas desde el inbox.',
        'teamWelcome.feat2.title': 'Respuestas rápidas',
        'teamWelcome.feat2.desc': 'Usa macros y respuestas predefinidas para agilizar la atención.',
        'teamWelcome.feat3.title': 'Copiloto IA',
        'teamWelcome.feat3.desc': 'El asistente te sugiere respuestas basadas en el contexto de cada conversación.',
        'teamWelcome.feat4.title': 'CRM y contactos',
        'teamWelcome.feat4.desc': 'Consulta el perfil de cada contacto, historial y notas en un solo lugar.',
        'teamWelcome.cta': 'Ir al Dashboard',
        'teamWelcome.tip': 'Explora la bandeja de entrada y familiarizate con las herramientas. Si tenés dudas, tu administrador puede ayudarte.',
        'teamWelcome.subject': 'Bienvenido a {{tenant}}',

        // ── Fallback message (agent notification) ──
        'fallback.heading': 'Nuevo mensaje recibido',
        'fallback.body': 'Recibiste un mensaje de <strong>{{leadName}}</strong> que no pudo ser entregado por el canal original.',
        'fallback.cta': 'Ver en Inbox',
        'fallback.note': 'Este mensaje fue enviado como fallback porque el canal de comunicación no estuvo disponible.',

        // ── Agent assignment ──
        'assignment.title': 'Nuevo lead asignado',
        'assignment.body': '<strong>{{leadName}}</strong> ha sido asignado a ti en etapa <strong>{{stage}}</strong>.',
        'assignment.cta': 'Ver contacto',
        'assignment.tip': 'Revisa el perfil del contacto y su historial de conversaciones para dar seguimiento efectivo.',

        // ── Billing: trial ending soon ──
        'trial.endingTitle': 'Tu prueba gratuita termina pronto',
        'trial.endingBody': 'Hola <strong>{{name}}</strong>, tu prueba del plan <strong>{{planName}}</strong> termina en <strong>{{days}} {{daysWord}}</strong>.',
        'trial.endingDetail': 'Elige un plan antes de que termine para mantener todas tus conversaciones, contactos y configuración.',
        'trial.endingCta': 'Elegir plan',
        'trial.endingTip': 'Si necesitas más tiempo, contacta a nuestro equipo de soporte.',
        'trial.endingSubject': 'Tu prueba gratuita termina pronto',

        // ── Billing: trial ended ──
        'trialEnded.title': 'Tu prueba gratuita ha terminado',
        'trialEnded.body': 'Hola <strong>{{name}}</strong>, tu período de prueba del plan <strong>{{planName}}</strong> ha finalizado.',
        'trialEnded.graceIntro': 'Tienes <strong>7 días</strong> para elegir un plan. Durante este período:',
        'trialEnded.grace1': '<strong>Días 1-3:</strong> Acceso completo con aviso',
        'trialEnded.grace2': '<strong>Días 3-7:</strong> Modo solo lectura (no podrás enviar mensajes ni crear contenido)',
        'trialEnded.grace3': '<strong>Después del día 7:</strong> Cuenta suspendida',
        'trialEnded.dataSafe': 'Tus datos están seguros. Al pagar, el acceso se restaura al instante.',
        'trialEnded.cta': 'Elegir plan ahora',
        'trialEnded.subject': 'Tu prueba gratuita ha terminado',

        // ── Billing: payment failed ──
        'paymentFailed.title': 'Tu pago no pudo procesarse',
        'paymentFailed.body': 'Hola <strong>{{name}}</strong>, no pudimos procesar el pago de tu plan <strong>{{planName}}</strong>.',
        'paymentFailed.detail': 'Tienes <strong>7 días</strong> para actualizar tu método de pago. Después de ese plazo, tu cuenta será suspendida.',
        'paymentFailed.cta': 'Actualizar método de pago',
        'paymentFailed.tip': 'Verifica que tu tarjeta tenga fondos suficientes y que los datos estén actualizados.',
        'paymentFailed.subject': 'Tu pago no pudo procesarse',

        // ── Billing: soft lock ──
        'softLock.title': 'Tu cuenta ha sido restringida',
        'softLock.body': 'Hola <strong>{{name}}</strong>, tu cuenta ahora está en <strong>modo solo lectura</strong>.',
        'softLock.detail': 'No podrás enviar mensajes, crear contenido ni modificar configuraciones. Te quedan <strong>{{days}} {{daysWord}}</strong> antes de que tu cuenta sea completamente suspendida.',
        'softLock.restore': 'Realiza un pago ahora para restaurar el acceso completo al instante.',
        'softLock.cta': 'Pagar y restaurar acceso',
        'softLock.subject': 'Tu cuenta ha sido restringida',

        // ── Billing: account suspended ──
        'suspended.title': 'Tu cuenta ha sido suspendida',
        'suspended.body': 'Hola <strong>{{name}}</strong>, tu cuenta de Parallly ha sido suspendida por falta de pago.',
        'suspended.detail': 'Tus datos están seguros y se conservarán por 90 días. Puedes reactivar tu cuenta en cualquier momento realizando un pago.',
        'suspended.cta': 'Reactivar cuenta',
        'suspended.tip': 'Si crees que esto es un error, contacta a nuestro equipo de soporte.',
        'suspended.subject': 'Tu cuenta ha sido suspendida',

        // ── Billing: payment succeeded ──
        'paymentOk.title': 'Pago recibido exitosamente',
        'paymentOk.body': 'Hola <strong>{{name}}</strong>, hemos recibido tu pago de <strong>{{amount}}</strong> por el plan <strong>{{planName}}</strong>.',
        'paymentOk.detail': 'Tu acceso completo ha sido restaurado. ¡Gracias por confiar en Parallly!',
        'paymentOk.cta': 'Ir al dashboard',
        'paymentOk.subject': 'Pago recibido exitosamente',

        // ── Shared plural helpers ──
        'common.day': 'día',
        'common.days': 'días',
    },

    en: {
        'footer.tagline': 'Intelligent conversational automation',
        'footer.needHelp': 'Need help? <a href="{{supportUrl}}" style="color:{{brandColor}};text-decoration:none;">Contact support</a>',

        'security.header': '&#128274; Stay safe',
        'security.tip1': 'Never share your password or access code with anyone. The Parallly team will <strong>never</strong> ask for your login details.',
        'security.tip2': 'Enable <strong>two-factor authentication (2FA)</strong> on your profile for extra security.',

        'verification.greeting': 'Hi {{name}},',
        'verification.body': 'Use this code to complete your sign-in to <a href="{{siteUrl}}" style="color:{{brandColor}};text-decoration:none;font-weight:600;">Parallly</a>:',
        'verification.validity': 'Valid for 10 minutes. Do not share this code with anyone.',
        'verification.ifNotYou': 'If this was not you, <a href="{{loginUrl}}" style="color:{{brandColor}};">reset your password</a> immediately.',

        'passwordReset.body': 'We received a request to reset your password on <a href="{{siteUrl}}" style="color:{{brandColor}};text-decoration:none;font-weight:600;">Parallly</a>. Use this code:',
        'passwordReset.validity': 'Valid for 10 minutes. If you did not request this, ignore this email.',
        'passwordReset.tip': 'After resetting your password, we recommend enabling two-factor authentication (2FA) for extra protection.',

        'twoFactor.body': 'Your two-factor authentication code for <a href="{{siteUrl}}" style="color:{{brandColor}};text-decoration:none;font-weight:600;">Parallly</a> is:',
        'twoFactor.validity': 'Valid for 5 minutes. If you did not try to sign in, change your password immediately.',

        'welcome.title': 'Welcome to Parallly',
        'welcome.subtitle': 'Your account for <strong>{{companyName}}</strong> has been created successfully.',
        'welcome.feat1.title': 'Connect your channels',
        'welcome.feat1.desc': 'WhatsApp, Instagram, Messenger, Telegram and SMS in one place.',
        'welcome.feat2.title': 'Set up your AI agent',
        'welcome.feat2.desc': 'Customize replies, schedules and personality to automate sales.',
        'welcome.feat3.title': 'Sales pipeline',
        'welcome.feat3.desc': 'Manage contacts, opportunities and follow-ups from the built-in CRM.',
        'welcome.feat4.title': 'Book appointments',
        'welcome.feat4.desc': 'Automated booking with Google Calendar and chat confirmation.',
        'welcome.cta': 'Go to Dashboard',
        'welcome.tip': 'Start by connecting your first communication channel. The AI agent can begin replying in minutes.',
        'welcome.closing': 'If you need help, we are here for you.',

        'passwordChanged.title': 'Password updated',
        'passwordChanged.body': 'Hi {{name}}, your password on <a href="{{siteUrl}}" style="color:{{brandColor}};text-decoration:none;font-weight:600;">Parallly</a> has been changed successfully.',
        'passwordChanged.warning': '<strong>&#9888;&#65039; If you did not make this change</strong>, someone may have access to your account. <a href="{{resetUrl}}" style="color:{{brandColor}};font-weight:600;">Reset your password</a> and contact support immediately.',

        'trustedDevice.title': 'New trusted device',
        'trustedDevice.body': 'Hi {{name}}, a new trusted device was added to your <a href="{{siteUrl}}" style="color:{{brandColor}};text-decoration:none;font-weight:600;">Parallly</a> account.',
        'trustedDevice.labelDevice': 'Device',
        'trustedDevice.labelIp': 'IP address',
        'trustedDevice.labelDate': 'Date',
        'trustedDevice.note': 'This device will be able to sign in without two-factor verification for 30 days.',
        'trustedDevice.warning': '<strong>&#9888;&#65039; If this was not you</strong>, go to <a href="{{securityUrl}}" style="color:{{brandColor}};font-weight:600;">Security settings</a> and revoke all trusted devices. Then change your password.',

        'invitation.introNamed': '<strong>{{inviter}}</strong> invited you to join <strong>{{tenant}}</strong> on Parallly as <strong>{{role}}</strong>.',
        'invitation.introAnon': 'You have been invited to join <strong>{{tenant}}</strong> on Parallly as <strong>{{role}}</strong>.',
        'invitation.title': 'We are waiting for you',
        'invitation.cta': 'Accept invitation',
        'invitation.feat1.title': 'Unified inbox',
        'invitation.feat1.desc': 'Handle conversations from every channel in one place.',
        'invitation.feat2.title': 'AI assistant',
        'invitation.feat2.desc': 'A smart copilot that suggests replies and automates tasks.',
        'invitation.feat3.title': 'Built-in CRM',
        'invitation.feat3.desc': 'Contacts, pipeline and follow-up without leaving the platform.',
        'invitation.expires': 'This link expires on <strong>{{expires}}</strong>.',
        'invitation.ignore': 'If you were not expecting this invitation, you can ignore this email.',
        'invitation.subject': 'You have been invited to join {{tenant}} on Parallly',

        'teamWelcome.title': 'Welcome to the team',
        'teamWelcome.subtitle': 'Hi {{name}}, you are now part of <strong>{{tenant}}</strong> as <strong>{{role}}</strong>.',
        'teamWelcome.feat1.title': 'Inbox',
        'teamWelcome.feat1.desc': 'Access your assigned conversations from the inbox.',
        'teamWelcome.feat2.title': 'Quick replies',
        'teamWelcome.feat2.desc': 'Use macros and canned responses to speed up support.',
        'teamWelcome.feat3.title': 'AI copilot',
        'teamWelcome.feat3.desc': 'The assistant suggests replies based on each conversation context.',
        'teamWelcome.feat4.title': 'CRM and contacts',
        'teamWelcome.feat4.desc': 'Check each contact profile, history and notes in one place.',
        'teamWelcome.cta': 'Go to Dashboard',
        'teamWelcome.tip': 'Explore the inbox and get familiar with the tools. If you have questions, your administrator can help.',
        'teamWelcome.subject': 'Welcome to {{tenant}}',

        'fallback.heading': 'New message received',
        'fallback.body': 'You received a message from <strong>{{leadName}}</strong> that could not be delivered through the original channel.',
        'fallback.cta': 'View in Inbox',
        'fallback.note': 'This message was sent as a fallback because the communication channel was unavailable.',

        'assignment.title': 'New lead assigned',
        'assignment.body': '<strong>{{leadName}}</strong> has been assigned to you at stage <strong>{{stage}}</strong>.',
        'assignment.cta': 'View contact',
        'assignment.tip': 'Review the contact profile and conversation history for effective follow-up.',

        'trial.endingTitle': 'Your free trial ends soon',
        'trial.endingBody': 'Hi <strong>{{name}}</strong>, your <strong>{{planName}}</strong> plan trial ends in <strong>{{days}} {{daysWord}}</strong>.',
        'trial.endingDetail': 'Choose a plan before it ends to keep all your conversations, contacts and settings.',
        'trial.endingCta': 'Choose plan',
        'trial.endingTip': 'If you need more time, contact our support team.',
        'trial.endingSubject': 'Your free trial ends soon',

        'trialEnded.title': 'Your free trial has ended',
        'trialEnded.body': 'Hi <strong>{{name}}</strong>, your <strong>{{planName}}</strong> plan trial period has ended.',
        'trialEnded.graceIntro': 'You have <strong>7 days</strong> to choose a plan. During this period:',
        'trialEnded.grace1': '<strong>Days 1-3:</strong> Full access with a notice',
        'trialEnded.grace2': '<strong>Days 3-7:</strong> Read-only mode (you cannot send messages or create content)',
        'trialEnded.grace3': '<strong>After day 7:</strong> Account suspended',
        'trialEnded.dataSafe': 'Your data is safe. Once you pay, access is restored instantly.',
        'trialEnded.cta': 'Choose a plan now',
        'trialEnded.subject': 'Your free trial has ended',

        'paymentFailed.title': 'Your payment could not be processed',
        'paymentFailed.body': 'Hi <strong>{{name}}</strong>, we could not process the payment for your <strong>{{planName}}</strong> plan.',
        'paymentFailed.detail': 'You have <strong>7 days</strong> to update your payment method. After that, your account will be suspended.',
        'paymentFailed.cta': 'Update payment method',
        'paymentFailed.tip': 'Check that your card has sufficient funds and that the details are up to date.',
        'paymentFailed.subject': 'Your payment could not be processed',

        'softLock.title': 'Your account has been restricted',
        'softLock.body': 'Hi <strong>{{name}}</strong>, your account is now in <strong>read-only mode</strong>.',
        'softLock.detail': 'You cannot send messages, create content or change settings. You have <strong>{{days}} {{daysWord}}</strong> left before your account is fully suspended.',
        'softLock.restore': 'Make a payment now to restore full access instantly.',
        'softLock.cta': 'Pay and restore access',
        'softLock.subject': 'Your account has been restricted',

        'suspended.title': 'Your account has been suspended',
        'suspended.body': 'Hi <strong>{{name}}</strong>, your Parallly account has been suspended for non-payment.',
        'suspended.detail': 'Your data is safe and will be kept for 90 days. You can reactivate your account at any time by making a payment.',
        'suspended.cta': 'Reactivate account',
        'suspended.tip': 'If you think this is a mistake, contact our support team.',
        'suspended.subject': 'Your account has been suspended',

        'paymentOk.title': 'Payment received successfully',
        'paymentOk.body': 'Hi <strong>{{name}}</strong>, we have received your payment of <strong>{{amount}}</strong> for the <strong>{{planName}}</strong> plan.',
        'paymentOk.detail': 'Your full access has been restored. Thank you for trusting Parallly!',
        'paymentOk.cta': 'Go to dashboard',
        'paymentOk.subject': 'Payment received successfully',

        'common.day': 'day',
        'common.days': 'days',
    },

    pt: {
        'footer.tagline': 'Automação conversacional inteligente',
        'footer.needHelp': 'Precisa de ajuda? <a href="{{supportUrl}}" style="color:{{brandColor}};text-decoration:none;">Fale com o suporte</a>',

        'security.header': '&#128274; Mantenha-se seguro',
        'security.tip1': 'Nunca compartilhe sua senha ou código de acesso com ninguém. A equipe da Parallly <strong>nunca</strong> pedirá seus dados de acesso.',
        'security.tip2': 'Ative a <strong>autenticação de dois fatores (2FA)</strong> no seu perfil para mais segurança.',

        'verification.greeting': 'Olá {{name}},',
        'verification.body': 'Use este código para concluir seu login na <a href="{{siteUrl}}" style="color:{{brandColor}};text-decoration:none;font-weight:600;">Parallly</a>:',
        'verification.validity': 'Válido por 10 minutos. Não compartilhe este código com ninguém.',
        'verification.ifNotYou': 'Se não foi você, <a href="{{loginUrl}}" style="color:{{brandColor}};">redefina sua senha</a> imediatamente.',

        'passwordReset.body': 'Recebemos uma solicitação para redefinir sua senha na <a href="{{siteUrl}}" style="color:{{brandColor}};text-decoration:none;font-weight:600;">Parallly</a>. Use este código:',
        'passwordReset.validity': 'Válido por 10 minutos. Se você não solicitou isso, ignore este e-mail.',
        'passwordReset.tip': 'Após redefinir sua senha, recomendamos ativar a autenticação de dois fatores (2FA) para mais proteção.',

        'twoFactor.body': 'Seu código de autenticação de dois fatores para a <a href="{{siteUrl}}" style="color:{{brandColor}};text-decoration:none;font-weight:600;">Parallly</a> é:',
        'twoFactor.validity': 'Válido por 5 minutos. Se você não tentou fazer login, altere sua senha imediatamente.',

        'welcome.title': 'Bem-vindo à Parallly',
        'welcome.subtitle': 'Sua conta para <strong>{{companyName}}</strong> foi criada com sucesso.',
        'welcome.feat1.title': 'Conecte seus canais',
        'welcome.feat1.desc': 'WhatsApp, Instagram, Messenger, Telegram e SMS em um só lugar.',
        'welcome.feat2.title': 'Configure seu agente de IA',
        'welcome.feat2.desc': 'Personalize respostas, horários e personalidade para automatizar vendas.',
        'welcome.feat3.title': 'Funil de vendas',
        'welcome.feat3.desc': 'Gerencie contatos, oportunidades e acompanhamento pelo CRM integrado.',
        'welcome.feat4.title': 'Agende compromissos',
        'welcome.feat4.desc': 'Agendamento automatizado com Google Calendar e confirmação por chat.',
        'welcome.cta': 'Ir para o Dashboard',
        'welcome.tip': 'Comece conectando seu primeiro canal de comunicação. O agente de IA pode começar a responder em minutos.',
        'welcome.closing': 'Se precisar de ajuda, estamos aqui por você.',

        'passwordChanged.title': 'Senha atualizada',
        'passwordChanged.body': 'Olá {{name}}, sua senha na <a href="{{siteUrl}}" style="color:{{brandColor}};text-decoration:none;font-weight:600;">Parallly</a> foi alterada com sucesso.',
        'passwordChanged.warning': '<strong>&#9888;&#65039; Se você não fez essa alteração</strong>, alguém pode ter acesso à sua conta. <a href="{{resetUrl}}" style="color:{{brandColor}};font-weight:600;">Redefina sua senha</a> e fale com o suporte imediatamente.',

        'trustedDevice.title': 'Novo dispositivo confiável',
        'trustedDevice.body': 'Olá {{name}}, um novo dispositivo confiável foi adicionado à sua conta da <a href="{{siteUrl}}" style="color:{{brandColor}};text-decoration:none;font-weight:600;">Parallly</a>.',
        'trustedDevice.labelDevice': 'Dispositivo',
        'trustedDevice.labelIp': 'Endereço IP',
        'trustedDevice.labelDate': 'Data',
        'trustedDevice.note': 'Este dispositivo poderá fazer login sem verificação de dois fatores por 30 dias.',
        'trustedDevice.warning': '<strong>&#9888;&#65039; Se não foi você</strong>, acesse <a href="{{securityUrl}}" style="color:{{brandColor}};font-weight:600;">Configurações de segurança</a> e revogue todos os dispositivos confiáveis. Depois altere sua senha.',

        'invitation.introNamed': '<strong>{{inviter}}</strong> convidou você para entrar em <strong>{{tenant}}</strong> na Parallly como <strong>{{role}}</strong>.',
        'invitation.introAnon': 'Você foi convidado para entrar em <strong>{{tenant}}</strong> na Parallly como <strong>{{role}}</strong>.',
        'invitation.title': 'Estamos esperando por você',
        'invitation.cta': 'Aceitar convite',
        'invitation.feat1.title': 'Caixa unificada',
        'invitation.feat1.desc': 'Atenda conversas de todos os canais em um só lugar.',
        'invitation.feat2.title': 'Assistente de IA',
        'invitation.feat2.desc': 'Um copiloto inteligente que sugere respostas e automatiza tarefas.',
        'invitation.feat3.title': 'CRM integrado',
        'invitation.feat3.desc': 'Contatos, funil e acompanhamento sem sair da plataforma.',
        'invitation.expires': 'Este link expira em <strong>{{expires}}</strong>.',
        'invitation.ignore': 'Se você não esperava este convite, pode ignorar este e-mail.',
        'invitation.subject': 'Você foi convidado para entrar em {{tenant}} na Parallly',

        'teamWelcome.title': 'Bem-vindo à equipe',
        'teamWelcome.subtitle': 'Olá {{name}}, você agora faz parte de <strong>{{tenant}}</strong> como <strong>{{role}}</strong>.',
        'teamWelcome.feat1.title': 'Caixa de entrada',
        'teamWelcome.feat1.desc': 'Acesse as conversas atribuídas pela caixa de entrada.',
        'teamWelcome.feat2.title': 'Respostas rápidas',
        'teamWelcome.feat2.desc': 'Use macros e respostas predefinidas para agilizar o atendimento.',
        'teamWelcome.feat3.title': 'Copiloto de IA',
        'teamWelcome.feat3.desc': 'O assistente sugere respostas com base no contexto de cada conversa.',
        'teamWelcome.feat4.title': 'CRM e contatos',
        'teamWelcome.feat4.desc': 'Consulte o perfil de cada contato, histórico e notas em um só lugar.',
        'teamWelcome.cta': 'Ir para o Dashboard',
        'teamWelcome.tip': 'Explore a caixa de entrada e familiarize-se com as ferramentas. Em caso de dúvidas, seu administrador pode ajudar.',
        'teamWelcome.subject': 'Bem-vindo a {{tenant}}',

        'fallback.heading': 'Nova mensagem recebida',
        'fallback.body': 'Você recebeu uma mensagem de <strong>{{leadName}}</strong> que não pôde ser entregue pelo canal original.',
        'fallback.cta': 'Ver na caixa de entrada',
        'fallback.note': 'Esta mensagem foi enviada como fallback porque o canal de comunicação estava indisponível.',

        'assignment.title': 'Novo lead atribuído',
        'assignment.body': '<strong>{{leadName}}</strong> foi atribuído a você na etapa <strong>{{stage}}</strong>.',
        'assignment.cta': 'Ver contato',
        'assignment.tip': 'Revise o perfil do contato e o histórico de conversas para um acompanhamento eficaz.',

        'trial.endingTitle': 'Seu teste grátis termina em breve',
        'trial.endingBody': 'Olá <strong>{{name}}</strong>, seu teste do plano <strong>{{planName}}</strong> termina em <strong>{{days}} {{daysWord}}</strong>.',
        'trial.endingDetail': 'Escolha um plano antes de terminar para manter todas as suas conversas, contatos e configurações.',
        'trial.endingCta': 'Escolher plano',
        'trial.endingTip': 'Se precisar de mais tempo, fale com nossa equipe de suporte.',
        'trial.endingSubject': 'Seu teste grátis termina em breve',

        'trialEnded.title': 'Seu teste grátis terminou',
        'trialEnded.body': 'Olá <strong>{{name}}</strong>, o período de teste do seu plano <strong>{{planName}}</strong> terminou.',
        'trialEnded.graceIntro': 'Você tem <strong>7 dias</strong> para escolher um plano. Durante este período:',
        'trialEnded.grace1': '<strong>Dias 1-3:</strong> Acesso completo com aviso',
        'trialEnded.grace2': '<strong>Dias 3-7:</strong> Modo somente leitura (você não poderá enviar mensagens nem criar conteúdo)',
        'trialEnded.grace3': '<strong>Após o dia 7:</strong> Conta suspensa',
        'trialEnded.dataSafe': 'Seus dados estão seguros. Ao pagar, o acesso é restaurado na hora.',
        'trialEnded.cta': 'Escolher plano agora',
        'trialEnded.subject': 'Seu teste grátis terminou',

        'paymentFailed.title': 'Seu pagamento não pôde ser processado',
        'paymentFailed.body': 'Olá <strong>{{name}}</strong>, não conseguimos processar o pagamento do seu plano <strong>{{planName}}</strong>.',
        'paymentFailed.detail': 'Você tem <strong>7 dias</strong> para atualizar seu método de pagamento. Após esse prazo, sua conta será suspensa.',
        'paymentFailed.cta': 'Atualizar método de pagamento',
        'paymentFailed.tip': 'Verifique se seu cartão tem saldo suficiente e se os dados estão atualizados.',
        'paymentFailed.subject': 'Seu pagamento não pôde ser processado',

        'softLock.title': 'Sua conta foi restringida',
        'softLock.body': 'Olá <strong>{{name}}</strong>, sua conta agora está em <strong>modo somente leitura</strong>.',
        'softLock.detail': 'Você não poderá enviar mensagens, criar conteúdo nem alterar configurações. Faltam <strong>{{days}} {{daysWord}}</strong> antes que sua conta seja totalmente suspensa.',
        'softLock.restore': 'Faça um pagamento agora para restaurar o acesso completo na hora.',
        'softLock.cta': 'Pagar e restaurar acesso',
        'softLock.subject': 'Sua conta foi restringida',

        'suspended.title': 'Sua conta foi suspensa',
        'suspended.body': 'Olá <strong>{{name}}</strong>, sua conta da Parallly foi suspensa por falta de pagamento.',
        'suspended.detail': 'Seus dados estão seguros e serão mantidos por 90 dias. Você pode reativar sua conta a qualquer momento fazendo um pagamento.',
        'suspended.cta': 'Reativar conta',
        'suspended.tip': 'Se acha que isso é um erro, fale com nossa equipe de suporte.',
        'suspended.subject': 'Sua conta foi suspensa',

        'paymentOk.title': 'Pagamento recebido com sucesso',
        'paymentOk.body': 'Olá <strong>{{name}}</strong>, recebemos seu pagamento de <strong>{{amount}}</strong> pelo plano <strong>{{planName}}</strong>.',
        'paymentOk.detail': 'Seu acesso completo foi restaurado. Obrigado por confiar na Parallly!',
        'paymentOk.cta': 'Ir para o dashboard',
        'paymentOk.subject': 'Pagamento recebido com sucesso',

        'common.day': 'dia',
        'common.days': 'dias',
    },

    fr: {
        'footer.tagline': 'Automatisation conversationnelle intelligente',
        'footer.needHelp': 'Besoin d\'aide ? <a href="{{supportUrl}}" style="color:{{brandColor}};text-decoration:none;">Contactez le support</a>',

        'security.header': '&#128274; Restez en sécurité',
        'security.tip1': 'Ne partagez jamais votre mot de passe ou code d\'accès avec qui que ce soit. L\'équipe Parallly ne vous demandera <strong>jamais</strong> vos identifiants.',
        'security.tip2': 'Activez l\'<strong>authentification à deux facteurs (2FA)</strong> sur votre profil pour plus de sécurité.',

        'verification.greeting': 'Bonjour {{name}},',
        'verification.body': 'Utilisez ce code pour terminer votre connexion à <a href="{{siteUrl}}" style="color:{{brandColor}};text-decoration:none;font-weight:600;">Parallly</a> :',
        'verification.validity': 'Valable 10 minutes. Ne partagez ce code avec personne.',
        'verification.ifNotYou': 'Si ce n\'était pas vous, <a href="{{loginUrl}}" style="color:{{brandColor}};">réinitialisez votre mot de passe</a> immédiatement.',

        'passwordReset.body': 'Nous avons reçu une demande de réinitialisation de votre mot de passe sur <a href="{{siteUrl}}" style="color:{{brandColor}};text-decoration:none;font-weight:600;">Parallly</a>. Utilisez ce code :',
        'passwordReset.validity': 'Valable 10 minutes. Si vous n\'êtes pas à l\'origine de cette demande, ignorez cet e-mail.',
        'passwordReset.tip': 'Après avoir réinitialisé votre mot de passe, nous vous recommandons d\'activer l\'authentification à deux facteurs (2FA) pour plus de protection.',

        'twoFactor.body': 'Votre code d\'authentification à deux facteurs pour <a href="{{siteUrl}}" style="color:{{brandColor}};text-decoration:none;font-weight:600;">Parallly</a> est :',
        'twoFactor.validity': 'Valable 5 minutes. Si vous n\'avez pas tenté de vous connecter, changez votre mot de passe immédiatement.',

        'welcome.title': 'Bienvenue sur Parallly',
        'welcome.subtitle': 'Votre compte pour <strong>{{companyName}}</strong> a été créé avec succès.',
        'welcome.feat1.title': 'Connectez vos canaux',
        'welcome.feat1.desc': 'WhatsApp, Instagram, Messenger, Telegram et SMS au même endroit.',
        'welcome.feat2.title': 'Configurez votre agent IA',
        'welcome.feat2.desc': 'Personnalisez les réponses, les horaires et la personnalité pour automatiser les ventes.',
        'welcome.feat3.title': 'Pipeline de ventes',
        'welcome.feat3.desc': 'Gérez contacts, opportunités et suivi depuis le CRM intégré.',
        'welcome.feat4.title': 'Prenez des rendez-vous',
        'welcome.feat4.desc': 'Réservation automatisée avec Google Calendar et confirmation par chat.',
        'welcome.cta': 'Aller au tableau de bord',
        'welcome.tip': 'Commencez par connecter votre premier canal de communication. L\'agent IA peut commencer à répondre en quelques minutes.',
        'welcome.closing': 'Si vous avez besoin d\'aide, nous sommes là pour vous.',

        'passwordChanged.title': 'Mot de passe mis à jour',
        'passwordChanged.body': 'Bonjour {{name}}, votre mot de passe sur <a href="{{siteUrl}}" style="color:{{brandColor}};text-decoration:none;font-weight:600;">Parallly</a> a été modifié avec succès.',
        'passwordChanged.warning': '<strong>&#9888;&#65039; Si vous n\'êtes pas à l\'origine de ce changement</strong>, quelqu\'un pourrait avoir accès à votre compte. <a href="{{resetUrl}}" style="color:{{brandColor}};font-weight:600;">Réinitialisez votre mot de passe</a> et contactez le support immédiatement.',

        'trustedDevice.title': 'Nouvel appareil de confiance',
        'trustedDevice.body': 'Bonjour {{name}}, un nouvel appareil de confiance a été ajouté à votre compte <a href="{{siteUrl}}" style="color:{{brandColor}};text-decoration:none;font-weight:600;">Parallly</a>.',
        'trustedDevice.labelDevice': 'Appareil',
        'trustedDevice.labelIp': 'Adresse IP',
        'trustedDevice.labelDate': 'Date',
        'trustedDevice.note': 'Cet appareil pourra se connecter sans vérification à deux facteurs pendant 30 jours.',
        'trustedDevice.warning': '<strong>&#9888;&#65039; Si ce n\'était pas vous</strong>, allez dans <a href="{{securityUrl}}" style="color:{{brandColor}};font-weight:600;">Paramètres de sécurité</a> et révoquez tous les appareils de confiance. Puis changez votre mot de passe.',

        'invitation.introNamed': '<strong>{{inviter}}</strong> vous a invité à rejoindre <strong>{{tenant}}</strong> sur Parallly en tant que <strong>{{role}}</strong>.',
        'invitation.introAnon': 'Vous avez été invité à rejoindre <strong>{{tenant}}</strong> sur Parallly en tant que <strong>{{role}}</strong>.',
        'invitation.title': 'Nous vous attendons',
        'invitation.cta': 'Accepter l\'invitation',
        'invitation.feat1.title': 'Boîte unifiée',
        'invitation.feat1.desc': 'Gérez les conversations de tous les canaux au même endroit.',
        'invitation.feat2.title': 'Assistant IA',
        'invitation.feat2.desc': 'Un copilote intelligent qui suggère des réponses et automatise les tâches.',
        'invitation.feat3.title': 'CRM intégré',
        'invitation.feat3.desc': 'Contacts, pipeline et suivi sans quitter la plateforme.',
        'invitation.expires': 'Ce lien expire le <strong>{{expires}}</strong>.',
        'invitation.ignore': 'Si vous n\'attendiez pas cette invitation, vous pouvez ignorer cet e-mail.',
        'invitation.subject': 'Vous avez été invité à rejoindre {{tenant}} sur Parallly',

        'teamWelcome.title': 'Bienvenue dans l\'équipe',
        'teamWelcome.subtitle': 'Bonjour {{name}}, vous faites désormais partie de <strong>{{tenant}}</strong> en tant que <strong>{{role}}</strong>.',
        'teamWelcome.feat1.title': 'Boîte de réception',
        'teamWelcome.feat1.desc': 'Accédez aux conversations qui vous sont attribuées depuis la boîte de réception.',
        'teamWelcome.feat2.title': 'Réponses rapides',
        'teamWelcome.feat2.desc': 'Utilisez des macros et des réponses prédéfinies pour accélérer le support.',
        'teamWelcome.feat3.title': 'Copilote IA',
        'teamWelcome.feat3.desc': 'L\'assistant suggère des réponses selon le contexte de chaque conversation.',
        'teamWelcome.feat4.title': 'CRM et contacts',
        'teamWelcome.feat4.desc': 'Consultez le profil de chaque contact, l\'historique et les notes au même endroit.',
        'teamWelcome.cta': 'Aller au tableau de bord',
        'teamWelcome.tip': 'Explorez la boîte de réception et familiarisez-vous avec les outils. En cas de doute, votre administrateur peut vous aider.',
        'teamWelcome.subject': 'Bienvenue chez {{tenant}}',

        'fallback.heading': 'Nouveau message reçu',
        'fallback.body': 'Vous avez reçu un message de <strong>{{leadName}}</strong> qui n\'a pas pu être livré par le canal d\'origine.',
        'fallback.cta': 'Voir dans la boîte de réception',
        'fallback.note': 'Ce message a été envoyé en repli car le canal de communication était indisponible.',

        'assignment.title': 'Nouveau lead attribué',
        'assignment.body': '<strong>{{leadName}}</strong> vous a été attribué à l\'étape <strong>{{stage}}</strong>.',
        'assignment.cta': 'Voir le contact',
        'assignment.tip': 'Consultez le profil du contact et l\'historique des conversations pour un suivi efficace.',

        'trial.endingTitle': 'Votre essai gratuit se termine bientôt',
        'trial.endingBody': 'Bonjour <strong>{{name}}</strong>, votre essai du plan <strong>{{planName}}</strong> se termine dans <strong>{{days}} {{daysWord}}</strong>.',
        'trial.endingDetail': 'Choisissez un plan avant la fin pour conserver toutes vos conversations, contacts et paramètres.',
        'trial.endingCta': 'Choisir un plan',
        'trial.endingTip': 'Si vous avez besoin de plus de temps, contactez notre équipe de support.',
        'trial.endingSubject': 'Votre essai gratuit se termine bientôt',

        'trialEnded.title': 'Votre essai gratuit est terminé',
        'trialEnded.body': 'Bonjour <strong>{{name}}</strong>, la période d\'essai de votre plan <strong>{{planName}}</strong> est terminée.',
        'trialEnded.graceIntro': 'Vous avez <strong>7 jours</strong> pour choisir un plan. Pendant cette période :',
        'trialEnded.grace1': '<strong>Jours 1-3 :</strong> Accès complet avec avis',
        'trialEnded.grace2': '<strong>Jours 3-7 :</strong> Mode lecture seule (vous ne pourrez pas envoyer de messages ni créer de contenu)',
        'trialEnded.grace3': '<strong>Après le jour 7 :</strong> Compte suspendu',
        'trialEnded.dataSafe': 'Vos données sont en sécurité. Dès le paiement, l\'accès est rétabli instantanément.',
        'trialEnded.cta': 'Choisir un plan maintenant',
        'trialEnded.subject': 'Votre essai gratuit est terminé',

        'paymentFailed.title': 'Votre paiement n\'a pas pu être traité',
        'paymentFailed.body': 'Bonjour <strong>{{name}}</strong>, nous n\'avons pas pu traiter le paiement de votre plan <strong>{{planName}}</strong>.',
        'paymentFailed.detail': 'Vous avez <strong>7 jours</strong> pour mettre à jour votre moyen de paiement. Passé ce délai, votre compte sera suspendu.',
        'paymentFailed.cta': 'Mettre à jour le moyen de paiement',
        'paymentFailed.tip': 'Vérifiez que votre carte dispose de fonds suffisants et que les informations sont à jour.',
        'paymentFailed.subject': 'Votre paiement n\'a pas pu être traité',

        'softLock.title': 'Votre compte a été restreint',
        'softLock.body': 'Bonjour <strong>{{name}}</strong>, votre compte est désormais en <strong>mode lecture seule</strong>.',
        'softLock.detail': 'Vous ne pourrez pas envoyer de messages, créer du contenu ni modifier les paramètres. Il vous reste <strong>{{days}} {{daysWord}}</strong> avant la suspension complète de votre compte.',
        'softLock.restore': 'Effectuez un paiement maintenant pour rétablir l\'accès complet instantanément.',
        'softLock.cta': 'Payer et rétablir l\'accès',
        'softLock.subject': 'Votre compte a été restreint',

        'suspended.title': 'Votre compte a été suspendu',
        'suspended.body': 'Bonjour <strong>{{name}}</strong>, votre compte Parallly a été suspendu pour défaut de paiement.',
        'suspended.detail': 'Vos données sont en sécurité et seront conservées pendant 90 jours. Vous pouvez réactiver votre compte à tout moment en effectuant un paiement.',
        'suspended.cta': 'Réactiver le compte',
        'suspended.tip': 'Si vous pensez qu\'il s\'agit d\'une erreur, contactez notre équipe de support.',
        'suspended.subject': 'Votre compte a été suspendu',

        'paymentOk.title': 'Paiement reçu avec succès',
        'paymentOk.body': 'Bonjour <strong>{{name}}</strong>, nous avons reçu votre paiement de <strong>{{amount}}</strong> pour le plan <strong>{{planName}}</strong>.',
        'paymentOk.detail': 'Votre accès complet a été rétabli. Merci de votre confiance envers Parallly !',
        'paymentOk.cta': 'Aller au tableau de bord',
        'paymentOk.subject': 'Paiement reçu avec succès',

        'common.day': 'jour',
        'common.days': 'jours',
    },
};

/** Supported email languages (after normalization). */
export type EmailLang = keyof typeof EMAIL_MSG;

/**
 * Resolve a translated email string.
 *
 * @param lang  Raw language tag (e.g. "es-CO", "en", "pt-BR"). First 2 chars are used.
 * @param key   Namespaced key (e.g. "verification.greeting").
 * @param vars  Optional `{{var}}` substitutions.
 * @returns     Translated string with vars replaced. Falls back to "es", then to the key itself.
 */
export function emsg(lang: string, key: string, vars: Record<string, string> = {}): string {
    const code = (lang || 'es').substring(0, 2).toLowerCase();
    const dict = EMAIL_MSG[code as EmailLang] || EMAIL_MSG.es;
    let text = dict[key] ?? EMAIL_MSG.es[key] ?? key;

    for (const [k, v] of Object.entries(vars)) {
        text = text.replace(new RegExp(`\\{\\{${k}\\}\\}`, 'g'), v);
    }
    return text;
}
