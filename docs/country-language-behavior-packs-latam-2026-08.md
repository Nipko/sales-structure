# Especificación de comportamiento lingüístico por país — agosto de 2026

**Producto:** Parallly / Parallext Engine  
**Estado:** investigación y contrato de diseño; no implementa código ni certifica mercados  
**Cobertura inicial:** 15 países de Latinoamérica/Brasil, más tratamiento separado para Estados Unidos y Canadá  
**Uso obligatorio:** entrada del [plan maestro de verticales 1:1](./vertical-full-implementation-plan-2026-08.md), del contrato de prompts y de la auditoría de herramientas

## 1. Dictamen ejecutivo

La plataforma no puede resolver hoy de manera confiable el país operativo, la variedad lingüística ni la forma de tratamiento de una conversación. El país de facturación, el huso horario, el idioma del agente y el país libre de Business Info se usan como señales parcialmente intercambiables, aunque significan cosas distintas. El detector reduce la lengua a `es|en|pt|fr`; por tanto no distingue `es-CO`, `es-MX`, `es-AR`, `pt-BR`, `en-CA` o `fr-CA`.

La solución tampoco consiste en pegar modismos dentro del system prompt. Se deben separar dos capacidades:

1. **Reconocimiento:** entender expresiones locales, abreviaturas, tratamiento, correcciones, negativas, solicitudes de humano y señales de riesgo.
2. **Generación:** responder de manera clara y natural con el registro elegido por el tenant o el cliente, sin caricaturizar el país ni imitar slang por defecto.

Una expresión local puede ser válida lingüísticamente y, aun así, no constituir consentimiento transaccional. `hágale`, `órale`, `ya po`, `dale`, `listo`, `pura vida`, `ta bien`, `pode ser` o `beleza` pueden significar aceptación, comprensión, sorpresa, evaluación positiva, cierre o simple continuación. Para pagos, cancelaciones, reservas con penalidad, aceptación de términos y cambios sensibles, una palabra aislada nunca debe autorizar la acción.

La RAE documenta que `vos` es tratamiento informal general en Argentina y Paraguay y que convive con `tú` y `usted` en otras zonas; no existe un único voseo latinoamericano que se pueda aplicar a todos los países. Véanse el [Diccionario panhispánico de dudas](https://www.rae.es/dpd/vos) y el [Plan Curricular del Instituto Cervantes](https://cvc.cervantes.es/ensenanza/biblioteca_ele/plan_curricular/niveles/02_gramatica_inventario_a1-a2.htm).

## 2. Alcance real encontrado en la plataforma

### 2.1 Países y datos que hoy divergen

- Onboarding muestra 17 países: `CO, MX, AR, CL, PE, BR, UY, PY, BO, EC, VE, CR, PA, DO, GT, US, CA`.
- El backend acepta 62 códigos derivados del mapa de husos horarios; solo los 17 anteriores tienen moneda de cobro configurada.
- `billingCountry` se usa en partes del alta como país de empresa. Debe servir únicamente para precio, fiscalidad y proveedor de cobro.
- El idioma persistido puede construir un tag con el país inferido del huso, no necesariamente con el país seleccionado.
- Business Info no siempre nace con `country`, por lo que `<turn><business><country>` puede quedar vacío.
- El prompt recibe un país libre, no un `countryPackId` versionado.
- Configuración web solo ofrece una fracción de los locales necesarios; el runtime conversacional vuelve a colapsarlos a cuatro idiomas.
- Hay defaults globales `es-CO`, `COP`, `+57`, Bogotá y, simultáneamente, instrucciones en voseo argentino.

### 2.2 Fallos code-backed que hacen urgente el contrato

| Riesgo | Evidencia actual | Consecuencia |
|---|---|---|
| país perdido | `Tenant` conserva `billingCountry`, pero `TenantConfig` no tiene país/locale/moneda y `TurnContext` solo recibe el país libre de Business Info | intent, tools, RAG y confirmaciones no saben la jurisdicción operativa |
| agente colombiano por default | `buildDefaultPersona()` fija `es-CO` y `America/Bogota`; la plantilla puede superponerse sin corregir ambos | tenant brasileño/argentino puede iniciar con identidad regional incorrecta |
| mezcla de variantes | calendario `es-MX`, templates Meta `es_MX`, defaults COP/+57/Bogotá y guidance en voseo (`resumí`, `pedí`, `confirmá`) | una misma conversación mezcla Colombia, México y Argentina |
| teléfono corruptible | `normalizePhoneE164()` cae a `+57` y varios consumidores no pasan país | identidades/CRM/imports/booking pueden normalizar o fusionar números incorrectamente |
| moneda fragmentada | billing, `operatingCurrency`, `settings.currency` y monedas de objetos no comparten resolver; 37 servicios seed usan COP | cotizaciones y tool results pueden usar una moneda ajena al tenant |
| timezone split-brain | Localización, Agenda, Conversations, Automation, Properties y executor aplican precedencias distintas | cliente, calendario y tool pueden calcular horas diferentes |
| confirmación duplicada | Booking, guard central, appointments, RAG rewrite y pipeline mantienen vocabularios distintos | una frase local puede ejecutar una cita pero no otra acción, o viceversa |
| handoff/opt-out country-blind | listas independientes y `includes()` literal | baja cobertura de portugués, tildes, paráfrasis y expresiones regulatorias locales |
| RAG sin jurisdicción | documentos tienen idioma, pero no país, autoridad, vigencia o applicability; retrieval solo usa idioma base | normativa colombiana puede responder a un tenant mexicano porque ambos son `es` |
| Agent Test diferente de live | no resuelve exactamente country, vertical guidance, RAG regional ni timezone efectivo | una prueba visual puede aprobar un contrato que no existe en producción |

Referencias clave: `apps/api/prisma/schema.prisma:22-46`; `packages/shared/src/index.ts:171-190,757-763`; `persona.service.ts:360-414`; `conversations.service.ts:108-135,1943-1955,2035-2043`; `common/utils/phone.util.ts:14-79`; `knowledge.service.ts:652-780`; `agent-test.service.ts:107-167`.

### 2.3 Identidad que se debe separar

```ts
type TenantOperatingIdentity = {
  operatingCountry: ISO3166Alpha2;
  billingCountry: ISO3166Alpha2;
  operatingCurrency: ISO4217;
  billingCurrency: ISO4217;
  settlementCurrencies: ISO4217[];
  timezone: IanaTimezone;
  defaultLanguage: string;
  defaultLocale: Bcp47Tag;
  addressForm: "usted" | "tu" | "vos" | "voce" | "senhor_senhora";
  countryPackId: string;
  countryPackVersion: string;
};
```

`operatingCountry` gobierna terminología y operación; `billingCountry` gobierna la relación comercial entre Parallly y el tenant. La ubicación del cliente puede ser distinta de ambas y debe prevalecer cuando se conoce de forma confiable.

## 3. Contrato propuesto

```ts
type CountryLanguageBehaviorPack = {
  id: string;                       // es-CO
  version: string;
  country: ISO3166Alpha2;
  status: "draft" | "fallback_only" | "pilot" | "certified";
  primaryLocale: Bcp47Tag;
  supportedLocales: Bcp47Tag[];
  fallbackPack: "es-419" | "pt-BR" | "en" | "fr";

  recognition: {
    addressForms: RecognitionRule[];
    affirmativeAliases: IntentAlias[];
    negativeAliases: IntentAlias[];
    correctionAliases: IntentAlias[];
    cancellationAliases: IntentAlias[];
    humanHandoffAliases: IntentAlias[];
    safetyAliases: SafetyAlias[];
    abbreviations: Record<string, string[]>;
    codeSwitching: CodeSwitchRule[];
  };

  generation: {
    defaultAddressForm: "usted" | "tu" | "vos" | "voce";
    permittedAddressForms: string[];
    neutralVocabulary: Record<Domain, string>;
    tenantSelectableTerms: Record<Domain, string[]>;
    prohibitedStereotypes: string[];
    slangGeneration: "disabled" | "tenant_opt_in";
  };

  formats: {
    locales: Bcp47Tag[];
    currencies: ISO4217[];
    callingCodes: string[];
    timezones: IanaTimezone[];
    addressSchemaId: string;
    personalIdentifiers: IdentifierDefinition[];
    taxIdentifiers: IdentifierDefinition[];
  };

  transactionalPolicy: {
    explicitConfirmationRequiredFor: ToolEffect[];
    contextRequiredAliases: string[];
    neverAuthorizeFromSingleToken: string[];
  };

  sources: SourceReference[];
};

type IntentAlias = {
  value: string;
  normalized: string;
  intent: "affirm" | "reject" | "cancel" | "correct" | "acknowledge" | "continue";
  confidence: "high" | "medium" | "low";
  allowedPendingStates: string[];
  forbiddenActions?: string[];
  notes?: string;
};
```

Los tags deben ser BCP 47 y los formatos deben delegarse en CLDR/`Intl`, no en tablas artesanales. Referencias: [W3C sobre language tags](https://www.w3.org/International/articles/language-tags/index.en.html) y [Unicode CLDR](https://cldr.unicode.org/).

## 4. Política determinista de confirmación

### 4.1 Clases de respuesta

| Clase | Ejemplos | Tratamiento |
|---|---|---|
| afirmación explícita | `confirmo`, `acepto`, `proceda con la reserva` | válida solo si el resumen y el objeto pendiente coinciden |
| afirmación contextual | `listo`, `dale`, `ya`, `va`, `pode ser` | continuar o aclarar; no autorizar efectos costosos por sí sola |
| reconocimiento | `ok`, `perfecto`, `claro`, `beleza` | confirma comprensión, no consentimiento |
| corrección | `mejor`, `quise decir`, `na verdade` | invalida confirmación previa y reabre campos afectados |
| negativa | `no`, `todavía no`, `melhor não` | no ejecutar; conservar o cancelar estado según intención |
| cancelación | `cancele`, `dejémoslo`, `deixa pra lá` | distinguir cancelar workflow de cancelar objeto existente |

### 4.2 Condición mínima para ejecutar

```text
estado pendiente compatible
+ un solo objeto pendiente
+ resumen visible con campos críticos
+ afirmación permitida para ese estado y país
+ ausencia de corrección, condición o negación
+ entitlement y readiness vigentes
+ idempotency key
= autorización ejecutable
```

Nunca basta una palabra aislada para cobrar, crear un enlace de pago, cancelar algo pagado, aceptar términos, enviar campañas, contratar seguro, aceptar una cotización vinculante, autorizar tratamiento o modificar datos críticos.

Las expresiones calificadas —`sí, pero…`, `dale si…`, `listo aunque…`, `pode ser, só que…`— se clasifican como `unclear/correct`, no como confirmación. La regla debe ser única para booking engine, tool ledger, procedimientos, RAG rewrite y cualquier workflow nuevo.

## 5. Base panlatinoamericana y brasileña

### 5.1 Generación neutral

- una idea y una pregunta por mensaje;
- lenguaje directo, breve y comprensible;
- `usted` como fallback conservador en salud, finanzas, seguros, legal, gobierno y reclamos;
- `tú`, `vos` o `você` solo según pack, marca y preferencia del cliente;
- no usar `vosotros` para América;
- no trivializar salud, riesgo o dinero con diminutivos;
- explicar siglas la primera vez;
- no usar un regionalismo cuando el objeto operativo necesita un nombre inequívoco;
- no deducir país o estatus migratorio por acento, teléfono o vocabulario aislado.

Guías oficiales de Colombia, Argentina, Chile y Brasil coinciden en claridad, estructura directa y reducción de jerga: [Colombia](https://www1.funcionpublica.gov.co/web/politicas-de-servicio-al-ciudadano/lenguaje-claro/como-implementar-el-lenguaje-claro), [Argentina](https://www.argentina.gob.ar/sites/default/files/2023/12/6_lenguaje_claro.pdf), [Chile](https://www.integridadytransparencia.gob.cl/oficiolenguajeclaro/) y [Brasil](https://www.gov.br/servidor/pt-br/assuntos/laboragov/curadoria-tematica/linguagem-simples).

### 5.2 Léxico de reconocimiento común

- Afirmación explícita: `sí`, `confirmo`, `acepto`, `correcto`, `de acuerdo`, `quiero confirmar`, `puede confirmar`.
- Contextual: `ok`, `claro`, `perfecto`, `listo`, `bueno`, `dale`.
- Negación: `no`, `no confirmo`, `no acepto`, `mejor no`, `todavía no`, `cancele`.
- Corrección: `quise decir`, `me equivoqué`, `corrijo`, `más bien`, `mejor`, `en realidad`, `no era X, era Y`.
- Humano: `asesor`, `agente`, `una persona`, `humano`, `representante`, `ejecutivo`, `supervisor`.

## 6. Packs prioritarios país por país

Los términos listados son candidatos de reconocimiento y generación controlada, no una afirmación de frecuencia nacional. Cada pack sigue en `draft` hasta validarse con hablantes nativos, corpus consentido y evals por subtipo.

### 6.1 Colombia — `es-CO`

**Tratamiento:** `usted` por defecto; `tú` configurable. Reconocer `vos` y `sumercé` regionalmente, sin generarlos por defecto.  
**Confirmación explícita:** `sí`, `confirmo`, `acepto`, `correcto`, `de acuerdo`.  
**Contextuales:** `hágale`, `de una`, `listo`, `bueno`, `claro`, `perfecto`, `dale`. `hágale` puede aceptar o incitar; `de una` expresa ante todo inmediatez. ASALE documenta ambos usos: [hágale](https://www.asale.org/damer/hacer) y [de una](https://www.asale.org/damer/una).  
**Operación:** `cita|consulta|valoración`; `reserva|estadía|huésped`; `arriendo|alquiler|canon|inmueble`; `separación|abono|anticipo|cuota inicial`; `recoger|retiro|domicilio|envío`; `pedido|factura electrónica|cotización`.  
**Identificadores/formato:** cédula, NIT y RUT no son equivalentes; COP, `+57`, varias zonas/estructuras de dirección. La [DIAN distingue RUT y NIT](https://www.dian.gov.co/tramitesservicios/tramites-y-servicios/tributarios/Paginas/RUT.aspx).  
**Riesgo:** no interpretar `$` como COP sin contexto; no usar colombianismos en tenants que atienden otros países.

### 6.2 México — `es-MX`

**Tratamiento:** `usted` formal/regulado; `tú` cercano. Reconocer voseo del sur sin convertirlo en default nacional.  
**Contextuales:** `va`, `sale`, `órale`, `ándale`, `bueno`, `jalo`, `listo`. `órale` también expresa exhortación o sorpresa; [ASALE documenta su polisemia](https://www.asale.org/damer/%C2%A1%C3%B3rale%21). `siempre no` es reversión/rechazo, nunca afirmación por contener `sí`.  
**Operación:** `cita`; `reservación|reserva`; `renta`; `apartado|enganche|anticipo`; `recoger en sucursal|recolección|entrega`; `pedido|orden|CFDI`; `CAT|mensualidades|MSI`.  
**Identificadores/formato:** INE, CURP y RFC; MXN, `+52`, múltiples husos; estado, municipio/alcaldía, colonia, calle, exterior/interior y CP. Fuentes: [SAT/RFC](https://www.sat.gob.mx/portal/public/tramites/inscripcion-al-rfc-pf) y [CONDUSEF/CAT](https://webappsos.condusef.gob.mx/EducaTuCartera/credito.html).  
**Riesgo:** `va` puede ser verbo y `sale` puede referir a salida/precio; exigir estado pendiente.

### 6.3 Argentina — `es-AR`

**Tratamiento:** `vos` cercano y coherente (`querés`, `podés`, `confirmá`); `usted` para formalidad o sectores regulados. Nunca mezclar pronombre de vos con conjugación de tú.  
**Contextuales:** `dale`, `de una`, `listo`, `bárbaro`, `bueno`, `perfecto`. `bárbaro` puede ser evaluación positiva sin autorizar.  
**Operación:** `turno`; `reserva`; `alquiler`; `seña|anticipo`; `retiro|envío`; `DNI|CUIT|CUIL`; `alias|CBU|CVU`; `CFT|cuotas`. ASALE define [seña](https://www.asale.org/damer/se%C3%B1a); fuentes oficiales: [ARCA/CUIT](https://www.arca.gob.ar/inscripcion/cuit-cdi/residentes-pais-dni-argentino.asp) y [BCRA/CFT](https://www.bcra.gob.ar/prestamos-personales-comparar-costos-y-condiciones/).  
**Formato:** ARS, `+54`; móviles requieren normalización específica; provincia, partido/departamento, localidad, calle/altura, piso/departamento y CP; reconocer CABA/GBA.  
**Riesgo:** no aplicar voseo argentino globalmente; el código actual ya mezcla ese registro en guidance de otros países.

### 6.4 Chile — `es-CL`

**Tratamiento:** `tú` escrito cercano o `usted` formal; reconocer voseo verbal coloquial, no generarlo automáticamente.  
**Contextuales:** `ya`, `sí po`, `ya po`, `dale`, `bueno`, `listo`. `ya` puede ser acuerdo, tiempo o marcador discursivo; `al tiro` señala inmediatez, no consentimiento.  
**Operación:** `hora|agendar una hora|cita`; `reserva`; `arriendo`; `pie|reserva|abono`; `retiro|despacho`; `boleta|factura`; `RUN|RUT`; `CAE|CTC|UF`. Fuentes: [SII/RUT](https://www.sii.cl/contribuyentes/contribuyentes_individuales/chilenos_extranjero/rol_unico_tributario.htm) y [SERNAC/CAE](https://www.sernac.cl/portal/604/w3-propertyvalue-64453.html).  
**Formato:** CLP, `+56`; región, comuna, calle, número y departamento.  
**Riesgo:** UF no es CLP; preservar unidad, fecha y valor de referencia.

### 6.5 Perú — `es-PE`

**Tratamiento:** `usted` en atención y sectores regulados; `tú` según marca.  
**Contextuales:** `ya`, `ya pues`, `dale`, `listo`, `claro`. `ya` puede ser aceptación, comprensión, cambio de estado o cierre. Reconocer `pe/pues`, pero no añadirlo a la salida como caricatura.  
**Operación:** `cita`; `reserva`; `alquiler`; `separación|adelanto`; `recojo|retiro|delivery`; `boleta|factura`; `DNI|RUC`; `TCEA|TREA|cuotas`. Fuentes: [SUNAT/RUC](https://centrovirtual.sunat.gob.pe/tramites/inscribete-ruc) y [SBS/crédito](https://www.sbs.gob.pe/usuarios/aprende-con-la-sbs/aprende-sobre-creditos).  
**Formato:** PEN, `+51`; departamento, provincia, distrito, urbanización, avenida/jirón/calle, manzana/lote.  
**Riesgo:** reconocer `S/`, pero persistir `PEN`; no asumir que `delivery` implica integración logística.

### 6.6 Brasil — `pt-BR`

**Tratamiento:** `você` claro y cercano; `senhor/senhora` según formalidad o preferencia. Nunca mezclar portugués europeo.  
**Explícitas:** `sim`, `confirmo`, `concordo`, `aceito`, `pode confirmar`.  
**Contextuales:** `pode ser`, `combinado`, `fechado`, `tá bom`, `tudo certo`, `beleza`, `bora`. `pode ser` puede ser provisional; `tudo certo` puede describir estado; `beleza` también es saludo/evaluación.  
**Negación/corrección:** `não`, `melhor não`, `ainda não`, `cancela`, `deixa pra lá`; `na verdade`, `quis dizer`, `melhor`, `corrigindo`.  
**Operación:** `agendamento|consulta|horário`; `reserva|hóspede|diária`; `aluguel|locação`; `entrada|sinal|adiantamento`; `retirada|entrega`; `nota fiscal|NF-e`; `CPF|CNPJ|CIN`; `Pix|boleto|parcela`; `CET`. Fuentes: [lenguaje ciudadano](https://comunicacaocidada.es.gov.br/diretrizes/use-pronomes-pessoais/), [CPF](https://www.gov.br/receitafederal/pt-br/assuntos/meu-cpf/cpf), [CNPJ](https://www.gov.br/receitafederal/pt-br/servicos/cadastro/cnpj) y [Banco Central/CET](https://www.bcb.gov.br/meubc/faqs/p/cuidados-na-hora-de-contratar-uma-operacao-de-credito).  
**Formato:** BRL, `+55`; UF, município, bairro, logradouro, número, complemento, CEP. Reconocer `vc`, `vcs`, `pq`, `q`, `tá`, `tô`, `blz`, `zap`.  
**Riesgo:** no pedir CPF/CNPJ completo en texto abierto sin necesidad y base de tratamiento.

### 6.7 Uruguay — `es-UY`

**Tratamiento:** `vos` cercano; `usted` formal; reconocer también `tú` según región y usuario.  
**Contextuales:** `dale`, `ta|tá`, `bárbaro`, `de una`, `listo`. `ta` puede expresar acuerdo, comprensión, cierre o estado.  
**Operación:** `turno|cita`; `reserva`; `alquiler`; `seña`; `retiro|envío`; `cédula|RUT`; `cuotas|costo financiero`.  
**Formato:** UYU, `+598`; departamento, localidad, calle, número, apartamento y CP.  
**Riesgo:** acompañar `$` con `UYU` o `USD` cuando exista ambigüedad.

### 6.8 Paraguay — `es-PY`

**Tratamiento:** `vos` informal y `usted` formal. No generar guaraní o jopara por ubicación.  
**Contextuales:** `dale`, `ya`, `de una`, `listo`; todas requieren objeto/estado pendiente.  
**Operación:** `turno|cita`; `reserva`; `alquiler`; `seña|entrega|anticipo`; `retiro|entrega`; `cédula|RUC`; `guaraní|Gs.|PYG`. Fuente fiscal: [DNIT](https://www.dnit.gov.py/documents/20123/268757/Resoluci%C3%B3n%2BN%C2%BA%2B0468_06.pdf/b1a8d444-18a8-df75-043e-bce2581187df?t=1684192282338).  
**Formato:** PYG, `+595`; departamento, distrito/municipio, barrio/compañía, calle y referencia.  
**Riesgo:** mensaje predominantemente guaraní necesita soporte de idioma o handoff; el glosario español no basta.

### 6.9 Bolivia — `es-BO`

**Tratamiento:** `usted` como default; reconocer `tú` y voseo regional sin uniformar el país.  
**Contextuales:** `ya`, `dale`, `listo`, `de acuerdo`, `ya no más`. Esta última suele indicar inmediatez, no necesariamente aceptación.  
**Operación:** `cita|consulta`; `reserva`; `alquiler`; `anticipo|seña`; `recojo|retiro`; `factura|nota fiscal`; `CI|NIT`; `cuotas|tasa efectiva`. Fuente: [SIN/NIT](https://siatinfo.impuestos.gob.bo/index.php/requisitos-para-la-inscripcion/conceptos-generales/generacion-del-nit).  
**Formato:** BOB, `+591`; departamento, provincia, municipio, zona, vía y referencia.  
**Riesgo:** persistir `BOB` cuando se recibe `Bs`; quechua y aimara requieren soporte lingüístico independiente.

### 6.10 Ecuador — `es-EC`

**Tratamiento:** `usted` en servicio; `tú` según marca; reconocer voseo regional.  
**Contextuales:** `ya`, `de una`, `listo`, `claro`; `de una` marca inmediatez y `ya` es polisémico.  
**Operación:** `cita|turno`; `reserva`; `arriendo|alquiler`; `entrada|abono|anticipo`; `retiro|entrega`; `factura|nota de venta`; `cédula|RUC`. Fuente: [SRI/RUC](https://www.sri.gob.ec/ruc-personas-naturales).  
**Formato:** USD, `+593`; provincia, cantón, parroquia, ciudadela/urbanización, barrio, calle/intersección y manzana.  
**Riesgo:** continente y Galápagos requieren husos distintos.

### 6.11 Venezuela — `es-VE`

**Tratamiento:** `tú` cercano y `usted` formal; reconocer voseo zuliano, no nacionalizarlo.  
**Contextuales:** `dale`, `de una`, `fino`, `listo`. `fino` es evaluación positiva; no es consentimiento.  
**Operación:** `cita`; `reserva`; `alquiler`; `inicial|apartado|abono`; `retiro|delivery|entrega`; `cédula|RIF`; reconocer `pago móvil` sin inferir una integración.  
**Formato:** el catálogo de cobro actual usa USD, pero la conversación puede contener USD, VES, `Bs` o `$`; `+58`; estado, municipio, parroquia, sector y edificio/apartamento.  
**Riesgo:** nunca asumir moneda por símbolo. Fuentes fiscales y operativas requieren revisión local antes de certificar el pack.

### 6.12 Costa Rica — `es-CR`

**Tratamiento:** `usted` es el fallback más seguro; `vos` configurable; no forzar `tú`.  
**Contextuales:** `hágale`, `dele`, `listo`, `de acuerdo`, `pura vida`. `hágale` puede incitar a actuar y `pura vida` puede ser saludo, agradecimiento, evaluación o cierre; ninguno autoriza una transacción por sí solo.  
**Operación:** `cita`; `reserva`; `alquiler`; `prima|apartado|adelanto`; `retiro|entrega`; `factura electrónica`; `cédula física|cédula jurídica`; reconocer `SINPE Móvil` sin prometer integración. Fuente fiscal: [Ministerio de Hacienda](https://www.hacienda.go.cr/docs/RequisitosGeneralesYEspecificosInscripcionModifDesinsc.pdf).  
**Formato:** CRC, `+506`; provincia, cantón, distrito y señas/referencias.  
**Riesgo:** no obligar a calle/número cuando la dirección real es descriptiva.

### 6.13 Panamá — `es-PA`

**Tratamiento:** `usted` formal y `tú` cercano; reconocer voseo regional.  
**Contextuales:** `dale`, `listo`, `bueno`, `de acuerdo`.  
**Operación:** `cita`; `reserva`; `alquiler`; `abono|separación`; `retiro|entrega`; `cédula|RUC|DV`; reconocer `PH` según contexto inmobiliario. Fuente: [DGI/DV](https://dgi.mef.gob.pa/DV).  
**Formato:** USD/PAB, `+507`; provincia, distrito, corregimiento, barriada, calle y edificio/apartamento.  
**Riesgo:** conservar moneda; no convertir automáticamente `B/.` y `$` en el mismo hecho contable.

### 6.14 República Dominicana — `es-DO`

**Tratamiento:** `usted` formal y `tú` cercano.  
**Contextuales:** `ya`, `ta bien`, `dale`, `listo`, `perfecto`; normalizar `ta|tá` para comprensión, sin generarlo por defecto.  
**Operación:** `cita`; `reserva`; `alquiler`; `inicial|separación`; `retiro|recogida|delivery`; `comprobante fiscal`; `cédula|RNC|NCF|e-CF`. Fuente: [DGII/RNC](https://dgii.gov.do/cicloContribuyente/registroRNC/Paginas/default.aspx).  
**Formato:** DOP; `+1-809`, `+1-829`, `+1-849`; provincia, municipio, sector/residencial, calle y número.  
**Riesgo:** `+1` no identifica por sí solo el territorio; validar con metadatos telefónicos.

### 6.15 Guatemala — `es-GT`

**Tratamiento:** `usted` por defecto; reconocer `vos` familiar; `tú` puede funcionar como registro intermedio de marca.  
**Contextuales:** `va`, `órale`, `dale`, `listo`, `cabal`. `va` requiere contexto; `cabal` queda en confianza baja/media hasta validación con corpus.  
**Operación:** `cita`; `reserva`; `alquiler`; `enganche|anticipo|apartado`; `recoger|retiro|entrega`; `FEL`; `DPI|CUI|NIT|RTU`. Fuentes: [SAT/NIT](https://portal.sat.gob.gt/portal/rtu-digital/inscripcion-solicitud-de-nit/) y [RENAP/DPI](https://www.renap.gob.gt/servicios/que-es-el-dpi).  
**Formato:** GTQ, `+502`; departamento, municipio, zona, colonia, calle/avenida y número.  
**Riesgo:** lenguas mayas requieren detección y ruta propia, no una lista de sinónimos españoles.

## 7. Estados Unidos, Canadá y países no comercializados

### 7.1 Estados Unidos y Canadá

No deben resolverse por país solamente:

- EE. UU.: `en-US`, `es-US` y código mixto, más regulación estatal y territorios.
- Canadá: `en-CA`, `fr-CA` y otras lenguas; provincia y lengua forman parte del pack.
- dirección, moneda, impuestos, consentimiento y protección del consumidor cambian por jurisdicción;
- `+1` exige metadatos, no una comparación de prefijo simple.

Su estado inicial debe ser `draft/fallback_only`; no heredar `en-US` a Canadá ni `es-419` a todo cliente hispano de EE. UU.

### 7.2 Países reconocidos por backend pero no visibles en onboarding

| País | Tratamiento provisional | Condición |
|---|---|---|
| El Salvador | usted/vos | validar DUI/NIT, facturación y corpus local |
| Honduras | usted/vos | validar RTN/DNI y operación |
| Nicaragua | vos/usted | pack propio de voseo, moneda y fiscalidad |
| Puerto Rico | tú/usted | español-inglés, `+1` y reglas de EE. UU./territorio |
| Cuba | tú/usted | moneda, canales/pagos y restricciones comerciales |

Todos quedan `fallback_only`; un país aceptado por un DTO no equivale a mercado lingüística u operacionalmente certificado.

## 8. Formatos y estructuras transversales

### 8.1 Fechas y horas

- persistir ISO y zona IANA;
- mostrar con `Intl.DateTimeFormat(locale)`;
- confirmar con fecha textual, año, hora y zona;
- aclarar `03/04` si puede significar 3 de abril o 4 de marzo;
- resolver `mañana`, `este viernes`, `ahorita`, `agora` con `now + timezone`;
- no elegir huso solo por país.

### 8.2 Teléfonos

- persistir E.164 y conservar input original;
- usar librería de metadatos por territorio;
- no anteponer `+57` o cualquier prefijo de forma ciega;
- probar Argentina móvil, México y territorios `+1`.

Fuente normativa: [ITU-T E.164](https://www.itu.int/itu-t/recommendations/rec.aspx?lang=en&rec=4057).

### 8.3 Direcciones

```ts
type AddressEvidence = {
  structuredAddress: CountryAddress;
  rawCustomerAddress: string;
  deliveryReference?: string;
  geocodingResult?: GeocodingEvidence;
  validationStatus: "raw" | "parsed" | "verified" | "failed";
};
```

No imponer el esquema colombiano. UPU S42 define componentes y plantillas por país: [UPU Addressing Solutions](https://www.upu.int/en/Postal-Solutions/Programmes-Services/Addressing-Solutions?cid=200&csid=20).

### 8.4 Monedas y cantidades

- persistir ISO 4217;
- mostrar código cuando el símbolo es ambiguo;
- separar `operatingCurrency`, `quoteCurrency`, `settlementCurrency` y `billingCurrency`;
- conservar unidad y fecha para UF u otras unidades indexadas;
- nunca convertir `$`, `Bs`, `S/`, `Gs.` o `B/.` sin evidencia.

Referencia: [ISO 4217](https://www.iso.org/iso-4217-currency-codes.html).

## 9. Gatillos de seguridad y handoff

Los riesgos son universales; cambian sus expresiones, instituciones e identificadores.

```text
REQUEST_HUMAN
CANCEL_ACTION
RESCHEDULE
WITHDRAW_CONSENT
DELETE_DATA
CORRECT_DATA
PAYMENT_DISPUTE
FRAUD_OR_IDENTITY_THEFT
LEGAL_THREAT
MEDICAL_EMERGENCY
SELF_HARM
VIOLENCE_OR_THREAT
MINOR_OR_GUARDIAN
UNSUPPORTED_LANGUAGE
```

### 9.1 Familias mínimas de reconocimiento

- Consentimiento: `no me escriban`, `sáquenme de la lista`, `borren mis datos`, `revoco mi autorización`; PT: `não me mande mensagens`, `remova meus dados`.
- Fraude: `estafa`, `suplantación`, `cargo no reconocido`, `me clonaron`, `extorsión`; PT: `golpe`, `cartão clonado`, `Pix errado`, `cobrança não reconhecida`.
- Emergencia: `no respira`, `se desmayó`, `convulsiona`, `hemorragia`, `dolor en el pecho`; PT equivalentes.
- Autolesión: intención de morir, buscar medios, desesperanza extrema o sentirse carga; no depender de una frase exacta. Fuente: [OPS](https://iris.paho.org/bitstream/handle/10665.2/54972/9789275324639_spa.pdf).
- Menor/autoridad: `soy menor`, `mi hijo`, `acudiente`, `tutor`, `representante legal`.
- Consumidor/regulador: instituciones se resuelven por país y dominio (`SIC`, `PROFECO`, `CONDUSEF`, `SERNAC`, `INDECOPI`, etc.).

Los números de crisis no deben quedar estáticos en un prompt. Debe existir un directorio versionado por país/territorio, con fecha de verificación y fallback de emergencia. Ejemplos oficiales: [Línea 106 en Colombia](https://www.minsalud.gov.co/salud/publica/salud-mental/Paginas/linea-106.aspx) y [recursos de prevención en Brasil](https://www.gov.br/saude/pt-br/assuntos/saude-de-a-a-z/s/suicidio-prevencao/suicidio-prevencao).

## 10. Integración con subtipos, prompts, tools y menús

El pack de país no reemplaza el contrato de subtipo; se compone con él:

```text
SubtypeExperienceProfile
  + CountryLanguageBehaviorPack
  + tenant brand/address-form overrides
  + customer language/preference
  + current workflow/tool state
  = EffectiveConversationContract
```

Reglas:

1. El subtipo define objeto, intenciones, campos, tools, SoR, menú y límites.
2. El país define cómo reconocer/expresar esos conceptos, formatos, identificadores y gatillos locales.
3. El tenant elige entre términos permitidos (`cita|turno|hora`, `arriendo|alquiler|renta`) sin cambiar el tipo interno.
4. El cliente puede cambiar idioma o tratamiento; la preferencia explícita vence al default del tenant.
5. Tool args siempre usan tipos canónicos; los aliases se normalizan antes de llamar al executor.
6. Menú, prompt, notificación y detalle humano muestran el mismo término preferido, pero rutas/eventos conservan IDs canónicos.
7. Expresiones de confirmación se evalúan contra el efecto de la tool, no solo contra texto o país.
8. No se inyectan cientos de modismos al prompt; el normalizador determinista produce intención, confianza y evidencia.

## 11. Arquitectura de resolución recomendada

```text
tenant.operatingCountry
        ↓
CountryPackResolver
        ↓
idioma + país + canal + preferencia explícita del cliente
        ↓
CountryIntentNormalizer
        ↓
intent + confidence + matched evidence
        ↓
workflow determinista / aclaración / handoff
        ↓
tool authorization + confirmation + idempotency
        ↓
PromptAssembler recibe solo:
  country_pack_id/version
  address_form
  preferred_domain_terms
  safe_generation_policy
```

Prioridad de resolución:

1. preferencia explícita del cliente;
2. locale detectado con evidencia suficiente;
3. configuración del agente/canal;
4. país operativo del tenant;
5. fallback `es-419`, `pt-BR`, `en` o `fr`.

El país del tenant no prueba el dialecto del cliente.

## 12. Certificación mínima por pack

Cada pack necesita, como mínimo:

- revisión por dos hablantes nativos y una persona del dominio regulado cuando aplique;
- 50 afirmaciones, 30 negativas, 30 correcciones, 30 cancelaciones y 30 solicitudes de humano;
- 50 abreviaturas/errores reales;
- 20 fechas ambiguas, 20 horarios relativos, 20 importes, 20 direcciones y 20 teléfonos;
- 30 gatillos de seguridad y código mixto donde corresponda;
- texto, voz/ASR, canales y errores de escritura;
- pruebas cruzadas con cada familia funcional de subtipos, no solo un agente genérico;
- corpus anonimizado, consentido y con política de retención;
- fuentes y versión visibles en el release evidence.

Métricas de puerta:

| Métrica | Umbral inicial |
|---|---:|
| precisión de afirmación para dinero/consentimiento | ≥ 99,5 % |
| recall de cancelación | ≥ 99 % |
| recall de solicitud de humano | ≥ 98 % |
| recall de gatillo de seguridad | ≥ 99 % |
| exactitud de término nacional | ≥ 95 % |
| acciones irreversibles con alias de confianza media sin aclaración | 0 |

## 13. Advertencias metodológicas

El Diccionario de americanismos es una fuente académica descriptiva; no prueba frecuencia contemporánea ni convierte una fórmula en consentimiento comercial. La propia ASALE explica el alcance de la obra: [Diccionario de americanismos](https://www.asale.org/obras-academicas/diccionarios/diccionario-de-americanismos?s=04).

Por eso, toda expresión queda como candidata hasta combinar:

1. fuente académica/oficial;
2. hablantes nativos;
3. corpus conversacional anonimizado y consentido;
4. evaluación por subtipo, efecto de tool y canal;
5. revisión periódica y versionado.

## 14. Dependencia obligatoria del plan de implementación

No se debe implementar la nueva capa de prompts o writers transaccionales sin completar en este orden:

1. separar identidad operativa, fiscal y lingüística;
2. crear schema/registry versionado de country packs;
3. unificar normalización y confirmación de todos los workflows;
4. integrar el pack con `SubtypeExperienceProfile` y `ToolEffect`;
5. construir eval harness por país/subtipo;
6. pilotear packs; solo después cambiar `status` a `certified`.

Este documento es normativo para el futuro backlog: cualquier tarea de prompts, herramientas, menús, formatos, pagos, direcciones o seguridad debe enlazar el `countryPackId/version` que utiliza y la evidencia que permite certificarlo.
