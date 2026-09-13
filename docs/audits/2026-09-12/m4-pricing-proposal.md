# M4 — Propuesta comercial para aprobación

**Estado: PROPUESTA. Nada de esto está aplicado.** No se cambió ningún precio,
ninguna capacidad de plan, ningún contrato aceptado ni ninguna comunicación a
clientes. La fila M4 sigue `abierta` y sólo la cierra una decisión del dueño.

Fecha: 12 de septiembre de 2026. Revisión de las cifras: ver §7.

---

## 1. El hecho que ordena todo lo demás

**Parallly no le paga a Meta.** Somos Tech Provider: desde el 1 de octubre de
2026 Meta le cobra a la WABA **del propio negocio** cada mensaje de servicio
entregado. No pasa por nuestra factura y no podemos absorberlo, subsidiarlo ni
revenderlo con margen.

Por eso M4 **no** es "cuánto sube el costo de Parallly". Es una decisión sobre
tres cosas distintas:

1. si nuestros límites de plan siguen teniendo sentido cuando el tenant adquiere
   un costo marginal que antes no tenía;
2. si el precio de Parallly cambia, y en qué dirección, cuando el gasto total
   del cliente sube sin que suba nuestro ingreso;
3. qué se le dice, y cuándo, a los clientes de los cinco planes vigentes.

La línea "WhatsApp/Meta" del COGS en `docs/plan-profitability-2026-07.md` no
existe como costo nuestro. Cualquier escenario que la use está mal planteado.

## 2. Las cifras verificadas

Derivadas de `whatsapp-rate-table.generated.ts`, tarjeta
`meta-ratecards-2026/USD/2026-10-01`, no de memoria:

| Mercado | Servicio (USD/msj) | Marketing (USD/msj) |
|---|---:|---:|
| Colombia | 0,000800 | 0,012500 |
| Brasil | 0,006800 | 0,062500 |
| México | 0,008500 | 0,039700 |
| Chile | 0,020000 | 0,088900 |
| Argentina | 0,026000 | 0,061800 |
| Perú | 0,030000 | 0,070300 |

**La franquicia:** 1.000 entregas de categoría `service` por **número** y por
**mes calendario de la zona horaria de la WABA**, sin arrastre
(`rollsOver: false`), efectiva desde el 2026-10-01.

**Dos tarjetas, no una.** La de julio no tiene tarifa de servicio para ningún
mercado: antes de octubre el servicio era gratis. La regla es versionada y el
código ya la aplica así; cualquier comunicación tiene que distinguir antes y
después de la fecha, no presentar una sola cifra.

**El precio lo fija el país del DESTINATARIO**, no el del negocio. Un negocio
colombiano que atiende a un cliente en Perú paga la tarifa peruana: 37 veces la
colombiana para un mensaje de servicio.

## 3. Los cinco planes vigentes

De `apps/api/prisma/seed-billing-plans.js`. El catálogo de runtime puede llevar
overrides por tenant; estas son las líneas base:

| Plan | Precio base | Trial | Agentes |
|---|---:|---:|---:|
| emprendedor | USD 21,00 | 7 d | 1 |
| starter | USD 49,00 | 7 d | 1 |
| pro | USD 129,00 | 15 d | 3 |
| enterprise | USD 349,00 | 15 d | 10 |
| custom | negociado | — | ilimitado |

## 4. Qué le pasa al cliente, en números

Un negocio **colombiano** con un número, sólo mensajes de servicio:

| Conversaciones/mes | Entregas de servicio | Sobre franquicia | Costo Meta al negocio |
|---:|---:|---:|---:|
| 300 | 1.000 | 0 | USD 0,00 |
| 900 | 3.000 | 2.000 | USD 1,60 |
| 3.000 | 10.000 | 9.000 | USD 7,20 |

El mismo negocio atendiendo **clientes peruanos**, mismo volumen de 10.000
entregas: **USD 270,00**. Ese es el dato que cambia la conversación, y es
geográfico, no de plan.

**Consecuencia comercial:** para un negocio colombiano que atiende Colombia, el
cobro de Meta es ruido frente a USD 49 de plan. Para uno que atiende Perú,
Argentina o Chile con volumen, el cobro de Meta puede superar el plan. No hay un
único mensaje que sirva para los dos.

## 4.1 Margen: el nuestro no se mueve, nuestra participación sí

**Margen bruto de Parallly: sin cambio.** Nuestro COGS por tenant es LLM más
infraestructura. La línea "WhatsApp/Meta" de `plan-profitability-2026-07.md` no
existe como costo nuestro (§1), así que octubre no mueve ni un punto de margen.
Cualquier escenario que presente una "compresión de margen" está usando esa
línea inexistente.

Lo que sí cambia es **qué fracción del gasto del cliente somos**, y eso decide
cuánto se ve un aumento de precio. Con 10.000 entregas de servicio al mes sobre
el plan starter de USD 49:

| Destinatarios | Costo Meta al negocio | Gasto total del cliente | Parallly sobre el total |
|---|---:|---:|---:|
| Colombia | USD 7,20 | USD 56,20 | 87 % |
| México | USD 76,50 | USD 125,50 | 39 % |
| Chile | USD 180,00 | USD 229,00 | 21 % |
| Perú | USD 270,00 | USD 319,00 | 15 % |

Leído para decidir: en Colombia somos casi todo lo que el cliente paga, así que
un aumento se nota entero y no hay nada que lo diluya. En Perú somos la sexta
parte, así que un aumento nuestro es pequeño en el total **y** llega junto con
una factura nueva de Meta que el cliente atribuirá a WhatsApp o a nosotros sin
distinguir. Las dos lecturas apuntan al mismo lado: no es el trimestre para
subir el precio.

## 5. Decisión aplicada

**A — No cambiar precios. Hacer visible el gasto y limitar por número.**

Decisión registrada el **12 de septiembre de 2026**, con el dueño del producto
como responsable. La autoridad ejecutable es
`WHATSAPP_OCTOBER_COMMERCIAL_POLICY`: el ledger importa sus valores y el informe
de cierre lee el mismo objeto. Los textos todavía no se han enviado; quedan
publicados dentro del producto cuando se despliegue el candidato.

1. **Precios: sin cambio.** Nuestro costo no subió. Subir el precio porque subió
   el costo del cliente es cobrar dos veces el mismo hecho, y es el momento en
   que un competidor con agente nativo de Meta gratis se ve más barato.
2. **Techo por número, aprobado en `observe` primero.** Antes de esta decisión todo alcance salvo
   la franquicia se crea en `observe`, así que un tenant que no configuró nada
   no tenía tope: un bucle corría hasta que alguien veía la factura. Decisión:
   sembrar un techo por número igual a **la franquicia más un margen** —
   1.000 + 1.000 entregas/mes — en `observe`, medir un ciclo, y sólo entonces
   decidir si pasa a `enforce`. **Un umbral adivinado ya frenó en este programa
   exactamente lo que debía permitir**; por eso la propuesta es medir antes.
3. **Límites de plan: sin cambio de capacidad.** Lo que falta no es capacidad,
   es visibilidad. El panel de gasto ya existe; la decisión es mostrarlo en el
   alta y no sólo en Facturación.
4. **Comunicación en dos segmentos**, porque el hecho es distinto:
   - destinatarios domésticos de tarifa baja (CO, BR, MX): "esto no te va a
     cambiar la factura; acá está dónde verlo";
   - destinatarios de tarifa alta o mezcla internacional (AR, CL, PE): el número
     de su propio mes pasado, calculado con la tarjeta de octubre, antes de que
     llegue la primera factura.
5. **Pre-requisito duro:** la tarjeta en la WABA antes del 30 de septiembre. Sin
   método de pago, el 1 de octubre el agente deja de entregar. Esto no es una
   decisión de precio, es un aviso operativo con fecha.

## 5.1 Los dos techos, y por qué son una sola decisión

Hay **dos** techos distintos y el escenario A sólo hablaba de uno.

**Techo por número** (protege la factura): la franquicia más un margen,
1.000 + 1.000 entregas/mes, sembrado en `observe`, medido un ciclo y recién
entonces considerado para `enforce`.

**Techo por contacto** (protege la conversación): esto no es sobre la factura.
Medido en `spend-ceiling.postgres.spec.ts` sobre PostgreSQL real: con techo
agregado de cuenta y **sin** techo por contacto, un bot que contesta a nuestro
bot consume la cuota entera de la cuenta y **el siguiente cliente real queda sin
respuesta**. Con los dos, el bucle se detiene en su propio techo (3 de 30
intentos) y la cuenta conserva 17 de sus 20 entregas para las demás personas.

El mecanismo está construido y probado; **el número no está elegido**, y hoy
todo alcance salvo la franquicia nace en `observe`, así que un tenant que no
configuró nada no tiene ninguno de los dos.

**Decisión:** sembrar ambos en `observe` con el mismo criterio —medir un ciclo
antes de que refusen algo— y un techo por contacto inicial deliberadamente alto,
en **60 entregas por contacto y por mes**: una conversación de soporte
intensa de un mes cabe cómodamente y un bucle automático lo cruza en horas. Es
un valor inicial observable: el dato que decidirá si se conserva o se corrige es
la distribución real de entregas por contacto, que existe en el ledger. **Un umbral adivinado ya frenó en este programa
exactamente lo que debía permitir**, y por eso el orden es medir, luego elegir.

## 5.2 Los cinco planes, uno por uno

Bajo el escenario A no hay migración: ninguna capacidad cambia, ningún contrato
aceptado se toca y nadie cambia de plan. Lo que cada plan necesita es distinto,
y es visibilidad, no capacidad:

| Plan | Precio | Qué cambia en el plan | Qué necesita el dueño de ese plan |
|---|---:|---|---|
| emprendedor | USD 21 | nada | el aviso del método de pago; con un número y tráfico doméstico, la franquicia lo cubre casi siempre |
| starter | USD 49 | nada | el aviso, más el panel de gasto visible en el alta y no sólo en Facturación |
| pro | USD 129 | nada | lo anterior, y el techo por número sembrado en `observe` (3 agentes = más tráfico por número) |
| enterprise | USD 349 | nada | lo anterior, y su mezcla real de destinatarios antes de la primera factura |
| custom | negociado | nada | igual que enterprise, y revisión de su contrato por si menciona costos de mensajería |

La migración sólo existe si se aprueba el escenario C, y entonces es: leer
`billing_plans` y los overrides autorizados (§7.3), clasificar cada tenant por
mezcla de destinatarios de un ciclo real, y sólo después proponer un cambio de
plan a quien lo cruce. Nada de eso se puede hacer con la tabla de §3, que es
línea base de aprovisionamiento.

## 6. Alternativas, con lo que cada una cuesta

**B — Subir precio y ofrecer "mensajes incluidos".**
No podemos: no compramos los mensajes, no los podemos incluir. Implementarlo
exigiría convertirnos en Solution Partner y pasar el cobro por nuestra línea de
crédito — un cambio de modelo con impuestos por país, no un cambio de precio.
**Descartada por estructura, no por preferencia.**

**C — Plan nuevo "internacional" más caro para quienes atienden fuera del país.**
Defendible: el costo del cliente sí es geográfico. Pero el precio lo fija el país
del destinatario, que varía mensaje a mensaje, así que el plan cobraría por una
predicción del mix de destinos. Un cliente con 5 % de mensajes a Perú pagaría
igual que uno con 60 %. **Viable sólo después de un ciclo de datos reales de
mix por destinatario**, que hoy no tenemos.

**D — Descuento temporal para los planes altos como amortiguador.**
Cuesta ingreso real para amortiguar un costo que no es nuestro, en los clientes
que menos lo sienten en proporción. **No recomendada.**

**E — No hacer nada y no comunicar.**
El costo aparece en la factura de Meta del negocio, sin aviso nuestro, y el
primer soporte es "¿por qué Parallly me está cobrando WhatsApp?" — cuando no lo
estamos cobrando. **El peor resultado de los cinco**, y el único que ocurre por
omisión.

## 7. Qué hay que verificar antes de aprobar

1. **La tarjeta de octubre contra la superficie de Meta.** Las tarifas de §2
   salen del CSV preservado en el repositorio, con su `sourceSha256` y su
   `sourceUrl`. Meta reprecia por trimestre. Antes de comunicar un número a un
   cliente hay que confirmarlo en la superficie oficial.
2. **El mix de destinatarios por tenant.** §4 usa dos extremos. El dato real por
   tenant existe en el ledger de gasto y nadie lo ha leído todavía; es lo que
   decide si el segmento "tarifa alta" son cinco clientes o cincuenta.
3. **Los overrides por tenant.** §3 son líneas base; el catálogo de runtime
   manda. Cualquier migración tiene que leer `billing_plans` y los overrides
   autorizados, no esta tabla.

## 8. Registro de cierre de M4

La decisión registrada dice:

1. precios y capacidad de los planes sin cambio;
2. 2.000 entregas por número y mes calendario, sembradas bajo `observe`;
3. 60 entregas por contacto y mes, sembradas bajo `observe`;
4. los dos textos segmentados que aparecen en la autoridad ejecutable;
5. aviso dentro del producto desde el 15 de septiembre de 2026 y fecha límite
   del método de pago el 30 de septiembre de 2026.

El despliegue y cualquier comunicación directa fuera del producto siguen en el
gate de release. Registrar esta decisión no afirma que ya se haya enviado.
