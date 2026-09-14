# Compatibilidad Android: recomendaciones de Play Console

Fecha: 14 de septiembre de 2026. Referencia instalada en Play: 1.0.0 (9).
Esta revisión distingue cambios de configuración verificables y validación visual pendiente.

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

No se parchean dependencias ni se actualiza el SDK por inferencia. El nuevo AAB
debe analizarse de nuevo: los cambios propios no garantizan que desaparezca el aviso.
La optimización R8 y los mapas nativos tienen una revisión separada; tampoco se
debe prometer un porcentaje de optimización antes de medir el artefacto.
[Métrica oficial de optimización DEX](https://developer.android.com/topic/performance/vitals/code-optimization).

## Verificación pendiente con el binario de Play

Probar Android 15 y 16, orientación vertical/horizontal, pantalla dividida y un
dispositivo grande o plegable. Cubrir login, Inbox, teclado del chat, notas,
creación de lead, formularios de operación, adjuntos y permisos de cámara/audio.
Revisar recortes, botones accesibles mediante scroll, insets y conservación del
estado al rotar. No se realizó smoke visual nativo en esta revisión: no hay una
superficie CUA nativa disponible. TypeScript, pruebas de componentes y manifest
son evidencia complementaria; no sustituyen esa comprobación física.
