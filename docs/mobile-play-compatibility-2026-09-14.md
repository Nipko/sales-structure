# Compatibilidad Android: recomendaciones de Play Console

Fecha: 14 de septiembre de 2026. Referencia observada en Producción: 1.0.0 (9).
El AAB 1.1.0 (10) terminó en EAS, fue validado localmente y Play confirma
optimización alta con 91% de ofuscación. Está disponible en pruebas internas desde
el 14-sep-2026 a la 01:05 de Bogotá. La actualización de producción y la
validación visual física permanecen pendientes.

## Orientación y ventanas

Play identifica `MainActivity android:screenOrientation=PORTRAIT` en build 9.
Android 16, al apuntar a API 36, ignora estas restricciones en pantallas de al menos
600 dp de ancho mínimo. La aplicación debe poder rotar y cambiar de tamaño.
[Guía oficial de orientación y redimensionado](https://developer.android.com/develop/adaptive-apps/guides/app-orientation-aspect-ratio-resizability).

El plugin `apps/mobile/plugins/withAndroidAdaptiveLayout.js` elimina la restricción
de orientación de MainActivity y establece `android:resizeableActivity=true`.
Se registra en `app.config.ts` para que EAS lo reproduzca al generar Android.
Conserva la orientación configurada en iOS, las actividades de librerías y el
`adjustNothing` que utiliza `useKeyboardSpace` para gestionar el teclado.
No incluye una excepción temporal a las reglas de Android 16.

Comprobación con `expo config --type introspect --json`:

- Versión 1.1.0.
- MainActivity sin `android:screenOrientation`.
- `android:resizeableActivity=true` y `android:windowSoftInputMode=adjustNothing`.
- iOS mantiene `UIInterfaceOrientationPortrait` y `PortraitUpsideDown`.
- Cuatro pruebas del plugin cubren el manifest, idempotencia, iOS y estructura inválida.

La inspección del manifest incluido en el AAB terminado confirma MainActivity
sin restricción de orientación, `resizeableActivity=true` y
`windowSoftInputMode=0x00000030` (`adjustNothing`). La comprobación de orientación
iOS anterior proviene de introspección; el AAB valida solamente Android.

## Evidencia del AAB 1.1.0 (10)

- EAS `0bf6fdb7-6f21-4d4b-bd4a-71a756c89ed7`: `FINISHED`, perfil `production`,
  completado el 14-sep-2026 a las 05:55:44 UTC.
- Commit `d67c1fa0f9fe6883b60a8814fcaf0fbde36236b2`.
- Package `cloud.parallly.mobile`, versionName `1.1.0`, versionCode `10`,
  minSdk 24 y targetSdk 36; configuración incluida con la API de producción
  `https://api.parallly-chat.cloud/api/v1`.
- AAB de 52.032.300 bytes: firma verificada y `bundletool validate` aprobado.
- SHA-256: `1CAFA2E8EC550803EB87025AA7668007AB235C1DEC25D479C2595628BF5FE14A`.
- Mapping de 69.276.634 bytes con 7.637 clases renombradas; `r8.json` incluido,
  R8 8.11.18 con ofuscación, optimización y reducción de código activas.
- Log EAS confirma la subida del mapping nativo a Sentry.

Fuentes: `C:/Users/USER/Desktop/parallly-v10-play/artifact-validation.json`,
`build-view.json`, `build-log-01.txt` y el AAB `parallly-1.1.0-v10.aab` del mismo
directorio. [Detalle de R8 y estadísticas internas](mobile-android-r8-2026-09-14.md).

## Análisis confirmado en Play Console

El explorador de app bundles, artefacto `4860230114055681879`, muestra para la
versión 1.1.0 (10):

| Comprobación de Play | Resultado |
| --- | --- |
| Optimización | Alta |
| Ofuscación | 91%; supera el umbral de 25% observado en Play |
| R8 | Modo completo |
| Código DEX | 7,42 MB |
| Compatibilidad de páginas de memoria | Admite 16 KB |
| Descarga | 13,5 MB; 6,99 MB menos que el build 9 |
| Actualización | 4,53 MB |

Play indica que el build 10 está disponible en pruebas internas, publicado el
14-sep-2026 a la 01:05 de Bogotá. El problema de optimización del build 9 (1%)
corresponde al artefacto anterior y puede seguir asociado a producción hasta
actualizarla. Estas métricas verifican el build 10; no certifican su prueba
física, su publicación en producción ni la desaparición de avisos edge-to-edge.

## Adaptación de formularios

El formulario de creación de lead de `CrmScreen` ahora permite desplazamiento dentro
de su altura máxima, conserva acceso al botón con el teclado abierto y etiqueta la
acción para lectores de pantalla. El modal común de conversación permite scroll
opcional en nota, siguiente acción, resumen y contacto. Sus listas virtualizadas
mantienen su propio desplazamiento. Los modales de operación se revisan en sus
cambios correspondientes. Las listas y pantallas principales ya
usan flex, FlatList/ScrollView e insets; esto no constituye una certificación visual.

## APIs edge-to-edge señaladas

Dependencias instaladas: Expo 54.0.37, React Native 0.81.5,
react-native-screens 4.16.0 y expo-image-picker 17.0.11.
Expo SDK 54 apunta a Android 16 y aplica edge-to-edge obligatoriamente.
[Notas oficiales de Expo SDK 54](https://expo.dev/changelog/sdk-54).

Los orígenes reportados por Play incluyen código de dependencias:

| Origen | Evidencia en código instalado |
| --- | --- |
| React Native `StatusBarModule` | Consulta y cambia `window.statusBarColor` |
| React Native `WindowUtil` | Colores transparentes y modos de recorte de pantalla |
| react-native-screens `ScreenWindowTraits` | Métodos de color de barras del sistema |
| expo-image-picker `ExpoCropImageUtils` | Aplica tema a la ventana de recorte |
| Google Material | BottomSheetDialog, EdgeToEdgeUtils y SheetDialog reportados por Play |

El código propio utiliza `<StatusBar style="light" />`, sin asignar colores a las
barras, y no activa `allowsEditing` en el selector de imágenes. Usa
react-native-safe-area-context. `statusBarTranslucent` en Modal es una propiedad de
la ventana del modal: retirarla masivamente no demuestra que se eliminen los
métodos compilados de las dependencias y puede cambiar su presentación.
React Native documenta la obsolescencia de color y translucidez de StatusBar desde
API 35. [Referencia oficial de StatusBar 0.81](https://reactnative.dev/docs/0.81/statusbar).

No se parchean dependencias ni se actualiza el SDK por inferencia. La revisión
del aviso edge-to-edge en el nuevo AAB sigue pendiente: los cambios propios no
garantizan que desaparezca. R8 y sus mapas están comprobados en el artefacto y
Play confirma 91% de ofuscación; las estadísticas internas de R8 se documentan
por separado y no sustituyen ese porcentaje observado en Play.
[Métrica oficial de optimización DEX](https://developer.android.com/topic/performance/vitals/code-optimization).

## Verificación pendiente con el binario de Play

Probar Android 15 y 16, orientación vertical/horizontal, pantalla dividida y un
dispositivo grande o plegable. Cubrir login, Inbox, teclado del chat, notas,
creación de lead, formularios de operación, adjuntos y permisos de cámara/audio.
Revisar recortes, botones accesibles mediante scroll, insets y conservación del
estado al rotar. No se realizó smoke visual nativo en esta revisión: no hay una
superficie CUA nativa disponible. TypeScript, pruebas de componentes y manifest
son evidencia complementaria; no sustituyen esa comprobación física.
