# 0008 — Formularios del panel de preparación: lo que C0 no fijaba (R3, interfaz)

- Estado: aprobada (decidida con la autorización autónoma del dueño del 30-oct-2026; se revisa con él a su regreso)
- Fecha: 2026-10-30 · Decide: dueño · Autor: Claude (R3, interfaz)
- Ámbito: `packages/business-spec/src/forms/descriptor.ts`, módulo `readiness` de la API, `/admin/readiness` (cajón), `/admin/readiness/defaults`, tarjeta de Inicio, catálogos i18n del dashboard.

## Contexto

C0 §1.6 pide formularios generados por tipo desde la especificación, un cajón por hueco y una pantalla de defaults; §5 R3 pide formularios para los 13 bloqueantes del núcleo y para `WRITE_MODE` y `CHANGE_RULES` de los 15 objetos. Al construirlo aparecieron decisiones que el diseño no fijaba.

## Decisión

1. **El descriptor se deriva de la prosa de `data.structure`, sin tocar el YAML.** `formFor()` lee la descripción de cada campo (`enum […]`, `enum_list […]`, `bool`, `duration`, `money`, `weekly_hours`, `lista de {…}`, `text_i18n`…). Donde la prosa no dice la forma que lee el evaluador, un ajuste explícito en `descriptor.ts` la fija: solo para los 13 bloqueantes y las dos plantillas de objeto. No se agregan claves `form:` al esquema de requisitos; si los ajustes crecen, se pasan al YAML en otra rebanada.
2. **La validación del cliente interpreta el descriptor.** La imagen del dashboard no empaqueta `@parallext/business-spec`, así que la API sirve el descriptor y el panel solo lo interpreta (`readiness-forms.ts`). No es una segunda copia de reglas: `readiness-forms.spec.ts` cruza esa validación con `validateRequirementValue` en todos los formularios de la especificación (lo que el cliente deja guardar, la API lo acepta; lo que la API rechaza por requerido o enum, el cliente también).
3. **El formulario pide más que la API.** La API sigue validando solo lo normativo (ADR 0007 §9). El formulario además exige lo que el evaluador necesita para cumplir (largo de la descripción, «al menos uno», país y moneda, plazo y cargo de cancelación…), para que guardar sirva para salir del hueco.
4. **Qué abre el cajón.** `GET /readiness/:t` devuelve `formRequirementIds`. Un requisito tiene formulario si se guarda como valor del negocio **y** admite `owner_form` en `sources.allowed`; por eso `OBJ.*.ACCOUNT_READ` (solo derivado o integración) no lo tiene. `CORE.OFFER.PRICE_MODEL`, `CORE.OFFER.ITEM_DETAILS` y `CORE.KNOWLEDGE.FAQ_HYGIENE` se guardan como valor, pero su evaluador lee ítems o textos: siguen en su pantalla.
5. **La pantalla del catálogo es la del objeto del tenant.** `ui_target` de `CORE.OFFER.ITEMS` nombra siempre la de servicios y `PRICE_MODEL` no tiene. La API manda `screenTargets`: la pantalla de `OBJ.<O>.CATALOG` del primer objeto habilitado.
6. **El enlace a la pantalla vieja queda como secundario hasta R3b.** Un `PUT` no escribe el almacenamiento viejo y el agente lo sigue leyendo (ADR 0007 §11). El cajón es la acción principal; dentro, un enlace a la pantalla actual avisa que conviene revisarla. Se retira en R3b, cuando los lectores pasen a `BusinessFactsReader`. Sí se retira ya la acción «Pronto podrás completarlo aquí».
7. **Precarga con lo que lee el motor.** El cajón usa la fila guardada o, si no hay, el valor resuelto de la foto (también heredado por reglas L). Confirmar un dato heredado es revisarlo y guardar. Los campos que el formulario no conoce se descartan, porque la API los rechaza.
8. **Formas que fija el formulario:** el horario es `days.<día> = [{open, close}]` (lo que lee el evaluador, no el `[[a, b]]` del ejemplo); «usar la política general» en `CHANGE_RULES.terms` se guarda como el texto `ref CORE.POLICY.CANCELLATION_CHANGES` (la forma del ejemplo, que el evaluador trata como remisión), y solo se ofrece en objetos con fecha u hora (`RESERVABLE_OBJECTS`); un sí/no tiene tres estados, porque «sin declarar» no es «no»; las opciones de enum se guardan literales, igual que las valida la API (`canal (A1)`).
9. **Defaults.** La pantalla lista solo `predicate_kind: default_accepted` y muestra como default `when_missing.behavior`, porque el YAML no declara valores por defecto explícitos ni `default_changed_in`.
10. **Idiomas.** Las etiquetas de los campos y opciones de los formularios de R3 están en los cuatro catálogos. El resto cae en la etiqueta del descriptor. La ayuda y las reglas en prosa salen de la especificación y están solo en español.
11. **Alcance global.** El cajón escribe `scopeKey = ''`. Los alcances por sede, objeto o ítem (`location:`, `object:`, `item:`) no tienen interfaz todavía.

## Consecuencias

- Agregar un requisito con prosa estándar no requiere tocar el dashboard; una forma nueva sí requiere un componente o un ajuste en `descriptor.ts`, con su prueba.
- Hasta R3b, el panel puede decir «cumple» por un valor que el agente aún no lee. El control de salida (R4) sigue sin activarse antes de R3b.

## Preguntas que surgieron, resueltas (autonomía del dueño, 30-oct-2026; se revisan a su regreso)

- **`OBJ.*.AVAILABILITY_SOURCE` no se acepta como default.** La API sigue rechazándolo. De dónde sale la disponibilidad es un hecho propio de cada negocio, y un default equivocado haría que el agente afirme disponibilidad que no existe. Se revisa en R4, cuando `effective-capability` consuma `WRITE_MODE`.
- **`CORE.HANDOFF.HOURS_SLA.sla_out_of_hours` pasa a ser una unión** (`siguiente_apertura` o una duración ISO-8601) en el YAML, dentro de R3b. Hasta entonces, el formulario guarda `siguiente_apertura` o el literal `duration`, que la API acepta.
- **`WRITE_MODE.required_fields` queda como lista abierta con sugerencias.** El diccionario de campos por objeto se agrega a `objects.yaml` en R4, que es quien lo consume al escribir.

## Alternativas descartadas

- **Formularios escritos a mano por requisito:** C0 los descarta; sería una pantalla por requisito, desfasada del YAML.
- **Importar el paquete en el dashboard:** obliga a cambiar la imagen y el bundler. El descriptor ya viaja por la API, como pide C0.
- **Quitar ya los enlaces a las pantallas viejas:** el dueño dejaría de ver el almacenamiento que el agente todavía lee.
