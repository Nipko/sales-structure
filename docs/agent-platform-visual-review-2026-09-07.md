# Revisión visual local del agente — 7 de septiembre de 2026

## Resultado y límite de la evidencia

La inspección visual en navegador **no se completó**. El frontend real de Next.js inició en `127.0.0.1:3001` y la API ficticia respondió en `127.0.0.1:3999`. La herramienta permitida de navegador del subagente rechazó la creación de una pestaña con `IAB visibility is not supported in a subagent thread`. En el agente principal, la inicialización y el único reintento tras reiniciar fallaron con `failed to write kernel assets` / ruta no encontrada (`os error 3`). No se intentó sustituir esa herramienta por CDP ni otra automatización.

No hay capturas válidas ni evidencia de inspección móvil, legibilidad, interacción con formularios o recorridos en esta ejecución. Tampoco se certificó el backend con esta API ficticia. La revisión visual queda pendiente para un entorno con navegador disponible.

Evidencia independiente del navegador: las 37 pruebas del panel de aprobaciones pasan y el dashboard compila con TypeScript. Cubren roles, conversación exacta, lectura autoritativa después de mutaciones, respuesta de red incierta, vencimiento, argumentos, cuatro idiomas y la separación entre aprobación, ejecución, estado comercial y envío. Un efecto fallido no ofrece repetir una operación ya ejecutada; aceptar el envío en el proveedor no se presenta como recepción o lectura.

El fixture versionado también pasó una comprobación HTTP local: cabecera de identificación sintética, acceso ficticio, conocimiento `unknown`, fallo recuperable `503`, aprendizaje vacío y endpoint no declarado `501`. Ambos servidores temporales se detuvieron al cerrar esta revisión.

Durante la preparación se corrigieron por lectura de código dos mensajes de estado: una misión ausente ya no pide crear otro agente, y un fallo inicial al cargar aprendizaje muestra evidencia no verificable con una ruta de reintento, sin inventar cero conversaciones reservadas ni mantener el aviso de carga. Las pruebas de representación de estos estados en cuatro idiomas y las del panel suman **51 pruebas aprobadas en tres suites**; TypeScript vuelve a pasar. Esto sigue siendo evidencia automatizada sin inspección visual.

## Entorno reproducible con datos ficticios

Requiere las dependencias del monorepo instaladas. No requiere credenciales de un tenant, proveedores de IA, base de datos ni acceso a producción. La API sólo escucha en loopback; reutiliza las respuestas sintéticas de navegación de `apps/e2e/tests/dashboard/navigation.spec.ts` y añade assessment, agente y aprendizaje. Los endpoints no declarados responden `501` para que una carencia del fixture no se confunda con una colección vacía real.

Desde la raíz del repositorio, en una terminal:

```powershell
node apps/e2e/fixtures/agent-visual-fixture.cjs
```

En otra terminal PowerShell, también desde la raíz:

```powershell
$env:NEXT_TELEMETRY_DISABLED='1'
$env:NEXT_PUBLIC_API_URL='http://127.0.0.1:3999/api/v1'
$env:NEXT_PUBLIC_WA_SERVICE_URL='http://127.0.0.1:3998/api/v1'
$env:NEXT_PUBLIC_GOOGLE_CLIENT_ID='e2e.invalid'
$env:NEXT_PUBLIC_META_APP_ID='e2e'
$env:NEXT_PUBLIC_META_CONFIG_ID='e2e'
$env:NEXT_PUBLIC_META_SOLUTION_ID='e2e'
$env:NEXT_PUBLIC_INSTAGRAM_APP_ID='e2e'
$env:NEXT_PUBLIC_INSTAGRAM_REDIRECT_URI='http://127.0.0.1:3001/admin/channels/instagram/callback'
$env:NEXT_PUBLIC_MESSENGER_FB_LOGIN_CONFIG_ID='e2e'
$env:NEXT_PUBLIC_MP_PUBLIC_KEY='TEST-e2e'
Set-Location apps/dashboard
node ../../node_modules/next/dist/bin/next dev --hostname 127.0.0.1 --port 3001
```

Abrir `http://127.0.0.1:3001/login` usando la herramienta de navegador permitida o un navegador manual. Acceso ficticio: `novato@example.test`, contraseña `prueba-local`. El fixture acepta el formulario local sin autenticar cuentas reales. No reutilizar credenciales reales.

El agente ficticio es `44444444-4444-4444-8444-444444444444`; tenant ficticio `11111111-1111-4111-8111-111111111111`. El assessment incluye misión pendiente, información del negocio pendiente y conocimiento/pruebas sin verificar. Aprendizaje inicia vacío. Estos valores sirven para inspeccionar la interfaz, no como evidencia de capacidades operativas.

Para simular indisponibilidad y recuperación del assessment:

```powershell
Invoke-RestMethod 'http://127.0.0.1:3999/_fixture/state?assessment=fail'
# En Inicio, actualizar y comprobar el aviso recuperable.
Invoke-RestMethod 'http://127.0.0.1:3999/_fixture/state?assessment=ok'
# En la interfaz, pulsar Reintentar.
```

Se pueden ampliar respuestas durante la revisión con un POST a `/_fixture/override`, cuerpo JSON `{ "path": "/ruta-sin-api-v1", "status": 200, "response": { "success": true, "data": {} } }`. Los overrides sólo viven en memoria. No existe forwarding ni escritura en una API real. Cerrar ambas terminales con Ctrl+C al terminar.

## Casos pendientes de inspección

1. Inicio: una sola secuencia de puesta en marcha, siguiente paso claro, conocimiento desconocido identificado como «sin verificar», error global recuperable y recuperación visible.
2. «Mostrarme dónde»: destino y control correctos para negocio y conocimiento; siguiente/anterior/cerrar; un editor abierto conserva lo escrito y el recorrido explica cómo continuar.
3. Assist: legibilidad del diagnóstico, una acción concreta, revisión de propuesta antes de aplicar y mensaje recuperable cuando no puede verificar el estado. Las respuestas de este fixture son sintéticas: no evalúan la calidad del modelo.
4. Misión: objetivo, situaciones que atiende, criterios de éxito y cuándo pedir ayuda; selección por plantilla, preparación del cambio y diferencia antes/después. No interpretar la edición como una prueba de competencia.
5. Aprendizaje: estado vacío, importación y privacidad, diferencia entre ejemplo aprobado y versión publicada, comparación con conversaciones reservadas y explicación de denominadores; probar datos sintéticos adicionales mediante overrides.
6. Inbox: aprobación pendiente, rechazada y vencida; ejecución confirmada con pago pendiente; archivo aceptado por proveedor; traspaso registrado; envío fallido o por conciliar sin repetir la operación. Requiere ampliar el fixture con una conversación y tickets sintéticos.
7. Repetir los casos en escritorio y ancho móvil, con teclado, zoom y textos largos en es/en/pt/fr; comprobar que no hay desbordamiento horizontal ni controles de confirmación fuera de alcance.

Los casos son una lista pendiente; no resultados aprobados. Los estados y reglas ya comprobados por pruebas unitarias no sustituyen esta inspección.
