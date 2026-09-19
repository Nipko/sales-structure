# VIDEO 33:36–48:36 (sheets s29–s41); screen share visible only 33:36–40:48; 41:00–48:36 is a black call screen with avatars

## Timeline
### 33:36 — /admin/agent/84c83825-…  (surfaces: 7)
- Trial banner: Tu prueba gratuita termina en 30 días · Administrar plan
- Red banner: Hay una acción crítica que requiere atención. Revisa primero a Asistente. [Revisar][Preguntar a Assist][Posponer 24 h]
- Info strip: Guardar prepara una revisión… La versión operativa conserva su configuración y sus conexiones.
- Panel Misión y preparación del agente — chip Pendiente — El agente todavía no está listo para atender… Esta evaluación describe la versión operativa. Prueba el borrador…
- Buttons Definir misión y resultados / Siguiente paso: Acordar la misión del agente / Guiarme con Parallly Assist / Revisar dependencias y pruebas
- Header Asistente / Asistente comercial with tabs Evaluar y revisar candidato · Publicar y ver historial · Aprender de conversaciones · Fallos y pruebas revisadas · Probar agente · Guardar borrador
- Collapsible ¿Cómo configuro mi agente?
- Amber card Configuración incompleta — Hay 4 bloqueos críticos por resolver [Ver calidad →] FALTA CONFIGURAR: Base de conocimiento lista · Privacidad para imágenes y audios
- PWA toast Instalar Parallly [Instalar]
- Mascot bubble bottom-right
- Sticky footer Probar agente / Guardar borrador
- ACTION: Leaving the agent page toward Canales
- FRICTION: Agent still named Asistente (not the name given earlier); 4 bloqueos críticos on a brand-new account; 7 simultaneous guidance/alert surfaces
### 33:48–34:24 — /admin/channels  (surfaces: 6)
- Both banners persist
- Help panel ¿Cómo conectar y gestionar tus canales? [Mostrarme cómo] with 5 numbered steps (WA Business + Facebook page; IG professional + FB page OAuth; Messenger FB login; Telegram Bot Token @BotFather; 'sin agente asignado nadie responde')
- Cards WhatsApp / Instagram DM / Facebook Messenger / Telegram all Desconectado + Configurar →
- PWA toast (overlaps Telegram card)
- Guided-tour popover at 34:24: Canales — Acá conectas WhatsApp… 1/2 [Siguiente →]
- Mascot
- ACTION: Scrolls up/down the channels page for ~36 s; a 2-step tour popover appears (Mostrarme cómo clicked or auto-started)
- FRICTION: Scrolling to find the WhatsApp entry; PWA toast covers a Configurar button; tour adds another layer
### 34:36 — /admin/channels/whatsapp  (surfaces: 5)
- Header WhatsApp Business — Conecta y gestiona tu cuenta… con Meta Cloud API · badge Desconectado
- Collapsible ¿Cómo conecto WhatsApp Business con Parallly?
- Info: WhatsApp es propiedad de Meta… Facebook Login…
- Elige tu método de conexión
- Checklist card Antes de conectar WhatsApp — Tené esto a mano… (3 checkboxes) button Confirmá los puntos para continuar (disabled)
- Toast: Recorrido terminado. Te mostramos dónde está cada cosa; esta guía no puede verificar si quedó configurado.
- Mascot, both banners
- ACTION: Lands on WhatsApp page; tour ends
- FRICTION: Pre-checklist gate that verifies nothing; voseo (Tené/podés/Confirmá) while the rest of the app uses tú
### 34:48–35:24 — /admin/channels/whatsapp  (surfaces: 4)
- Checklist: 2nd box (código SMS) checked first, then all 3 → button becomes Continuar
- PWA toast until 35:00 then dismissed
- Banners + mascot
- ACTION: Ticks the 3 self-declared checkboxes over ~48 s and continues
- FRICTION: 48 s spent on a ceremonial checklist
### 35:36–35:48 — /admin/channels/whatsapp  (surfaces: 3)
- 3 method cards: [Recomendado] WhatsApp Business App (Coexistencia ~20 min, selected) · Número nuevo (Más rápido ~5 min) · Migrar desde otro proveedor (BSP) (Sin downtime ~15 min)
- QUÉ IMPLICA ESTA OPCIÓN (Coexistencia)
- ¿Qué se sincroniza con la plataforma? SE SINCRONIZA (4) / NO SE SINCRONIZA (4)
- Limitaciones del modo Coexistencia (4 bullets)
- ACTION: Reads; text highlighted blue (select-drag, probably reading aloud)
- FRICTION: Jargon wall: API de Cloud, BSP, Sin downtime, Coexistencia, ~20 mensajes/segundo
### 36:00–37:00 — /admin/channels/whatsapp  (surfaces: 3)
- Pasos del proceso (4)
- Requisitos previos (4: app ≥2.24.17, Meta Business Suite, 7 días de actividad, WiFi estable — puede tardar varias horas)
- Amber warning: Tienes 24 horas después de conectar… deberás repetir el proceso completo
- Top edge of blue CTA cut off below the fold
- ACTION: Zero scroll for ~48 s — stalled/discussing (matches Germán 36:40 'es una cuenta API')
- FRICTION: ~25 bullet items before the CTA; CTA never reached in this minute
### 37:12–39:00 — /admin/channels/whatsapp  (surfaces: 3)
- Scrolled back up to the 3 method cards; Antes de conectar checklist gone from view
- Cursor hovers Número nuevo (37:12), then Migrar desde otro proveedor (38:00), then idle
- Banners + mascot
- ACTION: ~2 min hovering between the 3 method cards without clicking — decision paralysis
- FRICTION: No card says in plain words 'if your number already runs on the API with another provider choose Migrar'; only '(BSP)'. Total stall on this page 35:36→39:00 ≈ 3.5 min
### 39:12 — /admin/channels/whatsapp  (surfaces: 3)
- Método Número nuevo selected (green)
- QUÉ IMPLICA: El camino más sencillo. Registra un número… que no haya sido usado previamente en WhatsApp…
- Pasos (4) · Requisitos previos (4: Meta Business Suite; no VoIP ni premium; nombre comercial, dirección y presencia en línea; aceptar Términos de Servicio de la Plataforma WhatsApp Business)
- CTA Conectar con Facebook (cursor on it)
- Caption: Se abrirá una ventana… Tus credenciales se encriptan con AES-256 y nunca se almacenan en texto plano.
- ACTION: Switches to Número nuevo and clicks Conectar con Facebook
- FRICTION: Likely wrong method for her situation (number already on the API elsewhere → Migrar)
### 39:24 — /admin/channels/whatsapp  (surfaces: 3)
- CTA reads Esperando autorización… · stepper 1 Autorización (active) → 2 Conectando número → 3 Activando WhatsApp
- No Meta/Facebook popup visible anywhere in the shared screen
- ACTION: First authorization attempt in progress
- FRICTION: Popup not captured (other window or blocked) — user sees a spinner and nothing else
### 39:36–40:12 — /admin/channels/whatsapp  (surfaces: 4)
- CTA back to Conectar con Facebook
- Amber error card: ⚠ No recibimos la autorización — La ventana se cerró antes de terminar. Vuelve a intentar y no la cierres hasta ver "Conexión exitosa". [Reintentar]
- 40:12 cursor on the Equipo user menu top-right
- ACTION: First attempt failed in <12 s; 36 s idle, then hovers the profile menu
- FRICTION: Error blames the user for closing a window that was never visibly opened
### 40:24–40:36 — /admin/channels/whatsapp  (surfaces: 3)
- CTA Esperando autorización… with stepper again
- ACTION: Reintentar clicked ~40:20; second attempt
- FRICTION: Same blind wait
### 40:48 — /admin/channels/whatsapp  (surfaces: 4)
- CTA Conectar con Facebook + same amber No recibimos la autorización [Reintentar]
- Banners + mascot
- ACTION: Second attempt failed; last dashboard frame of the video
- FRICTION: Final state: WhatsApp Desconectado, agent Asistente with 4 bloqueos críticos, trial + critical banners never dismissed
### 41:00–48:24 — (no screen share) black call screen  (surfaces: 0)
- PARA//EXT logo avatar; selfie avatar of support person at 41:12
- ACTION: Screen share ended ~41:00; call continued voice-only ~7.5 min
- FRICTION: None observable

## Transcript checks
- [partly] M12 32:51–40:48 screen /admin/channels → /admin/channels/whatsapp (Modal de conexión con Meta) — Routes confirmed (33:48 /admin/channels, 34:36 onward /admin/channels/whatsapp). But it is a full page, not a modal, and no Meta modal/popup ever appears in the captured screen. Range also starts at /admin/agent at 33:36.
- [partly] Nataly 33:45: 'Elige tu método de conexión: WhatsApp Business App, Número nuevo, Migrar desde otro proveedor… pide las tres: verificación por SMS, acceso a Facebook y el QR' — Audio unverifiable. The 3 method names appear on screen only at 35:36, not 33:45 (at 33:45 she is still on /admin/channels; the Antes de conectar checklist with SMS/Facebook/number items appears 34:36). The 'QR' item belongs to Pasos del proceso of Coexistencia, visible 36:00.
- [unverifiable] Germán 36:40: 'No está abierto en ningún lado porque es una cuenta API' — No audio. Frames show a 48 s stall with zero scroll 36:12–37:00 on the Coexistencia requirements, consistent with a discussion pause.
- [contradicted] (Intentan conectar con Facebook, sale la ventana emergente de Meta) — No Meta/Facebook popup is visible in any frame (39:12–40:48). Only the CTA state Esperando autorización… and, twice, the error La ventana se cerró antes de terminar. Popup may have opened off-capture, but the screen shows none.
- [confirmed] Nataly 39:18: 'Esperando autorización…' — 39:24 frame shows CTA text Esperando autorización… with stepper 1 Autorización active.
- [partly] Felipe 40:26: 'parece que hay un error ahí… no lo va a poder conectar' — Error exists but appears earlier: amber No recibimos la autorización visible from 39:36 to 40:12; at 40:24–40:36 a second attempt is in progress and it fails again by 40:48. Speaker attribution unverifiable.
- [unverifiable] Germán 40:48: 'por agendita nos toca movernos… fue apenas el avance hasta ahí' — No audio; 40:48 is the last dashboard frame with the second failure on screen, consistent with wrapping up.
- [partly] Nataly 41:18: 'Muchas gracias… bye' (Fin de la sesión) — Screen share ends ~41:00 (black call screen with avatars from 41:00). The video continues to 48:36 with avatars only, so the call ran ~7 more minutes; 'fin de la sesión' is true only for the screen portion.
- [confirmed] 48 minutos perdidos: la sesión terminó sin que el agente respondiera un solo mensaje y sin WhatsApp conectado — Final dashboard frame 40:48: WhatsApp Desconectado + No recibimos la autorización; agent page (33:36) still Pendiente / 4 bloqueos críticos. No conversation screen ever appears in this range.
- [partly] Matriz 39:18: Conexión de Meta obligatoria para probar el bot — Frames show Probar agente buttons on the agent page (33:36) and a sticky footer with the same, so a test surface exists without Meta; whether it was blocked by the 4 bloqueos críticos is not shown in this range.

## Findings
### F1 [critical] Two consecutive 'La ventana se cerró' failures with no window ever visible (39:24–40:48 /admin/channels/whatsapp) [NOT IN TRANSCRIPT]
- seen: Conectar con Facebook → Esperando autorización… → within <12 s amber card No recibimos la autorización — La ventana se cerró antes de terminar. Vuelve a intentar y no la cierres hasta ver "Conexión exitosa" [Reintentar]. Repeated identically on Reintentar (40:24→40:48). No Meta popup appears in any frame.
- copy: «No recibimos la autorización — La ventana se cerró antes de terminar. Vuelve a intentar y no la cierres hasta ver "Conexión exitosa".»
- impact: The error blames her for closing a window she never saw. Nothing suggests popup blockers, another window, or a different method. Session ended here.
### F2 [critical] Method chooser cannot be answered by someone whose number already runs on the API elsewhere (35:36–39:12) [NOT IN TRANSCRIPT]
- seen: ~3.5 min stalled on 3 cards; cursor hovers Número nuevo and Migrar desde otro proveedor for 2 min; finally picks Número nuevo although her WhatsApp 'no está abierto en ningún lado porque es una cuenta API'. Migrar card only says 'Ya uso la API de WhatsApp con otro proveedor (BSP)'.
- copy: «Migrar desde otro proveedor — Ya uso la API de WhatsApp con otro proveedor (BSP) · Sin downtime · ~15 min»
- impact: She chose the option requiring a virgin number she almost certainly does not have; the flow was doomed before the Facebook click. No 'which one is me?' helper, no question-based selector.
### F3 [high] Wall of ~25 bullets plus a 24-hour threat before the connect button (35:48–37:00) [NOT IN TRANSCRIPT]
- seen: SE SINCRONIZA (4) / NO SE SINCRONIZA (4) / Limitaciones (4) / Pasos (4) / Requisitos previos (4) / amber 'Tienes 24 horas… deberás repetir el proceso completo de conexión'; CTA cut off below the fold and never reached in this minute.
- copy: «Tienes 24 horas después de conectar para autorizar la sincronización del historial. Si no lo haces dentro de ese plazo, deberás repetir el proceso completo de conexión.»
- impact: Reads like a legal notice; the deadline threat and '~20 mensajes/segundo', 'versión 2.24.17', 'la sincronización puede tardar varias horas' invite abandonment.
### F4 [medium] Ceremonial pre-checklist that verifies nothing and costs ~48 s (34:36–35:24) [NOT IN TRANSCRIPT]
- seen: Antes de conectar WhatsApp — 3 self-declared checkboxes; disabled button 'Confirmá los puntos para continuar' becomes 'Continuar' once all ticked. She ticks them out of order.
- copy: «Tené esto a mano para conectar en minutos: … Confirmá los puntos para continuar»
- impact: Extra gate with no value; voseo (Tené/podés/Confirmá) while the rest of the app uses tú, which reads as a different product.
### F5 [high] Seven simultaneous guidance/alert surfaces on the agent page of a brand-new account (33:36 /admin/agent/…) [NOT IN TRANSCRIPT]
- seen: Trial banner + red critical banner (Revisar / Preguntar a Assist / Posponer 24 h) + info strip about borrador/versión operativa + Misión panel Pendiente + amber 'Configuración incompleta — 4 bloqueos críticos' + PWA install toast + mascot bubble + sticky footer. Agent still named 'Asistente'.
- copy: «Hay una acción crítica que requiere atención. Revisa primero a Asistente. / Configuración incompleta — Hay 4 bloqueos críticos por resolver.»
- impact: A new user is told she has a critical action and 4 critical blocks before she has done anything; the name she gave the agent earlier is not reflected.
### F6 [medium] Guided tour admits it cannot verify anything, and appears on top of other guidance (34:24–34:36) [NOT IN TRANSCRIPT]
- seen: Tour popover 'Canales — Acá conectas WhatsApp… 1/2' over the channels page that already has a 5-step help panel; ends with toast 'Recorrido terminado. Te mostramos dónde está cada cosa; esta guía no puede verificar si quedó configurado.'
- copy: «Recorrido terminado. Te mostramos dónde está cada cosa; esta guía no puede verificar si quedó configurado.»
- impact: Two overlapping help systems; the closing toast undermines confidence ('no puede verificar').
### F7 [low] Security jargon under the primary CTA (39:12) [NOT IN TRANSCRIPT]
- seen: Caption under Conectar con Facebook: 'Tus credenciales se encriptan con AES-256 y nunca se almacenan en texto plano.'
- copy: «Tus credenciales se encriptan con AES-256 y nunca se almacenan en texto plano.»
- impact: Meaningless to a dance-academy owner; raises the question of what 'texto plano' risk exists.
### F8 [low] PWA install toast overlaps a Configurar button on the channels page (33:48–35:00) [NOT IN TRANSCRIPT]
- seen: 'Instalar Parallly — Acceso rápido desde tu escritorio o celular [Instalar]' sits over the Telegram card's Configurar until dismissed at ~35:00.
- copy: «Instalar Parallly — Acceso rápido desde tu escritorio o celular»
- impact: One more thing to dismiss in the critical path; hides an affordance.
### F9 [medium] Transcript narrates a Meta popup that the recording does not show, and misdates the error (39:12–40:48) [NOT IN TRANSCRIPT]
- seen: Error card already visible at 39:36 (transcript says 40:26); no popup captured; second Reintentar attempt at 40:24 not mentioned; screen share ends ~41:00 while video runs to 48:36.
- impact: Not a UX finding; a correction to the claim doc so the root cause (popup never seen / wrong method) is not misdiagnosed as a plain Meta error.

## Copy inventory
- 33:36: «Guardar prepara una revisión para probar y revisar antes de publicarla. La versión operativa conserva su configuración y sus conexiones.» — 'revisión', 'versión operativa', 'publicar' — release-management vocabulary on a first visit
- 33:36: «Esta evaluación describe la versión operativa. Prueba el borrador para evaluar sus cambios.» — borrador vs versión operativa distinction is invisible to a novice
- 33:36: «Evaluar y revisar candidato · Publicar y ver historial · Fallos y pruebas revisadas» — 'candidato', 'fallos' as tab names on a fresh agent
- 33:36: «Hay una acción crítica que requiere atención. Revisa primero a Asistente.» — Red banner on a new account; 'Asistente' is the default name, not hers
- 33:36: «Configuración incompleta — Hay 4 bloqueos críticos por resolver.» — Threatening count before any work
- 33:48: «Después de conectar, asígnale un agente desde Agentes IA: sin agente asignado nadie responde.» — Second manual step she is warned about but never reaches
- 34:36: «Conecta y gestiona tu cuenta de WhatsApp Business con Meta Cloud API» — 'Meta Cloud API' in the page subtitle
- 34:36: «Tené esto a mano para conectar en minutos / Confirmá los puntos para continuar» — Voseo inconsistent with tú elsewhere; 'en minutos' contradicted by the ~20 min chip below
- 34:36: «Recorrido terminado. Te mostramos dónde está cada cosa; esta guía no puede verificar si quedó configurado.» — Guidance that disclaims itself
- 35:36: «Ya uso la API de WhatsApp con otro proveedor (BSP) · Sin downtime» — BSP, downtime — the card she actually needed was the least understandable
- 35:36: «Mantén tu WhatsApp Business App activa en el teléfono mientras conectas la API de Cloud.» — 'API de Cloud'
- 35:48: «Velocidad de envío limitada a ~20 mensajes/segundo (suficiente para la mayoría de negocios)» — Throughput metric irrelevant to an SMB
- 35:48: «Los dispositivos vinculados (WhatsApp Web/Desktop) se desconectan al activar — puedes reconectarlos después» — Scary side effect stated without reassurance up front
- 36:00: «WhatsApp Business App actualizada (versión 2.24.17 o superior) · El número debe tener al menos 7 días de actividad en la app · Conexión WiFi estable (la sincronización puede tardar varias horas)» — Version numbers and multi-hour sync in the prerequisites
- 36:00: «Tienes 24 horas después de conectar para autorizar la sincronización del historial. Si no lo haces dentro de ese plazo, deberás repetir el proceso completo de conexión.» — Deadline threat before the button
- 39:12: «Número de teléfono que pueda recibir SMS o llamadas (no VoIP ni premium) · Aceptar los Términos de Servicio de la Plataforma WhatsApp Business · Selecciona o crea tu portafolio de Meta Business» — VoIP, portafolio de Meta Business — jargon in the 'easy' path
- 39:12: «Tus credenciales se encriptan con AES-256 y nunca se almacenan en texto plano.» — Crypto jargon under the CTA
- 39:36: «No recibimos la autorización — La ventana se cerró antes de terminar. Vuelve a intentar y no la cierres hasta ver "Conexión exitosa".» — Blames the user; no diagnosis (popup blocked? wrong method? wrong Facebook account?)
- 33:48: «Instalar Parallly — Acceso rápido desde tu escritorio o celular» — Off-task prompt overlapping the channel cards