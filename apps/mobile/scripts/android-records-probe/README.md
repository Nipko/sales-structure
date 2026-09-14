# Android release record conversion probe

Prepares a diagnostic harness against the **exact DEX and Kotlin resources in a signed AAB**. It exercises Expo record reflection and conversion with fresh synthetic `JavaOnlyMap` values. It never invokes SecureStore or Notifications module functions, opens the app, accesses app data/credentials, or calls the network.

This catches release-only R8 regressions that a JavaScript export or Jest test cannot catch. `JavaOnlyMap` implements the same `ReadableMap` conversion path used by native bridge maps; the probe does **not** certify the bridge, native storage I/O, authentication, or the complete application.

## Prepare

Use Windows PowerShell, JDK 17, Android SDK build-tools (default `36.0.0`), the release AAB, and its `mapping.txt`. Provide a new or empty output directory outside the repository:

```powershell
& ./build-probe.ps1 `
  -AabPath 'C:/release/app.aab' `
  -MappingPath 'C:/release/mapping.txt' `
  -AndroidSdkRoot "$env:LOCALAPPDATA/Android/Sdk" `
  -JavaHome 'C:/Program Files/Eclipse Adoptium/jdk-17.0.18.8-hotspot' `
  -OutputDirectory 'C:/release/records-probe'
```

The script requires the supplied mapping SHA-256 to match the mapping embedded in the AAB. It resolves original classes, fields and methods, including Kotlin functions moved to another class by R8. It ignores inlined copies by selecting the outermost mapping frame. Missing/ambiguous methods fail explicitly; changed runtime signatures fail with a full stack trace. Unchanged fields may be omitted from an R8 mapping and are verified through reflection at runtime.

Outputs:

- `probe.jar`: diagnostic DEX, no application replacement classes.
- `release-exact.jar`: unmodified release DEX plus `base/root` resources, including `kotlin_builtins`.
- `resolved-symbols.json`: original operation to exact release symbol resolution.
- `preparation.json`: AAB/mapping/JAR hashes, mapping binding, DEX count and each original/copied DEX hash; a mismatch fails preparation. `runtimeExecuted` remains `false` because preparation never runs Android.

No ADB command is executed by this script. A successful build is **not** a passing runtime check.

## Execute on an authorized Android device

A separate operator may put both JARs in a dedicated diagnostic directory under `/data/local/tmp`, set permissions as needed for ART, and run:

```text
CLASSPATH=/data/local/tmp/records-probe/probe.jar:/data/local/tmp/records-probe/release-exact.jar app_process /system/bin AndroidRecordsProbe
```

Run this as a separate diagnostic process, without `run-as` or app identity. Preserve the command's exit status and full output. This does not require reinstalling, signing, or clearing the production application. Do not add module calls, storage operations, or user interface automation to the probe.

Pass criteria: process exit code `0`, every stage `PASS`, and `RESULT failures=0`. Rejected synthetic input prints expected exception stacks; a failure prints `FAIL` and exits `1`. An unresolved symbol is a harness compatibility failure, never evidence that the application passed.

Coverage:

- SecureStoreOptions constructor defaults (`keychainService="key_v1"`, `authenticationPrompt=" "`, `requireAuthentication=false`), three Kotlin properties, retained `Field` annotations and backing fields. These exact defaults match the current Expo SecureStore SDK 54 source; verify any intentional SDK change before updating the assertions.
- 100 empty and 100 populated options conversions; populated results must contain the supplied synthetic service and boolean.
- Invalid `requireAuthentication` type must be rejected without an NPE in its cause chain.
- NotificationActionRecord must reject missing `identifier`, missing `buttonTitle`, and an empty map as required-field errors; 100 valid records must retain both supplied values.

When comparing releases, generate separate output directories from each AAB and its matching mapping. A debug build, patched DEX, or local dependency classes cannot substitute for the exact release binary.

## Reproduced failing baseline: 1.1.0 (10)

On September 14, 2026, the exact release DEX was tested on a Samsung SM-S918B running Android 16 (API 36). All three setup stages passed: the Java constructor, Kotlin properties/backing fields, and converter creation. All seven conversion stages failed with an NPE or an assertion preserving that NPE as its cause. The process returned exit code `1` and `RESULT failures=7`.

This establishes a failing release baseline despite successful compilation and intact option fields. The 100-iteration stages failed on their first conversion; they did not complete 100 successful iterations. A corrected release must pass all ten stages independently.

- AAB SHA-256: `1CAFA2E8EC550803EB87025AA7668007AB235C1DEC25D479C2595628BF5FE14A`.
- Matching R8 mapping SHA-256: `74277674CA478D1D2984D035056CC5CAB54614AB97445CB2A7905495832CF5CB`.
- Exact `classes.dex`: 7,418,412 bytes; SHA-256 `8D7EDB4596E7F5541668E54CDFE994578FFB9DE3489F8580DAFEB86BC8731FE2` (original and diagnostic copy match).
- Local diagnostic log: `C:/Users/USER/Desktop/parallly-v10-play/records-probe-reusable/v10-preparation-01/runtime-result.txt` (release evidence outside the repository).

## Corrected candidate: 1.1.1 (12)

The signed candidate AAB from EAS build `3f8c9d02-c694-47c2-9f93-21daa9176533` (source commit `a516c144cd0ab2a4a94b10d19d786bf7a178aaf5`, completed September 14, 2026 at 07:16:56 UTC) was tested separately on the Samsung device with its own exact DEX and matching embedded R8 mapping. All ten stages passed, the process returned exit code `0`, and the log ended with `RESULT failures=0`.

| Check | 1.1.0 (10) | 1.1.1 (12) |
| --- | --- | --- |
| Constructor, Kotlin property metadata and converter creation | 3 stages passed | 3 stages passed, including exact default assertions |
| Empty and populated SecureStoreOptions | NPE on first conversion | 100 empty + 100 populated conversions passed |
| Invalid `requireAuthentication` type | NPE | Field cast error, with no NPE in the cause chain |
| Missing notification `identifier`, missing `buttonTitle`, empty record | NPE | All three inputs rejected as required-field errors |
| Valid notification records | NPE on first conversion | 100 conversions passed, with both values verified |
| Final result | 7 failed stages; exit 1 | 0 failed stages; exit 0 |

- AAB: 52,039,230 bytes; SHA-256 `362F2DB492D6F819458D40909FC6D0E67860E016FBA3F8DF61F580C9600AB05C`.
- Matching R8 mapping SHA-256: `38816693D37AEF08AB26307E3B9C24523294C6250AB731EDE4C94ABA823DD12B`.
- Exact `classes.dex`: 7,428,824 bytes; SHA-256 `DE4532F905581D7C12430198DF408D5DD67CF04A07D0A2218E26AB32A1061351` (original and diagnostic copy match).
- Diagnostic `probe.jar` SHA-256: `F61FA2C1BFD2C3DF0CBE4A66B3CC8069170E588DD96B408C50E78D3975BC388B`.
- Local evidence: `C:/Users/USER/Desktop/parallly-v12-play/artifact-validation.json`, `records-probe/preparation.json`, `records-probe/runtime-result.txt`, and `build-view.json` under the same release directory.

The candidate demonstrates that the reproduced record-conversion regression is fixed in the release DEX. It also preserves the expected rejection of invalid or incomplete synthetic input. The preparation file still records `runtimeExecuted=false` because it describes the preparation command; the separate runtime log records the device execution. These results do not establish Google Play approval, successful app startup/login, access to previously stored credentials, or complete application behavior. Those remain separate release checks.

## Alcance

Esta prueba prepara y valida conversiones nativas de registros con datos sintéticos. No lee ni cambia sesiones, credenciales, notificaciones ni datos de la app. Compilar el diagnóstico no equivale a ejecutarlo en Android; la comprobación visual y el arranque de la app siguen siendo verificaciones separadas.
