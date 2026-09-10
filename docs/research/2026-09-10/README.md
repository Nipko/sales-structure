# Investigación Meta/WhatsApp — 10 de septiembre de 2026

Entrada principal: [impacto, rentabilidad y plan](meta-whatsapp-impacto-rentabilidad-plan.md).

El paquete contiene cuatro auditorías temáticas, el informe ejecutivo, tarifas oficiales originales/normalizadas, un modelo de margen y la [adenda para Claude](../../handoffs/2026-09-10/claude-meta-whatsapp-adaptation.md). El código de producto no fue modificado por esta investigación.

## Usar la calculadora

Abrir [modelo-rentabilidad-planes-whatsapp.xlsx](modelo-rentabilidad-planes-whatsapp.xlsx). En **Supuestos**, editar celdas azules sobre amarillo: país destinatario, moneda del precio y de Meta, ciclo, costos, uso, impuestos, comisiones y pagador. En **Margen planes** se recalculan contribución, costo total del tenant, precio mínimo y cuota compatible con el objetivo. **Planes fuente** contiene el seed; **Tarifas Meta**, los 47 mercados por cada una de las dos monedas.

El escenario es un número y un mercado, sin FEP, impuestos de Meta, descuentos de volumen ni pujas. No aumentar la celda de números para multiplicar los 1.000 gratuitos: una flota requiere distribución de entregas real. USD anual está indisponible porque no hay contrato fuente. Custom exige precio, cuota y costo restante; ausencia y cero son distintos. Los costos y FX iniciales son hipótesis, no facturas reales. Ver [alcance económico](plan-economics-code-audit.md).

## Reproducibilidad en este entorno Windows

El generador usa `@oai/artifact-tool` del runtime de Codex y Python estándar para inspeccionar los XML del XLSX. No instala paquetes ni requiere acceso de red. La ubicación del runtime debe localizarse de nuevo si cambia de máquina. En esta sesión:

```powershell
$researchDir = 'C:\Users\USER\Desktop\Sales_Structure\docs\research\2026-09-10'
$runtimeDir = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies'
$artifactLink = Join-Path $researchDir 'node_modules'
if (-not (Test-Path -LiteralPath $artifactLink)) {
    New-Item -ItemType Junction -Path $artifactLink -Target (Join-Path $runtimeDir 'node\node_modules')
}
& (Join-Path $runtimeDir 'node\bin\node.exe') (Join-Path $researchDir 'build-margin-workbook.mjs')
```

Antes de usar una junction existente, comprobar que apunta al runtime previsto. No eliminar recursivamente el destino de una junction. Los renders de revisión quedan en `.tmp-margin`, ignorados junto a `node_modules`. El generador sobrescribe el XLSX y su reporte de verificación; guardar aparte cualquier edición manual del modelo que se quiera conservar.

[margin-workbook-verification.json](margin-workbook-verification.json) registra 16 grupos de comprobaciones, 47 países bajo absorción Meta, fronteras de cuota y comparación con aritmética independiente. Se exportó, reimportó y recalculó; 223 fórmulas tienen caché y no hubo celdas de error. Se renderizaron y revisaron las cuatro hojas. No se ejecutó Excel nativo.

Los inputs de planes son una extracción estática del seed al investigar. Regenerar el Excel **no refresca** esos inputs desde runtime. Si cambia el catálogo, actualizar primero la extracción auditada; si cambian tarifas, descargar originales desde la página estable de Meta, verificar estructura, hash y vigencia y producir el JSON. No editar a mano las cifras de resultado para conservar una conclusión.

## Fuentes de tarifas

`meta-ratecards-sources.json` conserva URL de descubrimiento y URLs firmadas de descarga. `meta-ratecards-2026.json` agrega SHA-256, decimales originales, vigencia, moneda y filas de volumen. Las URLs CDN pueden caducar; los originales permanecen en el paquete. Los archivos de octubre anunciados como CSV eran XLSX y se guardaron con extensión acorde a su contenido.

El modelo usa las tarifas base de octubre. Las hojas de tramos se conservan como evidencia; no se aplican implícitamente. Los resultados y recomendaciones deben volver a revisarse después de nuevos anuncios de Meta o de cambios materiales de código/contrato.
