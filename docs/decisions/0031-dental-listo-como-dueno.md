# 0031 — Dental QA de «no listo» a «listo» como dueño: tiempo, precisión del copiloto y fricciones

- Estado: aceptada
- Fecha: 2026-11-10
- Relacionadas: #420 (correcciones de producto), ADR 0012 (copiloto)
- Contexto: criterio R3 de la fase C (un tenant de salud pasa a «listo» en ≤ 20 min desde el panel) y la meta de precisión del copiloto (≥ 90 %) nunca se habían medido.

## Qué se hizo

Con la sesión de super_admin, entré al tenant `spark-qa-dental-03` con «Acompañamiento de onboarding» como motivo y trabajé solo desde el panel, como lo haría el dueño:

1. Subí un documento de la clínica en Conocimiento › Crear: un texto ficticio con todos los datos del negocio, que sirvió de verdad de referencia.
2. Corrí el copiloto («Analizar mis fuentes»).
3. Aprobé o corregí sus propuestas.
4. Llené el resto de los bloqueantes en los cajones de Preparación, en Citas › Servicios y en Configuración › Localización.

## Resultados

- **Tiempo:**
  - Inicio a las 03:30:30 UTC: 18 bloqueantes y 19 necesarios.
  - A las 03:41:14 (10 min 44 s) quedaban 2 bloqueantes que el dueño no podía cerrar.
  - Esos dos se corrigieron en el producto con #420 (sección «Bloqueos del producto»).
  - Tras desplegar #420, cerrar ambos tomó unos 2 min: llenar «mis citas»; el catálogo pasó solo al recalcular.
  - **Veredicto final: «Listo con límites»** (0 bloqueantes de 20; 15 necesarios por completar), a las 05:45 UTC.
  - **Tiempo efectivo del dueño: ≈ 12–13 min**, sin contar la espera del despliegue ni el nuevo inicio de sesión. Cumple el criterio R3 de ≤ 20 min, pero solo con #420; antes de #420 era imposible llegar a «listo».
- **Copiloto** (≈ 40 s, 7 datos, 2 contradicciones y 4 preguntas):
  - **Precisión:** 7 de 9 datos plenamente correctos (78 %).
    - Los precios llegaron como «contradicción» con 5 versiones rivales, cuando son 5 ítems distintos.
    - El contacto traía WhatsApp con el valor literal «WhatsApp».
  - **Lo que no inventó:** ningún dato. La regla de cita literal funcionó.
  - **Recall de bloqueantes:** propone 5 de 17 (horario, sede, precio, pagos, cancelación). No propone, aunque el documento lo dice:
    - país, zona horaria y moneda;
    - atención humana;
    - urgencias;
    - alcance clínico;
    - datos de salud;
    - aviso de privacidad;
    - modo de reserva;
    - modificar o cancelar;
    - «mis citas»;
    - catálogo.
  - Una de sus preguntas («¿qué NO hace?») ya estaba respondida en el documento.
  - **No cumple la meta del 90 %.**
- **Bug de forma:** el horario aprobado desde el copiloto (`[["08:00","18:00"]]`) quedó «confirmado · no cumple» («tramo inválido» en los 6 días). Re-guardarlo sin cambios desde el formulario lo arregló.

## Bloqueos del producto (corregidos en #420)

1. `OBJ.*.ACCOUNT_READ`:
   - Es bloqueante en salud, pero sus fuentes eran solo `derived` e `integration`.
   - El cajón decía «Lo aporta una integración, no un formulario» y nada lo derivaba.
   - Ahora acepta `owner_form`.
2. `OBJ.*.CATALOG`:
   - Exige `price_type`. La pantalla de servicios guarda «Precio confirmado» como `price_status=confirmed`, sin `price_type`.
   - La regla L1 lo dejaba en `null`.
   - Ahora L1 `confirmed` usa el `price_type` de la fila o, con precio > 0, `fijo`.

## Fricciones abiertas (orden de impacto)

1. **El país se declara en dos lugares.**
   - El cajón `CORE.IDENTITY.REGION` guarda en `requirement_values`.
   - El pack de país sale de `tenants.operating_country`, que solo escribe Configuración › Localización.
   - Hasta declararlo allí, REGION, EMERGENCY_BASE y EMERGENCY_PROTOCOL siguen en «sin país».
2. **Datos del copiloto con forma inválida:** el horario (arriba) y el contacto.
3. **Formularios con texto de desarrollador:**
   - placeholders sin interpolar: «{objeto}», «{reservas}», «{n} precios»;
   - descripciones de tipo: «enum […]», «bool (ref …)», «text_i18n», «ISO-3166», «IANA», «BCP-47»;
   - etiquetas en inglés: «Own urgent line», «Red flags», «Consent text», «Min fields», «Disclaimer»;
   - JSON crudo en las tarjetas del copiloto.
4. **«Editar y aprobar» abre vacío:** el formulario no trae la propuesta del copiloto, y cada elemento de contacto es un cuadro que espera JSON.
5. **El precio enlaza a 14 pantallas de catálogo de todos los verticales.**
   - La primera, `/admin/service-catalog`, redirige al inicio.
   - La pantalla correcta, Citas › Servicios disponibles, no está enlazada.
   - `screenTargetsFor` ya resuelve la pantalla por objeto, pero el cajón no la usa.
6. **El horario de atención humana no hereda el horario del negocio:** dice «por defecto = CORE.HOURS.REGULAR» pero abre con los 7 días cerrados.
7. **Campos que aparecen solo después del primer «Guardar»:** el plazo y el mensaje de la solicitud.
8. **Conteos que no coinciden:** el resumen dice «18 bloqueantes», mientras la lista muestra 17 en Bloqueantes y 17 en Necesarios. La primera carga muestra «Historial (0)».
9. **Modo de reserva por defecto:** el aviso de calidad dice «Tu agente ya confirma citas directamente con el modo por defecto». Para salud, ese modo debería ser «solicitud».
10. **El formulario de servicio no tiene campos para descripción, incluye/excluye ni preparación**, que el requisito necesario sí pide.

## Decisiones de datos (dental)

- **Modo de reserva:** solicitud que confirma la recepción, con plazo de 1 día.
- **Modificar y cancelar:** como solicitud, con la política general.
- **Consentimiento de datos:** sí.
- **Notificaciones:** discretas.
- **Contenido clínico:** el que publica la clínica. No reemplaza la revisión clínica de la plataforma; el triage dental sigue apagado.

## Próximos pasos

- Llevar la precisión del copiloto a ≥ 90 %. Tres frentes:
  - que emita el formato que valida cada requisito (horario, contacto);
  - que trate los precios de varios ítems como una lista, no como una contradicción;
  - que cubra los bloqueantes de salud, región y atención humana que ya están en el documento.
- Unificar el país: que el cajón REGION escriba `tenants.operating_country`.
- Limpiar el texto de desarrollador de los formularios y precargar la propuesta en «Editar y aprobar».
- Usar `screenTargetsFor` en el cajón de precio y enlazar Citas › Servicios.
- Hacer que la pantalla de servicios escriba `price_type` y deje de depender de L1.
