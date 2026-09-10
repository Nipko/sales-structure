# Adenda para Claude: landing completa, comparación Meta y claridad de cobros

Esta directiva amplía [la adaptación Meta/WhatsApp](claude-meta-whatsapp-adaptation.md) y [el cierre del release](claude-release-closure-after-pr-review.md). La investigación y copy maestro están en [landing-positioning-and-content-plan.md](../../research/2026-09-10/landing-positioning-and-content-plan.md). Fecha de corte: 10 de septiembre de 2026.

## Mandato

Incorpora al plan la actualización de **toda la landing y su llegada al onboarding**, no sólo la home. Implementa el contenido y las correcciones demostradas, conservando el trabajo concurrente y los controles existentes. La propuesta debe mostrar la capacidad real de Parallly mediante tareas completas y explicar plataforma/IA, mensajería Meta y cobros del comercio antes de contratar.

Mantén commits incrementales y el mismo PR draft. No mezcles cambios ajenos en staging, no hagas `git add .`/`-A`, no reescribas historia ni sustituyas código que otro agente esté cerrando. Conserva el cierre técnico de términos, publicación/rollback y staging. Bases, credenciales y proveedores sintéticos locales están autorizados; producción, cuentas reales, gastos, comunicaciones a clientes, cambios de contratos y despliegue requieren la autorización concreta que todavía no otorga esta directiva.

No pidas permiso para preparar contenido, implementar correcciones locales, traducir o ejecutar las pruebas ya autorizadas. Deja las decisiones comerciales y el despliegue como último paso, con un resultado completo y revisable.

## Fuentes obligatorias de esta adenda

- [Meta por superficie](../../research/2026-09-10/meta-agent-competitive-evidence.md).
- [30 capacidades propias y límites](../../research/2026-09-10/parallly-differentiation-evidence.md).
- [Auditoría de 34 rutas y claims](../../research/2026-09-10/landing-claims-and-content-audit.md).
- [Copy maestro y arquitectura de información](../../research/2026-09-10/landing-positioning-and-content-plan.md).
- [Núcleo de pagos en es/en/pt/fr](../../research/2026-09-10/landing-billing-copy.i18n.json).
- Contratos de producto actuales, `billing_plans`, flags de disponibilidad, política de canales/verticales y fuentes de calidad que se citan en esos documentos.

Revisa los hallazgos contra HEAD; las pruebas históricas y cifras del inventario no certifican el release nuevo. Mantén la distinción entre implementado, probado localmente, piloto y producción. No publiques 76 perfiles certificados cuando el reporte conocido tiene cero.

## L0 — autoridad comercial y evidencia

Deriva el inventario de rutas renderizadas, locales, CTAs y claims del código. Los 17 archivos/34 rutas actuales son punto de partida; nuevas rutas e idiomas deben entrar automáticamente. Clasifica cada promesa como capacidad, resultado, precio, prueba, disponibilidad o comparación.

Amplía el contrato de `marketing-claims.ts` y los verificadores existentes; conserva las garantías de testimonios/estadísticas ya implementadas. No añadas un segundo registro inconexo que la UI pueda ignorar. Las comparaciones necesitan producto/superficie, tarea, país/idioma, alcance, fecha, fuente y caducidad de revisión. Las pruebas de texto literal no bastan para acreditar una acción.

Por cada función propia, exige evidencia proporcional: implementación alcanzable, contrato/recorrido ejecutado y capacidad ofrecida por el release/plan. Una feature sólo presente en seed o un backend con flag apagado no genera automáticamente una promesa pública. No exigir un benchmark global para corregir una FAQ; sí impedir superlativos/resultados cuantitativos sin evidencia apropiada.

La comparación debe distinguir agente directo de WhatsApp, otras superficies Meta y API empresarial. Las tarifas de API no se usan como precio del agente directo. Reconoce que Meta aprende, personaliza, agenda con Google Calendar, conecta Drive y tiene herramientas/seguimiento/handoff. No copies cruces del antiguo comparador de “bots básicos”. `no documentado` no significa `no disponible`.

## L1 — proyección de planes y oferta real

Corrige en una proyección reusable del catálogo, no con filtros aislados en la home:

1. Email interno no es canal conversacional autoservicio; SMS está retirado para nuevas ventas/altas. Preserva soporte de obligaciones legacy sin publicitar altas nuevas.
2. Web Chat procede de la capacidad `widget`, no necesariamente de `features.channels`. Distingue número de conexiones y número de agentes.
3. Custom `salesLed` no debe mostrar `999`, `-1` ni ilimitados sin contrato. Ausencia, cero, ilimitado contratado y pendiente de cotización son estados distintos.
4. Los badges de prueba requieren `trialAvailable`, además de días/requisito de pago. Conserva `monthlyAvailable`, `annualAvailable`, `signupAvailable`, `checkoutMode` y razones por país/proveedor; no convertir precio USD de referencia en checkout disponible.
5. Añade cobros del comercio con `customerPayments` y requisitos explícitos, separados de pago Meta y suscripción.
6. Corrige el quiz: coteja volumen, canales, usuarios y herramientas contra capacidades vigentes. No es válido recomendar por posición/suma de respuestas ni llamarlo “ideal” sin resolver requisitos. Si no hay plan, ofrece propuesta.
7. Precio bruto/neto/impuestos/ciclo/descuento deben corresponder al contrato aprobado. Anual muestra total y equivalente mensual; no inventar anual USD ni reprecificar planes actuales.

API, home, tabla de precios, quiz, soluciones, signup y dashboard deben compartir la semántica. El catálogo sin respuesta muestra un error recuperable, no un precio fijo de respaldo. La jurisdicción fiscal se resuelve con configuración/condición comercial validada; no cambies tratamiento tributario sólo para que coincida con la landing.

## L2 — pagos y configuración comprensibles

Implementa bloque de tres pagos en home/precios, aviso cercano al CTA y página canónica propuesta `/costos-whatsapp`. Reutiliza texto/contrato en signup, onboarding, canales y Assist. Evita mostrar todas las condiciones únicamente en una FAQ o footer.

Para modalidad directa: negocio paga Meta; Parallly cobra plataforma/IA; sus clientes pagan al comercio por su pasarela. Para crédito de un partner, mostrar pagador y contrato reales. Si se desconoce la modalidad, no fingir pago directo.

Mantén esas tres ramas en avisos de precios, FAQ, CTA y recorrido, no sólo en la explicación larga. La prueba con medio de pago SaaS debe enunciar ese requisito. El beneficio de servicio gratuito necesita variante futura/activa; antes del corte no describir la cuota de octubre como vigente. Mostrar también el requisito de financiación y su fecha, según modalidad.

La tarjeta SaaS no configura Meta; no pedir tarjeta Meta en chat. La CTA debe abrir el destino correcto y releer al volver mediante M1. Mostrar ausencia/desconocido/adjunto/restringido con fecha, sin equiparar método adjunto a saldo o entrega garantizados. La prueba Parallly y los requisitos de operar WhatsApp son distintos.

Usa reglas de M2 con vigencia. Antes del 1-oct, aviso futuro; después, regla activa. Mensajes de servicio, plantilla y respuesta IA mantienen unidades separadas. Mil gratis por número/mes no se multiplica por país. No prometer consumo gratuito sin método Meta ni ahorro automático por anuncios.

El estimador público usa tarifas verificadas, alcance y exclusiones claros, sin datos personales ni llamadas reales. No publiques el Excel interno de margen como una cotización al cliente. Un límite presupuestario sólo se anuncia como duro después de M3. Haz visible total estimado del canal además de suscripción y los costos no incluidos conocidos.

No bloquear esta corrección documental esperando tener todos los proveedores: explica lo vigente y prepara la UI de funciones nuevas con sus gates. No publicar una pantalla que diga “pago verificado” cuando sólo abrió Meta.

## L3 — propuesta de valor, demostraciones y comparación

Implementa el copy maestro como una narrativa por tareas. Diferencia agente que atiende clientes, Assist de configuración y copiloto humano. Quita lenguaje interno como “ancla”, “fallback”, “sin valores de respaldo” y conteos arquitectónicos que no ayudan a decidir.

Actualiza home, producto, agente, CRM, reservas, canales, Android, índice/18 soluciones, precios, FAQ, soporte, navegación y footer. Cada solución muestra su escenario efectivo y requisitos. No prometas un flujo especializado por tener una plantilla genérica. Mantén Android como acceso anticipado donde corresponda; no inventes tiendas, iOS o administración móvil completa.

Construye cuatro demos revisables y rotuladas: cita, pedido/pago, handoff y configuración inicial. Para cada una, distingue animación/ejemplo, ensayo local y caso real. La prueba del flujo debe atravesar UI/API/DB/runtime con proveedor sintético y comprobar el objeto final. Un texto “reservado” en una animación no es evidencia de reserva; un link emitido no es pago liquidado.

En una demo de identidad multicanal, no unir por nombre ni enviar confirmación a WhatsApp desde Instagram sin identidad, consentimiento, conexión y permiso. En voz/media, revisar también el hallazgo `media-download.service.ts`: descarga WA sin `accountId` al resolver token; incorporarlo a M1 y probar dos números/cuentas antes de prometer el recorrido multicuenta.

Añade `/comparar/meta-business-agent` con metodología, fecha, fuentes, selección por necesidad y datos de alcance. La home muestra una comparación corta con texto accesible; la página detallada distingue oferta app/API. No declararnos más baratos, mejores o más privados sin comparación real. Reconocer cuando la opción nativa satisface la necesidad forma parte de una comparación útil.

Campañas: no describir plantillas como preaprobadas universalmente ni anunciar envío/programación/cancelación más allá de sus contratos probados. Testimonios continúan apagados hasta contar con evidencia y consentimiento. Sustituye “casos reales” por “ejemplos ilustrativos” donde corresponda; no fabricar métricas para completar diseño.

## L4 — continuidad, cuatro idiomas, SEO y accesibilidad

Los cuatro archivos de mensajes actuales tienen paridad estructural; las contradicciones también están traducidas. Actualiza es/en/pt/fr semánticamente y revisa `es-AR` como overlay, no como quinta experiencia completa. Reutiliza el núcleo de copy propuesto adaptándolo a los namespaces reales.

Preserva idioma, vertical/subtipo, plan, país, ciclo y atribución permitida entre landing y dashboard. Valida/limita parámetros en ambos extremos, vuelve a comprobar catálogo y permite revisar selección. No transportar prompts, PII, credenciales ni permisos mediante query string. Mantén allowlist y protección contra redirects externos.

Define URLs de idioma indexables coherentes con Next/static export, metadata, canonical, hreflang y sitemap derivado. Conserva redirects/enlaces anteriores. No apuntar cuatro idiomas al mismo HTML dependiente de cookie. Traduce títulos/OG/breadcrumbs/FAQ y mensajes de contacto. Signup/status deben tener política de indexación propia; no añadir ratings/Offers sin evidencia para completar JSON-LD.

Verifica teclado, foco, lector de pantalla, zoom, contraste, móvil y movimiento reducido incluidas animaciones JS. El costo no debe depender de hover ni quedar fuera de pantalla. La comparación no depende sólo de colores/checks. FAQ enlaza botón y panel; signup tiene estado accesible y enlace de recuperación. No ampliar el diseño con un vídeo pesado que impida entender la oferta sin reproducirlo.

## L5 — contratos, datos y confianza

Prepara revisión coordinada de términos, privacidad, tratamiento, borrado y soporte. La privacidad actual distingue entrenamiento general y uso Meta de manera potencialmente incompatible con aprendizaje/ejemplos del nuevo release: documenta flujos reales y contratos de proveedores, conserva procedencia y evita garantías absolutas no verificadas.

Publicar costos esenciales junto a oferta, total y requisitos consistentes con checkout. Identifica datos pendientes del responsable legal/financiero y entrega redacción concreta para revisar; esa dependencia no impide cerrar el resto. No inventes una aprobación legal ni aceptes contratos del tenant.

Usa marcas y denominaciones correctamente; integración API no acredita por sí sola badge o categoría de partner. Un buen test local no acredita seguridad certificada, uptime o resultados en producción. Mantén separados permisos Meta y elegibilidad por sector/país; confirma discrepancias antes de prometer disponibilidad.

Cancelar Parallly, desconectar un canal y retirar financiación de Meta son actos distintos. La ayuda debe explicar qué cobra cada proveedor y qué gestión corresponde al cliente sin hacer cambios externos automáticos por una visita a la landing.

## L6 — pruebas y cierre

Extiende las verificaciones existentes; los tres validadores actuales pasan pese a los hallazgos. Prueba el DOM exportado/hidratado y contratos con estas combinaciones:

- catálogo sin respuesta, incompleto, precio cero y quote no contratable;
- Email/SMS legacy, widget por feature, múltiples conexiones y Custom con sentinels;
- `trialDays > 0` con `trialAvailable=false`, requisito SaaS de pago y Meta separado;
- país/ciclo sin checkout, anual/12 y datos fiscales/condiciones efectivos;
- recomendador con requisitos mayores que Starter, plan desactivado y ningún plan compatible;
- idioma/industria/plan/país/ciclo a través de signup y llegada al wizard; parámetros inválidos, URL externa y catálogo cambiado;
- 999/1000/1001 entregas, humanos, varios números/países y cambio de vigencia; no confundir cuota IA y Meta;
- pago Meta desconocido, ausente, adjunto y restringido; no mostrar solvencia falsa;
- comparación sin evidencia, evidencia vencida, anuncio no habilitado, app frente a API y resultado cuantitativo sin benchmark;
- cuatro idiomas, placeholders, overlay es-AR, legal/metadata/OG/JSON-LD, links/sitemap;
- demos ilustrativas, conocimiento ausente, intervención humana y ninguna llamada remota real durante pruebas;
- rutas publicadas completas a móvil/escritorio; todas las plantillas de página y páginas con contenido distinto, no sólo home.

Ejecuta build y contratos landing; pruebas de billing/shared/dashboard afectadas; regresión del cierre tras tocar flujo de registro o runtime. Haz capturas de revisión y documenta qué se comprobó con navegador y qué queda para usuarios reales. Repetir las comprobaciones pertinentes tras cambios nuevos; no ejecutar suites completas repetidamente por editar un documento.

Prepara el ensayo de comprensión con usuarios nuevos: deben explicar tres pagadores, requisitos, plan y próxima acción. El benchmark real y las cuentas elegibles siguen siendo gates externos; no detener la corrección de copy ni simular esos resultados.

## Entrega

Actualiza el plan con L0–L6 y un vínculo a cada hallazgo de la auditoría. Entrega rutas modificadas, copy final, capturas, mapa de claims→evidencia, decisiones comerciales pendientes, versiones y checks sobre HEAD. Distingue qué corrige una oferta existente de qué anuncia una función nueva y su gate de activación.

El candidato queda listo para revisión cuando toda la web y el onboarding dicen lo mismo que el producto/catálogo, las demos están identificadas, la comparación es verificable y todos los cambios locales ejecutables están terminados. Mantén el PR draft y prepara despliegue/canario/rollback con las directivas anteriores; no publiques ni reprecifiques sin la autorización final correspondiente.
