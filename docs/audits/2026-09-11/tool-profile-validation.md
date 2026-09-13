# Verificación focalizada de la auditoría de herramientas

Fecha: 2026-09-11. Workspace compartido con otra ejecución de Claude. Los comandos
se ejecutaron desde la raíz de Sales_Structure; no se hicieron llamadas reales a
proveedores/modelos, push ni despliegue.

## Resultado

| Verificación | Resultado observado |
|---|---|
| API, suites afectadas y contratos vecinos | 11/11 suites; 531/531 pruebas; sin omisiones |
| Dashboard, controles/navegación/sidebar/accesibilidad | 6/6 suites; 288/288 pruebas; sin omisiones |
| TypeScript dashboard frío | exit 0 |
| TypeScript API frío, ejecución final integrada | exit 0, después de corregirse la edición concurrente |
| Censo generado, escritura y --check | exit 0; sin huecos estructurales en las condiciones comprobadas |
| git diff --check | exit 0 |

Una ejecución intermedia del chequeo frío de API detectó TS1005 por backticks sin
escapar dentro de un comentario SQL contenido en un template literal, alrededor
de `FOR SHARE OF r`, en `persona/proactive-policy-authority.ts:195`. Ese archivo
estaba en edición concurrente y no se modificó desde esta auditoría. Después de
observar su corrección en el workspace se repitió el comando completo: exit 0.
El resultado final de la tabla es esta repetición, no un verde anterior al cambio.

Las pruebas de API se ejecutaron con ts-jest y su configuración normal, con heap
de 6 GiB. Las pruebas de UI incluyen render y acciones sobre los controles, no
sólo inspección de cadenas. Los 76 perfiles se ejercitan en las matrices de
permisos, menús y explicaciones; eso no equivale a ejecutar todos sus writers.

## Comandos reproducibles

```powershell
node --max-old-space-size=6144 node_modules/jest/bin/jest.js --config apps/api/jest.config.js --runInBand --testPathPattern='(effective-capability.spec|turn-capability-composer.spec|turn-capability-owner-controls.spec|tool-policy-registry.spec|provider-freshness-coherence.spec|vertical-readiness.contract.spec|vertical-readiness-isolation.spec|agent-assessment.service.spec|agent-tool-explanations.spec|agent-release-evidence.spec|assistant-kb-contract.spec)' --silent

.\node_modules\.bin\jest.cmd --config apps/dashboard/jest.config.cjs --runInBand --runTestsByPath apps/dashboard/src/app/admin/agent/_components/capability-availability.a11y.spec.tsx apps/dashboard/src/lib/agent-tool-availability.spec.ts apps/dashboard/src/lib/vertical-dashboard-resolver.spec.ts apps/dashboard/src/lib/navigation-access.spec.ts apps/dashboard/src/lib/navigation-plan-gate.spec.ts apps/dashboard/src/components/layout/__tests__/AppSidebar.spec.ts --silent

node --max-old-space-size=6144 node_modules/typescript/bin/tsc --project apps/api/tsconfig.json --noEmit --incremental false
node --max-old-space-size=6144 node_modules/typescript/bin/tsc --project apps/dashboard/tsconfig.json --noEmit --incremental false

node docs/audits/2026-09-11/generate-tool-profile-audit.cjs --write
node docs/audits/2026-09-11/generate-tool-profile-audit.cjs --check
git diff --check
```

## Evidencia de regresión y límites

Los agentes de revisión reprodujeron fallos antes de sus correcciones: exclusiones
por familia, proveedor desactivado/propiedad desconocida, caché de preparación,
evidencia negativa insuficiente, plan desactualizado o de otra cuenta, requisitos
ajenos y marcadores de evaluación visibles. Las corridas finales integradas son
las dos de la tabla; no sumar corridas repetidas para inflar el número de pruebas.

No se ejecutó la suite completa del monorepo, Playwright completo, pruebas nuevas
contra PostgreSQL/PgBouncer, canarios de canales ni evaluación por modelo en esta
tanda. El frente de release debe ejecutar sus verificaciones después de integrar
el trabajo concurrente. Los resultados históricos citados por Claude no se
reutilizan como evidencia de este árbol modificado.

Los artefactos de censo registran hashes de las fuentes que consumen, normalizadas
a UTF-8/LF para que el checkout Windows/CI no produzca una falsa divergencia. Su resultado
es estructural: no valida por sí solo permisos por rol, escrituras, resultados
económicos, aprendizaje, atención real ni facilidad de uso con personas nuevas.
