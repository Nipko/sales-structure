# Rentabilidad por plan — Julio 2026

Análisis de márgenes por plan de suscripción, actualizado antes de congelar los precios en MercadoPago producción. Datos de precios y límites **code-grounded** desde `apps/api/prisma/seed-billing-plans.js` y `apps/api/src/modules/ai/router/llm-router.service.ts`; los costos de terceros (comisión MP, WhatsApp/Meta, Factus, TRM) son **supuestos de mercado etiquetados** — ajustalos con tus cifras reales.

## TL;DR

- **Todos los planes son rentables** en uso típico: margen bruto **59–77 %**.
- El sistema **acota el COGS por diseño** (presupuesto de LLM + crédito de WhatsApp + circuit-breaker de multimedia por plan), así que **ni en el peor caso un plan pierde plata** — el piso de margen es **11–25 %**.
- **Starter es el plan menos rentable** (64 %) porque su precio COP está fijado ~15–20 % por debajo del tipo de cambio de los demás. **Recomendación: subirlo antes de sincronizar.**
- Emprendedor, Pro y Enterprise están bien → se pueden sincronizar con los precios actuales.

---

## Supuestos (validá / ajustá estos)

| Supuesto | Valor usado | Nota |
|---|---|---|
| TRM para costos en USD | **4.200 COP/USD** | Los costos de IA/WhatsApp/multimedia se pagan en USD. Spot 2026 ~3.900–4.300. |
| Uso de mensajes IA | tenant activo consume **toda su cuota** con el modelo default del tier | Conservador-alto. El uso real SMB suele ser 10–30 % de la cuota. |
| Uso de WhatsApp / multimedia | **~40 %** del crédito/tope del plan | Muy variable; mucho tráfico de WhatsApp cae en ventana de servicio (gratis). |
| Comisión MercadoPago CO | **3,29 % + IVA 19 % ≈ 3,9 %** + COP 500 fijo + ~0,4 % GMF al retirar | De `billing-plan.md` (tarifa pública MP). Confirmá tu contrato. |
| Factus (factura DIAN) | **~250 COP/factura** | Rango 150–300 COP/doc a bajo volumen. |
| Infra prorrateada | **~4.500–8.000 COP/tenant** | VPS $15/mes ÷ 10–20 tenants + servicios. Baja con escala. |

**Costo del LLM por mensaje** (2.000 tokens entrada / 200–300 salida, × ~1,5 llamadas/mensaje por el loop de herramientas), del `MODEL_REGISTRY` del router:

| Tier (plan) | Modelo default | USD/mensaje |
|---|---|---|
| tier_4 (Emprendedor) | deepseek-chat | ~$0,0008 |
| tier_3 (Starter) | gemini-2.5-flash | ~$0,0011 |
| tier_2 (Pro) | grok-4.1-fast / gpt-4.1-mini | ~$0,0005–0,0011 |
| tier_1 (Enterprise) | claude-sonnet / gpt-4o | ~$0,007–0,009 |

---

## Márgenes por plan (escenario "tenant activo típico")

| Plan | Precio COP/mes | COGS estimado | Margen bruto | Margen % | Piso (peor caso) |
|---|---:|---:|---:|---:|---:|
| **Emprendedor** | 125.700 | ~28.900 | ~96.800 | **77 %** | ~16 % |
| **Starter** | 215.800 | ~78.200 | ~137.600 | **64 %** | ~13 % |
| **Pro** | 679.500 | ~204.400 | ~475.100 | **70 %** | ~11 % |
| **Enterprise** | 1.789.800 | ~729.800 | ~1.060.000 | **59 %** | ~25 % |
| **Custom** | negociado | — | — | sales-led | — |

### Desglose del COGS estimado (COP/mes, uso típico)

| Componente | Emprendedor | Starter | Pro | Enterprise |
|---|---:|---:|---:|---:|
| LLM (cuota completa, modelo default) | 4.800 | 34.650 | 78.750 | 315.000 |
| WhatsApp/Meta (~40 % del crédito) | 8.400 | 16.800 | 42.000 | 84.000 |
| Multimedia (~40 % del tope) | 5.000 | 12.600 | 50.400 | 252.000 |
| Comisión MercadoPago | 5.900 | 8.900 | 27.000 | 70.500 |
| Factus (1 factura) | 250 | 250 | 250 | 250 |
| Infra prorrateada | 4.500 | 5.000 | 6.000 | 8.000 |
| **Total COGS** | **~28.850** | **~78.200** | **~204.400** | **~729.750** |

### Topes de diseño que definen el "peor caso" (por plan, en USD/mes)

Aunque un tenant se vuelva loco, el sistema corta el costo:

| Tope | Emprendedor | Starter | Pro | Enterprise | Custom |
|---|---:|---:|---:|---:|---:|
| Presupuesto LLM (`llmCostBudgetUsdCents`)¹ | $8 | $25 | $60 | $100 | ∞ |
| Crédito WhatsApp incluido | $5 | $10 | $25 | $0 | $0 |
| Circuit-breaker multimedia (`dailyBudget`×30)² | $3 | $7,5 | $30 | $150 | $1.500 |

¹ Tope **blando**: al superarlo el router no corta el servicio, degrada a modelos baratos (tier_3/4) para proteger margen.
² Tope **duro**: al superarlo bloquea el procesamiento de multimedia ese día.

**Peor caso absoluto** (satura los tres topes) = LLM + WhatsApp + multimedia al máximo, convertido a COP + comisión MP + infra. Da los "pisos" de la tabla de márgenes (11–25 %): **delgado pero siempre positivo.** En la práctica es rarísimo (implica saturar el circuit-breaker de $/mes de LLM, que requiere mensajes con muchísimos tokens).

---

## Hallazgos

1. **Márgenes sanos.** 59–77 % bruto en uso típico. El benchmark SaaS saludable es 70–80 %; estamos en rango, con Emprendedor y Pro arriba.

2. **El diseño protege el margen.** Los tres topes garantizan que ningún tenant, por más que abuse, lleve un plan a pérdida. Esto es una ventaja real frente a competidores que cobran IA por créditos add-on.

3. **⚠️ Starter está subvalorado.** Los precios COP no derivan de un tipo de cambio único: el FX implícito es **Emprendedor 5.986, Starter 4.404, Pro 5.267, Enterprise 5.128** COP/USD. Starter quedó ~15–26 % más barato que el resto respecto a su precio en dólares, y además es el plan con peor relación cuota-IA/precio. Por eso su margen (64 %) es el más bajo.

4. **Precios alineados al mercado LatAm.** Competidores: Whaticket $39, Wati $39, Leadsales $84, Kommo $79–159, Chatfuel $69. Emprendedor $21 es un ancla agresiva de captación; Starter $49, Pro $129 y Enterprise $349 son defendibles.

5. **Costos fijos bajos.** La plataforma fija cuesta ~$20–60/mes (VPS $15 + Sentry/SMTP/dominio). **Se cubre con un solo cliente Pro o dos Starter.** Con la capacidad actual (10–20 tenants activos) el negocio es muy rentable.

---

## Recomendaciones antes de sincronizar

1. **Subir Starter** de 215.800 a **~250.000–255.000 COP** (alinear a FX ~5.100/5.200 como los demás). Sube su margen de 64 % a ~71 % sin salirse del mercado. *(Este es el único ajuste realmente recomendado.)*

2. **Definir el modelo de WhatsApp para Enterprise/Custom** (hoy `whatsappCredit = 0`): ¿pass-through al cliente o absorbido? Recomendado **pass-through** en planes altos para no comerse el margen si el cliente hace mucho marketing saliente.

3. **Opcional — unificar el FX de todos los planes** a una tasa única (p. ej. 5.100) para que la lógica de precios sea consistente y fácil de mantener. Con 5.100: Emprendedor ~107k (hoy 125,7k, está arriba), Starter ~250k (subir), Pro ~658k (≈ hoy), Enterprise ~1,78M (≈ hoy).

4. **Validar con datos reales** una vez en producción: el sistema ya registra el consumo real de LLM por tenant (`ai:stats`, `TenantFinancialSnapshot.llmCost`). A los 30–60 días, reemplazá los supuestos de uso por los números medidos.

---

## Datos que faltan para cerrar el modelo

- Comisión **exacta** de MercadoPago Colombia en tu contrato (porcentaje + IVA + retención).
- Precio firme de **Factus** por documento/paquete (cotización comercial).
- Mix real de mensajes **WhatsApp** por categoría (marketing vs utility vs service gratis) por tenant.
- **Tokens promedio reales** por mensaje IA por vertical (para afinar el costo LLM esperado).
