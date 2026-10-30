# Evidencia de canales para completar el onboarding

Fecha de consulta: 18 de septiembre de 2026. Investigación documental; no se conectaron cuentas, enviaron mensajes, modificaron configuraciones ni verificó producción. Las recomendaciones son propuestas de producto y arquitectura, no capacidades ya certificadas de Parallly.

## Conclusión

Mantener la primera respuesta de prueba antes de cualquier conexión externa. La meta de diez minutos sirve para el trabajo que la persona hace dentro de Parallly cuando tiene los requisitos a mano; no es una promesa defendible de que cualquier número de WhatsApp quedará funcionando en ese tiempo. Los cinco canales deben tener igual derecho a ser elegidos, pero no comparten requisitos, elegibilidad ni tiempo de conexión.

No encontré evidencia suficiente para certificar coexistencia de WhatsApp de principio a fin usando únicamente el mismo celular. La guía de Wati documenta escanear un QR desde WhatsApp Business. Esto justifica una prueba real de usabilidad por dispositivo, no afirmar que siempre se puede ni que siempre es imposible.

## Seis fuentes primarias verificadas y qué permiten concluir

### 1. Meta: Instagram API with Instagram Login

Fuente: [colección oficial de Meta en Postman](https://www.postman.com/meta/instagram/folder/6raa77c/instagram-api-with-instagram-login).

La documentación de Meta describe acceso para cuentas profesionales de Instagram —negocio o creador— y dice que esta modalidad no exige una Página de Facebook vinculada. También enumera los permisos `instagram_business_*`.

**Aplicación:** en el camino Instagram Login de Parallly, no presentar crear una Página de Facebook como requisito. Sí verificar tipo de cuenta y permisos necesarios antes de declarar que puede recibir y responder mensajes.

**Límite:** esto no describe Instagram con Facebook Login, cuyo modelo es distinto. Tampoco certifica que la app de Parallly tenga aprobados sus permisos en producción. Hace falta validar el flujo real con su app/configuración.

### 2. Wati: conexión por coexistencia

Fuente: [How to connect your WhatsApp number to Wati via WhatsApp Coexistence](https://support.wati.io/en/articles/11822421-how-to-connect-your-whatsapp-number-to-wati-via-whatsapp-coexistence-coex).

Wati separa coexistencia de la conexión Cloud API, parte de un número que ya está en WhatsApp Business App y documenta confirmación mediante mensaje de Facebook Business y QR. Su recorrido incluye decidir si se sincroniza historial durante esa conexión. Hay requisitos de versión y restricciones regionales.

**Aplicación:** conservar el triage por situación del número antes de abrir Meta. Presentar los pasos necesarios para esa ruta, guardar progreso y ofrecer continuar desde otro dispositivo cuando haga falta.

**Límite:** es evidencia del producto Wati, no certificación de Parallly ni de todos los proveedores. La sincronización de historial depende de integración, permisos y estado del alta: no debe ofrecerse como importación universal disponible después. El documento no demuestra que el QR pueda completarse en el mismo y único celular.

### 3. respond.io: migración desde otro proveedor

Fuente: [Phone Number Migration to respond.io WhatsApp Business Platform](https://respond.io/help/whatsapp/phone-number-migration-to-respond-whatsapp-business-api).

La guía enumera dependencias fuera del panel: acceso administrativo al negocio de Meta, condiciones de aprobación, acceso al número para OTP, cupo de números y resolución de la verificación en dos pasos; según la configuración anterior, puede requerir intervención del proveedor vigente. La conservación de determinados activos se documenta para esa migración concreta.

**Aplicación:** representar “estoy con otro proveedor” como una ruta asistida y reanudable, con requisitos por comprobar. No prometer un plazo fijo ni mezclar la preparación con el cambio efectivo de proveedor.

**Límite:** las afirmaciones de continuidad y preservación de respond.io son sobre su implementación. No garantizan cero interrupción en Parallly. No se propone borrar cuentas, desregistrar números ni ejecutar migraciones durante el onboarding básico.

### 4. respond.io: prueba de agentes sin contactos reales

Fuente: [How to Test AI Agents](https://respond.io/help/ai-agents/how-to-test-ai-agents).

respond.io permite conversar con un agente dentro de su configuración, revisar fuentes utilizadas y observar acciones simuladas con un contacto de prueba. Distingue esa simulación de una conversación real: no modifica contactos ni aparece en Inbox; ciertos eventos, seguimientos y transferencias no se ejecutan como en producción.

**Aplicación:** el primer resultado de Parallly puede y debe llegar antes de Meta. Mostrar por qué respondió así y qué datos faltan ayuda más que pedir una conexión para descubrir que la configuración no sirve.

**Límite:** una prueba de texto correcta no demuestra entrega en WhatsApp ni recepción efectiva por una persona. Verificar ambos por separado. El ensayo no debe escribir pedidos, citas, cobros ni avisos reales sin que la superficie lo declare y el usuario lo haya solicitado.

### 5. Wati: Playground web antes del despliegue

Fuente: [Test your web AI agent in the playground](https://support.wati.io/en/articles/15434001-test-your-web-ai-agent-in-the-playground).

Wati documenta un Playground para ensayar el agente web sin un número ni una conversación real de WhatsApp. Aclara que acciones que necesitan una conversación real, como asignarla a un usuario, requieren una prueba con una sesión real.

**Aplicación:** corregir la afirmación histórica “Wati no permite probar antes de Meta”. La prueba antes de conexión es una expectativa competitiva; la diferenciación debe ser la rapidez, calidad y pertinencia del resultado para el negocio.

**Límite:** esta página describe el agente web; no permite inferir qué incluye cada plan ni que toda la plataforma o cada chatbot pueda probarse con las mismas condiciones.

### 6. Wati: alcance concreto del trial

Fuente: [Explore Wati with a 7-Day free trial](https://support.wati.io/en/articles/11462976-explore-wati-with-a-7-day-free-trial).

Wati documenta prueba sin tarjeta con mensajería limitada al número del usuario y funciones restringidas; distingue explorar el producto de atender clientes reales. Algunas acciones, como guardar automatizaciones y ciertas configuraciones, quedan fuera de la prueba descrita.

**Aplicación:** definir dos contratos explícitos en Parallly: probar al agente y operar un canal real. La cuota de demo no debería presentarse como el mismo producto que el chat web operativo. Antes de recomendar Instagram, la pantalla debe saber si el trial permite conectarlo y qué alternativa de prueba ofrece.

**Límite:** es una decisión comercial de Wati, no una obligación técnica de Meta ni una recomendación de copiar restricciones que hagan perder el trabajo del dueño.

## Límites de acceso a Meta y evidencia pendiente

Intenté abrir tanto [Embedded Signup](https://developers.facebook.com/docs/whatsapp/embedded-signup/) como [Onboarding Business App Users](https://developers.facebook.com/docs/whatsapp/embedded-signup/custom-flows/onboarding-business-app-users/) y la ruta nueva `/documentation/business-messaging/whatsapp/embedded-signup/onboarding-business-app-users`. La herramienta devolvió errores de acceso; las rutas antiguas respondieron HTTP 429. No doy su contenido por verificado.

Por ello, no convertir en requisitos universales de Parallly cifras de antigüedad del número, países excluidos, duración de sincronización ni plazos de migración publicados por otro proveedor. Verificarlos en Meta y con el registro real de Parallly antes de escribirlos como hechos en la interfaz. Tampoco hay evidencia aquí para cerrar D4 —disponibilidad de números 555 en su Embedded Signup— ni para prometer coexistencia desde un único celular.

## Cambios recomendados al plan

Estas son inferencias de diseño basadas en las fuentes y en la auditoría del repositorio; ninguna fuente impone esta arquitectura.

1. **Separar tres resultados.** “Vi una buena respuesta” es valor demostrado; “la conexión quedó autorizada” es preparación técnica; “un cliente recibió una respuesta” es activación real. Terminó el asistente no equivale a ninguno de los tres.
2. **Convertir diez minutos en hipótesis medible.** Medir tiempo propio de configuración y tiempo de espera externa por separado. La meta principal debe ser primera respuesta útil en el ensayo. Publicar tiempos de conexión por ruta solo después de medirlos, con percentiles y tasa de éxito.
3. **Elegir un canal prioritario sin esconder los otros cuatro.** Ordenar por dónde llegan hoy los clientes, receta, elegibilidad y plan. Mantener “hacer después” por canal con causa guardada. No convertir igualdad de elección en cinco conexiones obligatorias ni en idéntica promesa de minutos.
4. **Resolver el trial como producto.** Recomendación: que la prueba permita evaluar el canal preferido cuando sea viable, con límites transparentes. Si la decisión comercial sigue siendo WhatsApp únicamente, decirlo antes de recomendar conectar Instagram; permitir demostrar valor por el ensayo/enlace sin fingir disponibilidad operativa.
5. **No colapsar los hechos en una etapa monótona.** Conservar por conexión: ruta elegida, autorización, permisos, número/cuenta registrados, webhook verificado, agente asignado, restricciones conocidas, prueba de entrega y último estado bueno. Separar `desconocido`, `pendiente`, `bloqueado` y `falló tras funcionar`; cada uno exige una acción y un tono distinto.
6. **Un único contrato de enlace de prueba frente a canal real.** El predicado que determina cuota, límites y handoff debe concordar con conexión operativa, activación y eventos. El código actual ya permite que el enlace atienda con cuota del plan, pero todavía excluye toda fila `is_demo` de `firstReplyAt`: cerrar esa contradicción antes de instrumentar el embudo.
7. **Activación externa comprensible.** Guardar cambios puede seguir siendo inmediato. Antes de comenzar atención real, mostrar una confirmación breve con canal/cuenta, agente y receptor humano. No reintroducir borradores, candidatos ni publicación obligatoria. No declarar “ya responde” por recibir el callback de OAuth: comprobar lo verificable y mostrar lo que aún no se conoce.
8. **Handoff comprobable.** Usar al dueño como receptor inicial visible; invitar un segundo usuario es opcional. Distinguir dirección de aviso, persona responsable y disponibilidad. En el ensayo puede mostrarse la transferencia simulada; en una prueba operativa solicitada se comprueba que Inbox/aviso reciben el traspaso y que la IA cede el turno.
9. **Reanudación entre dispositivos.** Guardar en servidor decisiones y estado, no tokens en enlaces. Permitir retomar el paso correcto luego de autenticar desde otro dispositivo. Evitar forzar a volver a elegir receta o perder cambios después de una ventana de Meta cerrada.

## Criterios de aceptación antes de dar el recorrido por terminado

| Caso | Resultado que debe observarse |
| --- | --- |
| Dueña con un solo Android o iPhone | Puede ver al agente responder sin conectar Meta; conserva todo al pasar entre navegador y app. La prueba de coexistencia documenta qué ruta completa realmente en ese dispositivo. |
| Instagram profesional sin Página Facebook | El camino Instagram Login no pide crear una página; expone permisos o elegibilidad faltantes con una acción precisa. |
| WhatsApp ya en otro proveedor | Queda una preparación reanudable; no se anuncia migración terminada, fecha garantizada ni pérdida/continuidad de servicio sin evidencia. |
| OAuth termina pero falta registro/webhook/requisito de entrega | Se muestra conectado parcialmente o pendiente de completar; no aparece una victoria falsa de respuesta operativa. |
| Solo enlace público con plan que incluye chat web | Cuota, handoff, canal operativo y primera respuesta real coinciden; la tarjeta de Inicio no sigue diciendo que no hay ningún canal. |
| Solo enlace de prueba | Tiene límites comprensibles; no activa métricas de cliente real ni promete atención humana que la ruta no permite. |
| Negocio de una persona | El dueño figura como receptor; no aparece invitar otro usuario como requisito para estar listo. |
| Conexión temporalmente ilegible | La interfaz conserva “no comprobado”; no afirma desconexión ni éxito. |

