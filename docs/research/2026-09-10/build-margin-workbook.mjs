import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { Workbook, SpreadsheetFile, FileBlob } from '@oai/artifact-tool';

// Rebuild with the bundled Node runtime and node_modules junction described in the research handoff.
const out = path.dirname(fileURLToPath(import.meta.url));
const support = path.join(out, '.tmp-margin');
await fs.mkdir(support, { recursive: true });
const inputs = JSON.parse(await fs.readFile(path.join(out, 'plan-economics-inputs.json'), 'utf8'));
const cards = JSON.parse(await fs.readFile(path.join(out, 'meta-ratecards-2026.json'), 'utf8'));
const october = cards.cards.filter(c => c.kind === 'rates' && c.effective_from === '2026-10-01');
const tariffRows = october.flatMap(card => card.rates.map(r => [r.market + '|' + card.currency, r.market, card.currency,
  ...['service', 'utility', 'marketing', 'authentication', 'authentication_international'].map(k => r[k] == null || r[k] === 'n/a' ? 'n.a.' : Number(r[k])), card.currency + ' OCT26']));
if (tariffRows.length !== 94 || new Set(tariffRows.map(r => r[0])).size !== 94) throw new Error('Tariff cardinality or duplicate key');
const wb = Workbook.create();
const main = wb.worksheets.add('Margen planes');
const ass = wb.worksheets.add('Supuestos');
const rates = wb.worksheets.add('Tarifas Meta');
const plans = wb.worksheets.add('Planes fuente');
const sheets = [main, ass, rates, plans];
const c = { navy: '#19344C', blue: '#205CBC', green: '#16835A', pale: '#EFF4F8', amber: '#FFF0BE', red: '#A32D2D', grey: '#66788A' };
const num = '#,##0;(#,##0);"–"';
const money = '#,##0.00;(#,##0.00);"–"';
const pct = '0.0%;(0.0%);"–"';
function v(sh, cell, value) { sh.getRange(cell).values = [[value]]; }
function f(sh, cell, formula) { sh.getRange(cell).formulas = [[formula]]; sh.getRange(cell).format.font.color = formula.includes('!') ? c.green : '#15232E'; }
function base(sh, range) {
  sh.showGridLines = false;
  sh.getRange(range).format.font = { name: 'Arial', size: 10, color: '#15232E' };
  sh.getRange(range).format.rowHeight = 23;
  sh.getRange(range).format.verticalAlignment = 'center';
}
function title(sh, text, lastCol) {
  v(sh, 'A2', text); sh.getRange('A2').format.font = { name: 'Arial', size: 16, bold: true, color: c.navy };
  sh.getRange(`A3:${lastCol}3`).format.borders = { bottom: { style: 'thin', color: c.navy } };
}
function band(sh, row, text, lastCol = 'F') {
  v(sh, `A${row}`, text); sh.getRange(`A${row}:${lastCol}${row}`).format.fill = c.navy;
  sh.getRange(`A${row}:${lastCol}${row}`).format.font = { color: '#FFFFFF', bold: true };
  sh.getRange(`A${row}:${lastCol}${row}`).format.rowHeight = 25;
}
function header(sh, range) { sh.getRange(range).format.fill = c.navy; sh.getRange(range).format.font = { bold: true, color: '#FFFFFF' }; sh.getRange(range).format.horizontalAlignment = 'center'; }
function input(sh, range) { sh.getRange(range).format.fill = c.amber; sh.getRange(range).format.font.color = c.blue; }
function list(sh, cell, values) { sh.getRange(cell).dataValidation = { rule: { type: 'list', values } }; }
base(main, 'A1:F57'); base(ass, 'A1:F39'); base(rates, 'A1:J115'); base(plans, 'A1:F25');
main.tabColor = c.navy; ass.tabColor = '#50748E';
for (const sh of [main, plans]) { sh.getRange('A1:A58').format.columnWidth = 48; sh.getRange('B1:F58').format.columnWidth = 20; }
title(main, 'Parallly: margen por plan', 'F'); title(ass, 'Supuestos editables', 'F'); title(rates, 'Tarifas Meta desde octubre de 2026', 'I'); title(plans, 'Planes de fábrica en el repositorio', 'F');
v(main, 'A4', 'Resultado mensual. Cambiar controles en Supuestos.');
main.getRange('A4').format.font = { italic: true, color: c.grey };
main.getRange('B5:F5').values = [['Emprendedor', 'Starter', 'Pro', 'Enterprise', 'Custom']]; header(main, 'A5:F5');
v(main, 'A3', 'Moneda / ciclo'); f(main, 'B3', "='Supuestos'!B5"); f(main, 'C3', "='Supuestos'!B6");
v(main, 'D3', 'WABA'); f(main, 'E3', "='Supuestos'!B7"); f(main, 'F3', "='Supuestos'!B8");

ass.getRange('A1:A40').format.columnWidth = 42; ass.getRange('B1:B40').format.columnWidth = 22;
ass.getRange('C1:C40').format.columnWidth = 20; ass.getRange('D1:F40').format.columnWidth = 29;
ass.getRange('A4:B4').values = [['Control', 'Valor activo']]; header(ass, 'A4:B4');
const drivers = [
  [5, 'Moneda de resultado / precio SaaS', 'COP', 'USD es referencia de catálogo; no prueba un rail de cobro activo.'],
  [6, 'Ciclo contractual', 'Mensual', 'Anual usa cargo COP / 12. USD anual no tiene precio fuente.'],
  [7, 'País del destinatario', 'Colombia', 'Un mercado. Mezcla: usar orden real o rango; no duplicar cuota por país.'],
  [8, 'Moneda real de la WABA', 'COP', 'Se usa la tarjeta oficial de esa moneda, nunca COP inferido por FX.'],
  [9, 'FX de escenario: COP por USD', 4000, 'Hipótesis editable; no es una TRM observada.'],
  [10, 'IVA incluido en precio SaaS', 0, 'Hipótesis 0 %. No constituye un dictamen fiscal.'],
  [11, 'Comisión variable de cobro', 0.04, 'Hipótesis 4 % sobre precio bruto. No es contrato Wompi.'],
  [12, 'Cargo fijo de cobro (COP/operación)', 800, 'Hipótesis COP 800. Anual: un cobro, dividido en 12 meses.'],
  [13, 'Margen objetivo', 0.70, 'Política propuesta, no margen actual demostrado.'],
  [14, 'Consumo de la cuota IA', 1, 'Escenario 100 %. Editable entre 0 y 100 %.'],
  [15, 'Costo variable por turno IA (USD)', 0.002, 'Incluye sus iteraciones IA; reemplazar con uso real conciliado.'],
  [16, 'Parallly absorbe Meta: 0 no / 1 sí', 0, 'Con 0 el tenant paga Meta directo; no hay ingreso por reventa.'],
  [17, 'Números usados en este escenario', 1, 'Modelo de un número. No multiplica beneficios por números del plan.'],
  [18, 'Mensajes de servicio por turno IA', 1.3, 'Supuesto. Un turno IA puede emitir varias entregas.'],
  [19, 'Servicio humano / extra por mes', 600, 'Supuesto de entregas adicionales que consumen el mismo beneficio.'],
  [20, 'Plantillas utility entregadas / mes', 200, 'Sin beneficio gratuito en este escenario de octubre. Tarifa base.'],
  [21, 'Plantillas marketing / mes', 0, 'Hipótesis editable. Tarifa base, sin descuentos por volumen.'],
  [22, 'Plantillas authentication / mes', 0, 'Usa authentication doméstica, no internacional.'],
  [23, 'Servicio gratis por número / mes', 1000, 'Regla Meta investigada. Una sola cuota para servicio, no utility.'],
];
for (const [r, label, val, note] of drivers) { v(ass, `A${r}`, label); v(ass, `B${r}`, val); v(ass, `D${r}`, note); }
ass.getRange('D5:D23').format.font.color = c.grey;
ass.getRange('D5:D23').format.wrapText = false;
input(ass, 'B5:B22'); ass.getRange('B23').format.font.color = '#15232E';
ass.getRange('B10:B11').setNumberFormat(pct); ass.getRange('B13:B14').setNumberFormat(pct); ass.getRange('B15').setNumberFormat('0.0000'); ass.getRange('B18').setNumberFormat('0.00');
list(ass, 'B5', ['COP', 'USD']); list(ass, 'B6', ['Mensual', 'Anual']); list(ass, 'B8', ['COP', 'USD']);
list(ass, 'B7', october[0].rates.map(r => r.market)); list(ass, 'B16', ['0', '1']);
ass.getRange('B17').dataValidation = { rule: { type: 'whole', operator: 'equal', formula1: 1 } };
for (const cell of ['B10','B11','B13','B14']) ass.getRange(cell).dataValidation = { rule: { type: 'decimal', operator: 'between', formula1: 0, formula2: cell === 'B13' ? 0.99 : 1 } };
band(ass, 25, 'Costos restantes por mes (USD)');
ass.getRange('B26:F26').values = [['Emprendedor','Starter','Pro','Enterprise','Custom']]; header(ass,'A26:F26');
v(ass,'A27','No LLM, agrupados (hipótesis)'); ass.getRange('B27:F27').values = [[4,8,20,50,null]]; input(ass,'B27:F27');
v(ass,'A28','Incluye soporte, infra, media, RAG, fiscal y reservas. Reemplazar con medición.');
band(ass,30,'Cotización Custom pendiente');
const customInputs = [[31,'Precio COP mensual',null],[32,'Precio COP anual total',null],[33,'Referencia USD mensual',null],[34,'Cuota IA mensual',null]];
for(const [r,label,val] of customInputs){v(ass,`A${r}`,label);v(ass,`B${r}`,val);input(ass,`B${r}`);}
v(ass,'A36','Azul sobre amarillo = editable. Custom requiere precio, cuota y costo restante.');
v(ass,'A37','Tarifas excluyen impuestos, FX bancario y descuentos de volumen. No hay FEP supuesto.');
v(ass,'A38','Fuente beneficio: developers.facebook.com/documentation/business-messaging/whatsapp/pricing');
v(ass,'A39','Usage IA: categorías disjuntas; no sumar reasoning otra vez si ya está incluido en output.');

plans.getRange('B5:F5').values = [['Emprendedor','Starter','Pro','Enterprise','Custom']]; header(plans,'A5:F5');
v(plans,'A4','Datos de seed; billing_plans runtime y overrides no consultados.');
const planMetrics = [
 [6,'Referencia USD mensual',p=>p.slug==='custom'?null:p.priceUsdCents/100],
 [7,'COP mensual',p=>p.priceLocalOverrides?.CO?.amountCents/100||null],
 [8,'COP anual total',p=>p.priceLocalOverrides?.CO?.annual?.amountCents/100||null],
 [9,'Cuota IA mensual',p=>p.slug==='custom'?null:p.maxAiMessages],
 [10,'Agentes (seed)',p=>p.maxAgents],
 [11,'Máximo conexiones WhatsApp (seed)',p=>p.features.maxChannelAccounts.whatsapp],
 [12,'Umbral blando LLM (USD/mes)',p=>p.features.llmCostBudgetUsdCents===-1?'sin umbral':p.features.llmCostBudgetUsdCents/100],
 [13,'Presupuesto multimedia (USD/día)',p=>p.features.mediaProcessing.dailyBudgetCentsUsd/100],
 [14,'Crédito WhatsApp seed sin consumidor',p=>p.features.whatsappCreditUsdCents/100],
];
for(const [row,label,fn]of planMetrics){v(plans,`A${row}`,label);plans.getRange(`B${row}:F${row}`).values=[inputs.seedPlans.map(fn)];}
plans.getRange('B6:F14').setNumberFormat(money);
plans.getRange('B6:F14').format.horizontalAlignment='right';
plans.getRange('B9:F11').setNumberFormat(num);
v(plans,'A17','-1 significa ilimitado en seed; no es compromiso de consumo gratuito.');
v(plans,'A18','Fuente: apps/api/prisma/seed-billing-plans.js, líneas 41, 148, 249, 349, 449, 549.');
v(plans,'A19','El anual COP equivale al 85 % de 12 mensualidades. Custom se cotiza aparte.');
v(plans,'A20','Cobro SaaS, cuenta Meta y cobros del negocio a sus clientes son circuitos distintos.');

rates.getRange('A1:A115').format.columnWidth = 29; rates.getRange('B1:B115').format.columnWidth = 24; rates.getRange('C1:C115').format.columnWidth = 9;
rates.getRange('D1:H115').format.columnWidth = 16; rates.getRange('I1:I115').format.columnWidth = 17;
v(rates,'A3','47 mercados, dos monedas oficiales. n.a. indica tarifa no disponible.');
rates.getRange('A5:I5').values=[['Clave mercado-moneda','Mercado','Moneda','Service','Utility','Marketing','Authentication','Auth. internacional','Fuente']];header(rates,'A5:I5');
rates.getRange('A6:I99').values=tariffRows; rates.getRange('D6:H99').setNumberFormat('0.0000'); rates.freezePanes.freezeRows(5);
rates.getRange('D6:H99').format.horizontalAlignment='right';
rates.getRange('A48:B48').format.wrapText=true;rates.getRange('A95:B95').format.wrapText=true;
rates.getRange('A48:I48').format.rowHeight=36;rates.getRange('A95:I95').format.rowHeight=36;
v(rates,'A102','Fuente principal');v(rates,'B102',cards.source_page);
v(rates,'A103','Consulta');v(rates,'B103','2026-09-10');
october.forEach((card,i)=>{v(rates,`A${105+i*3}`,card.currency+' OCT26');v(rates,`B${105+i*3}`,card.source_file);v(rates,`B${106+i*3}`,card.source_url);v(rates,`B${107+i*3}`,'SHA256: '+card.sha256);});
v(rates,'A113','Fuente local: meta-ratecards-2026.json. Tarifa oficial COP independiente del FX del modelo.');
v(rates,'A114','Utility/auth usan precio base, sin escalas de volumen; auth internacional se conserva como fuente.');

// Selected tariffs are resolved once in the control area and used by the single build.
band(ass,40,'Tarifas activas en moneda WABA');
for(const [r,label,col]of [[41,'Servicio',4],[42,'Utility',5],[43,'Marketing',6],[44,'Authentication',7]]){
 const letter=String.fromCharCode(64+col);
 v(ass,`A${r}`,label);f(ass,`B${r}`,`=IF(COUNTIFS('Tarifas Meta'!$B$6:$B$99,$B$7,'Tarifas Meta'!$C$6:$C$99,$B$8)<>1,"Falta tarifa",SUMIFS('Tarifas Meta'!$${letter}$6:$${letter}$99,'Tarifas Meta'!$B$6:$B$99,$B$7,'Tarifas Meta'!$C$6:$C$99,$B$8))`);ass.getRange(`B${r}`).setNumberFormat('0.0000');
}
ass.getRange('A40:F45').format.font.name='Arial';ass.getRange('A40:F45').format.rowHeight=23;

const labels={6:'Precio bruto mensual normalizado',7:'Ingreso neto SaaS / mes',8:'Contribución SaaS antes de Meta',9:'Margen SaaS antes de Meta',10:'Meta asumido por Parallly',11:'Contribución después de Meta',12:'Margen después de Meta',13:'Costo mensual total para tenant',14:'Estado frente al objetivo',17:'Cuota IA del plan / mes',18:'Consumo de cuota seleccionado',19:'Turnos IA consumidos / mes',20:'Costo variable IA',21:'Otros costos mensuales',22:'Comisión variable de cobro',23:'Cargo fijo de cobro normalizado',24:'Total costos SaaS',28:'Servicio entregado: IA + humano',29:'Servicio gratuito aplicado',30:'Servicio sujeto a cobro',31:'Utility entregadas',32:'Marketing entregadas',33:'Authentication entregadas',34:'Costo service en moneda WABA',35:'Costo utility en moneda WABA',36:'Costo marketing en moneda WABA',37:'Costo authentication en moneda WABA',38:'Total Meta en moneda WABA',39:'Conversión WABA a moneda resultado',40:'Total Meta en moneda resultado',43:'Margen objetivo',44:'Costo total disponible al objetivo',45:'Precio mínimo bruto mensual al objetivo',46:'Presupuesto para IA tras costos fijos',47:'Turnos antes de agotar servicio gratis',48:'Costo por turno tras servicio gratis',49:'Cuota IA sostenible al objetivo',50:'Cuota sostenible / cuota del plan',52:'Meses incluidos en el cargo',53:'Costo IA por turno (moneda resultado)',54:'Costo service (moneda resultado)',55:'Meta fijo adicional asumido',56:'Precio y costo completos'};
for(const [row,label]of Object.entries(labels))v(main,`A${row}`,label);
band(main,16,'Actividad y costos SaaS');band(main,27,'Entregas y factura de Meta');band(main,42,'Precio y cuota al margen objetivo');band(main,51,'Factores del cálculo');
for(const [i,col]of ['B','C','D','E','F'].entries()){
 const custom=i===4;
 const priceCOP=custom?"'Supuestos'!$B$31":`'Planes fuente'!${col}7`;
 const annualCOP=custom?"'Supuestos'!$B$32":`'Planes fuente'!${col}8`;
 const priceUSD=custom?"'Supuestos'!$B$33":`'Planes fuente'!${col}6`;
 const q=custom?"'Supuestos'!$B$34":`'Planes fuente'!${col}9`;
 const formula={
 6:`=IF('Supuestos'!$B$5="COP",IF('Supuestos'!$B$6="Anual",IF(ISNUMBER(${annualCOP}),${annualCOP}/12,"n.a."),IF(ISNUMBER(${priceCOP}),${priceCOP},"n.a.")),IF('Supuestos'!$B$6="Anual","n.a.",IF(ISNUMBER(${priceUSD}),${priceUSD},"n.a.")))`,
 7:`=IF(ISNUMBER(${col}6),${col}6/(1+'Supuestos'!$B$10),"n.a.")`,
 8:`=IF(${col}56="Sí",${col}7-${col}24,"n.a.")`,
 9:`=IF(${col}56="Sí",IF(${col}7=0,"n.a.",${col}8/${col}7),"n.a.")`,
10:`=IF(ISNUMBER(${col}40),${col}40*'Supuestos'!$B$16,"n.a.")`,
11:`=IF(${col}56="Sí",${col}8-${col}10,"n.a.")`,
12:`=IF(${col}56="Sí",IF(${col}7=0,"n.a.",${col}11/${col}7),"n.a.")`,
13:`=IF(${col}56="Sí",${col}6+${col}40*(1-'Supuestos'!$B$16),"n.a.")`,
14:`=IF(${col}56<>"Sí","Falta cotización",IF(${col}7=0,"Sin ingreso",IF(${col}12>=${col}43,"Cumple escenario","Revisar cuota/precio")))`,
17:`=IF(ISNUMBER(${q}),${q},"n.a.")`,18:`='Supuestos'!$B$14`,19:`=IF(ISNUMBER(${col}17),ROUNDDOWN(${col}17*${col}18,0),"n.a.")`,
20:`=IF(ISNUMBER(${col}19),${col}19*${col}53,"n.a.")`,
21:`=IF(ISNUMBER('Supuestos'!${col}27),'Supuestos'!${col}27*IF('Supuestos'!$B$5="COP",'Supuestos'!$B$9,1),"n.a.")`,
22:`=IF(ISNUMBER(${col}6),${col}6*'Supuestos'!$B$11,"n.a.")`,
23:`='Supuestos'!$B$12/IF('Supuestos'!$B$5="COP",1,'Supuestos'!$B$9)/${col}52`,
24:`=IF(${col}56="Sí",SUM(${col}20:${col}23),"n.a.")`,
28:`=IF(ISNUMBER(${col}19),ROUNDUP(${col}19*'Supuestos'!$B$18+'Supuestos'!$B$19,0),"n.a.")`,
29:`=IF(ISNUMBER(${col}28),MIN(${col}28,'Supuestos'!$B$23),"n.a.")`,30:`=IF(ISNUMBER(${col}28),MAX(0,${col}28-${col}29),"n.a.")`,
31:`='Supuestos'!$B$20`,32:`='Supuestos'!$B$21`,33:`='Supuestos'!$B$22`,
34:`=IF(ISNUMBER(${col}30),${col}30*'Supuestos'!$B$41,"n.a.")`,35:`=${col}31*'Supuestos'!$B$42`,36:`=${col}32*'Supuestos'!$B$43`,37:`=${col}33*'Supuestos'!$B$44`,
38:`=IF(ISNUMBER(${col}34),SUM(${col}34:${col}37),"n.a.")`,
39:`=IF('Supuestos'!$B$5='Supuestos'!$B$8,1,IF('Supuestos'!$B$8="USD",'Supuestos'!$B$9,1/'Supuestos'!$B$9))`,
40:`=IF(ISNUMBER(${col}38),${col}38*${col}39,"n.a.")`,43:`='Supuestos'!$B$13`,
44:`=IF(ISNUMBER(${col}7),${col}7*(1-${col}43),"n.a.")`,
45:`=IF(${col}56<>"Sí","n.a.",IF((1-${col}43)/(1+'Supuestos'!$B$10)<='Supuestos'!$B$11,"n.a.",SUM(${col}20:${col}21,${col}23,${col}10)/((1-${col}43)/(1+'Supuestos'!$B$10)-'Supuestos'!$B$11)))`,
46:`=IF(${col}56="Sí",${col}44-SUM(${col}21:${col}23,${col}55),"n.a.")`,
47:`=IF('Supuestos'!$B$18>0,MAX(0,'Supuestos'!$B$23-'Supuestos'!$B$19)/'Supuestos'!$B$18,0)`,
48:`=${col}53+'Supuestos'!$B$16*'Supuestos'!$B$18*${col}54`,
49:`=IF(${col}56<>"Sí","n.a.",IF(${col}46<=0,0,IF(${col}53<=0,"n.a.",IF(${col}46<=${col}53*${col}47,ROUNDDOWN(${col}46/${col}53,0),ROUNDDOWN(MAX(${col}47,${col}47+(${col}46-${col}53*${col}47-IF('Supuestos'!$B$18>0,'Supuestos'!$B$16*${col}54,0))/${col}48),0)))))`,
50:`=IF(${col}56<>"Sí","n.a.",IF(${col}17=0,"n.a.",${col}49/${col}17))`,
52:`=IF('Supuestos'!$B$6="Anual",12,1)`,53:`='Supuestos'!$B$15*IF('Supuestos'!$B$5="COP",'Supuestos'!$B$9,1)`,54:`='Supuestos'!$B$41*${col}39`,
55:`='Supuestos'!$B$16*(SUM(${col}35:${col}37)*${col}39+MAX(0,'Supuestos'!$B$19-'Supuestos'!$B$23)*${col}54)`,
56:`=IF(AND(ISNUMBER(${col}6),ISNUMBER(${col}17),ISNUMBER(${col}21),ISNUMBER(${col}53),ISNUMBER(${col}54),'Supuestos'!$B$17=1),"Sí","No")`,
 };
 // Parentheses around AND include the one-number model condition.
 formula[56]=`=IF(AND(ISNUMBER(${col}6),ISNUMBER(${col}17),ISNUMBER(${col}21),ISNUMBER(${col}53),ISNUMBER(${col}54),'Supuestos'!$B$17=1),"Sí","No")`;
 for(const[row,expr]of Object.entries(formula))f(main,`${col}${row}`,expr);
}
main.getRange('B6:F56').setNumberFormat(money);main.getRange('B6:F56').format.horizontalAlignment='right';
for(const r of [9,12,18,43,50]){main.getRange(`B${r}:F${r}`).setNumberFormat(pct);main.getRange(`A${r}:F${r}`).format.font.italic=true;}
for(const r of [17,19,28,29,30,31,32,33,49,52])main.getRange(`B${r}:F${r}`).setNumberFormat(num);
for(const r of [39,48,53,54])main.getRange(`B${r}:F${r}`).setNumberFormat('0.0000');
main.getRange('B6:F14').format.font.color='#15232E';
for(const r of [7,8,11,13,24,38,40,45,49]){main.getRange(`A${r}:F${r}`).format.borders={top:{style:'thin',color:'#C3CED6'}};main.getRange(`A${r}:F${r}`).format.font.bold=true;}
main.getRange('A11:F12').format.fill=c.pale;
main.getRange('B12:F12').conditionalFormats.add('cellIs',{operator:'lessThan',formula:"'Supuestos'!$B$13",format:{fill:'#FCE7E7',font:{color:c.red,bold:true}}});
main.getRange('B14:F14').format.wrapText=true;main.getRange('A14:F14').format.rowHeight=36;
main.freezePanes.freezeRows(5); main.freezePanes.freezeColumns(1);
v(main,'A49','Cuota IA conservadora al objetivo');
v(main,'A57','Al absorber Meta se reserva un mensaje adicional para redondeo.');

// Independent JS arithmetic: no formula-derived expected values.
function expected(p, cfg={}){
 const a={currency:'COP',cycle:'Mensual',market:'Colombia',waba:'COP',fx:4000,vat:0,fee:.04,fixed:800,g:.7,use:1,ct:.002,absorb:0,ratio:1.3,human:600,utility:200,marketing:0,auth:0,...cfg};
 if(p.slug==='custom'||(a.currency==='USD'&&a.cycle==='Anual'))return null;
 const gross=a.currency==='USD'?p.priceUsdCents/100:a.cycle==='Anual'?p.priceLocalOverrides.CO.annual.amountCents/1200:p.priceLocalOverrides.CO.amountCents/100;
 const nr=gross/(1+a.vat),n=Math.floor(p.maxAiMessages*a.use),scale=a.currency==='COP'?a.fx:1;
 const other=[4,8,20,50][inputs.seedPlans.indexOf(p)]*scale, llm=n*a.ct*scale, fee=gross*a.fee+a.fixed/(a.currency==='COP'?1:a.fx)/(a.cycle==='Anual'?12:1);
 const rr=october.find(c=>c.currency===a.waba).rates.find(r=>r.market===a.market);
 const paid=Math.max(0,Math.ceil(n*a.ratio+a.human)-1000),metaNative=paid*Number(rr.service)+a.utility*Number(rr.utility)+a.marketing*Number(rr.marketing)+a.auth*Number(rr.authentication);
 const conv=a.currency===a.waba?1:a.waba==='USD'?a.fx:1/a.fx,meta=metaNative*conv;
 const minimumPrice=(llm+other+(fee-gross*a.fee)+meta*a.absorb)/((1-a.g)/(1+a.vat)-a.fee);
 const costAt=turns=>turns*a.ct*scale+other+fee+a.absorb*(Math.max(0,Math.ceil(turns*a.ratio+a.human)-1000)*Number(rr.service)+a.utility*Number(rr.utility)+a.marketing*Number(rr.marketing)+a.auth*Number(rr.authentication))*conv;
 let lo=0,hi=10000000;while(lo<hi){const mid=Math.ceil((lo+hi)/2);if(costAt(mid)<=nr*(1-a.g)+1e-8)lo=mid;else hi=mid-1;}
 return{gross,net:nr,turns:n,llm,other,fee,meta,servicePaid:paid,marginPre:(nr-llm-other-fee)/nr,marginAfter:(nr-llm-other-fee-meta*a.absorb)/nr,totalTenant:gross+meta*(1-a.absorb),minimumPrice,sustainableQuota:lo};
}
wb.recalculate();
function cell(sh,addr){return sh.getRange(addr).values[0][0];}
function near(actual,expect,label){if(typeof actual!=='number'||Math.abs(actual-expect)>1e-6){console.log(JSON.stringify({label,active:ass.getRange('B5:B9').values,tariff:ass.getRange('B41:B44').values}));throw new Error(`${label}: ${JSON.stringify(actual)} != ${expect}`);}}
const checks=[];
for(const [i,col]of ['B','C','D','E'].entries()){
 const e=expected(inputs.seedPlans[i]);for(const[row,key]of [[6,'gross'],[7,'net'],[9,'marginPre'],[12,'marginAfter'],[13,'totalTenant'],[30,'servicePaid'],[40,'meta'],[45,'minimumPrice'],[49,'sustainableQuota']])near(cell(main,`${col}${row}`),e[key],`base ${col}${row}`);
 checks.push({case:'base',plan:inputs.seedPlans[i].slug,expected:e});
}
if(cell(main,'F14')!=='Falta cotización'||cell(main,'F12')!=='n.a.')throw new Error('Custom missing must remain unavailable');
const scenarios=[
 ['pais-peru',{B7:'Peru'},{market:'Peru'}],
 ['absorbe-meta',{B16:1},{absorb:1}],
 ['anual',{B6:'Anual'},{cycle:'Anual'}],
 ['ia-cara',{B15:.008},{ct:.008}],
 ['waba-usd',{B8:'USD'},{waba:'USD'}],
 ['precio-usd',{B5:'USD'},{currency:'USD'}],
 ['iva-incluido',{B10:.19},{vat:.19}],
];
for(const[name,edits,conf]of scenarios){
 const restore=Object.keys(edits).map(k=>[k,cell(ass,k)]);for(const[k,x]of Object.entries(edits))v(ass,k,x);wb.recalculate();
 for(const[i,col]of ['B','C','D','E'].entries()){const e=expected(inputs.seedPlans[i],conf);near(cell(main,`${col}12`),e.marginAfter,`${name} ${col}12`);near(cell(main,`${col}40`),e.meta,`${name} ${col}40`);near(cell(main,`${col}45`),e.minimumPrice,`${name} ${col}45`);const actual=cell(main,`${col}49`);if(conf.absorb===1){if(actual>e.sustainableQuota||e.sustainableQuota-actual>1)throw new Error('Conservative quota range');}else near(actual,e.sustainableQuota,`${name} ${col}49`);}
 checks.push({case:name,marginAfter:cell(main,'B12'),meta:cell(main,'B40')});for(const[k,x]of restore)v(ass,k,x);wb.recalculate();
}
// Every selectable market under absorption must keep the integer delivery boundary.
v(ass,'B16',1);
for(const market of october[0].rates.map(r=>r.market)){
 v(ass,'B7',market);wb.recalculate();
 for(const[i,col]of ['B','C','D','E'].entries()){const e=expected(inputs.seedPlans[i],{market,absorb:1}),actual=cell(main,`${col}49`);if(typeof actual!=='number'||actual>e.sustainableQuota||e.sustainableQuota-actual>1)throw new Error(`Conservative quota all-market ${market} ${col}49: ${actual} max ${e.sustainableQuota}`);}
}
v(ass,'B7','Colombia');v(ass,'B16',0);wb.recalculate();checks.push({case:'47-markets-absorbed-quota-integer',passed:true});
// Boundary on one number: service 999, 1000 and 1001. Remove extra human usage and use one bubble per turn.
const orig=[['B14',cell(ass,'B14')],['B18',cell(ass,'B18')],['B19',cell(ass,'B19')]];
for(const[n,paid]of [[999,0],[1000,0],[1001,1]]){v(ass,'B14',n/5000);v(ass,'B18',1);v(ass,'B19',0);wb.recalculate();near(cell(main,'C30'),paid,`service threshold ${n}`);checks.push({case:`service-${n}`,paid:cell(main,'C30')});}
for(const[k,x]of orig)v(ass,k,x);
// Explicit zero is distinct from absent Custom quote.
v(ass,'B31',0);v(ass,'B34',0);v(ass,'F27',0);wb.recalculate();
if(cell(main,'F14')!=='Sin ingreso'||cell(main,'F6')!==0)throw new Error('Zero Custom quote should show Sin ingreso, not missing');
v(ass,'B31',null);v(ass,'B34',null);v(ass,'F27',null);wb.recalculate();
checks.push({case:'custom-blank-vs-zero',passed:true});
const inspection=await wb.inspect({kind:'table',range:"'Margen planes'!A5:F14",include:'values,formulas',tableMaxRows:10,tableMaxCols:6,maxChars:8000});
const errors=await wb.inspect({kind:'match',searchTerm:'#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!|#SPILL!|#CALC!',options:{useRegex:true,maxResults:100},summary:'formula error scan'});
await fs.writeFile(path.join(support,'inspection.ndjson'),inspection.ndjson+'\n'+errors.ndjson);
if(/"value"\s*:\s*"#/.test(errors.ndjson))throw new Error('Formula errors found');
for(const[sh,range,name]of [[main,'A1:F25','margen'],[main,'A27:F57','detalle'],[ass,'A1:F44','supuestos'],[rates,'A1:I51','tarifas-1'],[rates,'A52:I114','tarifas-2'],[plans,'A1:F21','planes']]){
 const png=await wb.render({sheetName:sh.name,range,scale:1.4,format:'png'});await fs.writeFile(path.join(support,`${name}.png`),new Uint8Array(await png.arrayBuffer()));
}
wb.recalculate();
const finalPath=path.join(out,'modelo-rentabilidad-planes-whatsapp.xlsx');
await(await SpreadsheetFile.exportXlsx(wb)).save(finalPath);
const reloaded=await SpreadsheetFile.importXlsx(await FileBlob.load(finalPath));reloaded.recalculate();
const reMain=reloaded.worksheets.getItem('Margen planes');
for(const[i,col]of ['B','C','D','E'].entries())near(cell(reMain,`${col}12`),expected(inputs.seedPlans[i]).marginAfter,`reimport ${col}12`);
const python=path.join(process.env.USERPROFILE,'.cache/codex-runtimes/codex-primary-runtime/dependencies/python/python.exe');
const cacheScript=`import zipfile,xml.etree.ElementTree as E,json,sys
ns={'m':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
z=zipfile.ZipFile(sys.argv[1]); missing=[]; errors=[]; count=0
for name in z.namelist():
 if name.startswith('xl/worksheets/sheet') and name.endswith('.xml'):
  for c in E.fromstring(z.read(name)).findall('.//m:c',ns):
   if c.find('m:f',ns) is not None:
    count+=1
    if c.find('m:v',ns) is None: missing.append([name,c.get('r')])
   if c.get('t')=='e': errors.append([name,c.get('r')])
print(json.dumps({'formulaCells':count,'missingCache':missing,'errorCells':errors}))
assert not missing and not errors`;
const cacheAudit=JSON.parse(execFileSync(python,['-c',cacheScript,finalPath],{encoding:'utf8'}));
const output={file:finalPath,checks,errors:errors.ndjson,base:inputs.seedPlans.slice(0,4).map(p=>({plan:p.slug,...expected(p)})),reimportValidated:true,cacheAudit,renderedSheets:4,renderedRanges:6,limitations:['Costs and FX are editable hypotheses, not actuals.','No native Excel application execution; Artifact Tool recalculation and exported/reimported workbook checked.','One number; one destination market; no FEP, volume tiers or Meta tax modeled.','USD annual unavailable because source does not define a contract.','When Meta is absorbed, sustainable quota conservatively reserves at most one extra service message for delivery rounding.']};
await fs.writeFile(path.join(out,'margin-workbook-verification.json'),JSON.stringify(output,null,2)+'\n');
console.log(JSON.stringify({saved:finalPath,checks:checks.length,base:output.base,previews:support},null,2));
