[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$AabPath,
  [Parameter(Mandatory = $true)][string]$MappingPath,
  [Parameter(Mandatory = $true)][string]$AndroidSdkRoot,
  [Parameter(Mandatory = $true)][string]$JavaHome,
  [Parameter(Mandatory = $true)][string]$OutputDirectory,
  [string]$BuildToolsVersion = '36.0.0',
  [int]$MinApi = 24
)
$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest
$probeAab = (Resolve-Path -LiteralPath $AabPath).Path
$probeMap = (Resolve-Path -LiteralPath $MappingPath).Path
$probeJava = Join-Path $JavaHome 'bin'
$probeD8 = Join-Path $AndroidSdkRoot "build-tools/$BuildToolsVersion/d8.bat"
foreach ($probeTool in @((Join-Path $probeJava 'javac.exe'), (Join-Path $probeJava 'jar.exe'), $probeD8)) {
  if (-not (Test-Path -LiteralPath $probeTool -PathType Leaf)) { throw "Missing tool: $probeTool" }
}
$probeOut = [System.IO.Path]::GetFullPath($OutputDirectory)
if ((Test-Path -LiteralPath $probeOut) -and @(Get-ChildItem -LiteralPath $probeOut -Force).Count -ne 0) {
  throw 'OutputDirectory must be empty or new. No existing diagnostic artifacts are overwritten.'
}
New-Item -ItemType Directory -Path $probeOut -Force | Out-Null
Add-Type -AssemblyName System.IO.Compression.FileSystem
$probeInput = [System.IO.Compression.ZipFile]::OpenRead($probeAab)
try {
  $probeEmbeddedMap = $probeInput.GetEntry('BUNDLE-METADATA/com.android.tools.build.obfuscation/proguard.map')
  if ($null -eq $probeEmbeddedMap) { throw 'AAB has no embedded R8 mapping; cannot bind the supplied mapping to its DEX.' }
  $probeStream = $probeEmbeddedMap.Open()
  $probeSha = [System.Security.Cryptography.SHA256]::Create()
  try { $probeEmbeddedHash = ([BitConverter]::ToString($probeSha.ComputeHash($probeStream))).Replace('-', '') }
  finally { $probeSha.Dispose(); $probeStream.Dispose() }
  $probeMappingHash = (Get-FileHash -LiteralPath $probeMap -Algorithm SHA256).Hash
  if ($probeMappingHash -ne $probeEmbeddedHash) { throw 'Mapping SHA256 differs from the exact mapping embedded in this AAB.' }

  $probeClassSpecs = [ordered]@{
    options = 'expo.modules.securestore.SecureStoreOptions'
    notificationAction = 'expo.modules.notifications.notifications.categories.NotificationActionRecord'
    map = 'com.facebook.react.bridge.JavaOnlyMap'
    kType = 'kotlin.reflect.KType'
    kClass = 'kotlin.reflect.KClass'
    kProperty = 'kotlin.reflect.KProperty'
    appContext = 'expo.modules.kotlin.AppContext'
    provider = 'expo.modules.kotlin.types.TypeConverterProviderImpl'
    codedException = 'expo.modules.kotlin.exception.CodedException'
    fieldAnnotation = 'expo.modules.kotlin.records.Field'
  }
  # Fully qualified originals also resolve methods moved into other classes by R8.
  $probeMethodSpecs = [ordered]@{
    kClassOf = 'kotlin.jvm.internal.Reflection.getOrCreateKotlinClass(java.lang.Class)'
    typeOf = 'kotlin.jvm.internal.Reflection.typeOf(java.lang.Class)'
    memberProperties = 'kotlin.reflect.full.KClasses.getMemberProperties(kotlin.reflect.KClass)'
    propertyName = 'kotlin.reflect.KCallable.getName()'
    propertyAnnotations = 'kotlin.reflect.KAnnotatedElement.getAnnotations()'
    javaField = 'kotlin.reflect.jvm.ReflectJvmMapping.getJavaField(kotlin.reflect.KProperty)'
    obtainConverter = 'expo.modules.kotlin.types.TypeConverterProvider.obtainTypeConverter(kotlin.reflect.KType)'
    convert = 'expo.modules.kotlin.types.TypeConverter.convert(java.lang.Object,expo.modules.kotlin.AppContext,boolean)'
    putString = 'com.facebook.react.bridge.JavaOnlyMap.putString(java.lang.String,java.lang.String)'
    putBoolean = 'com.facebook.react.bridge.JavaOnlyMap.putBoolean(java.lang.String,boolean)'
  }
  $probeFieldSpecs = [ordered]@{
    providerInstance = 'expo.modules.kotlin.types.TypeConverterProviderImpl.INSTANCE'
    authenticationPrompt = 'expo.modules.securestore.SecureStoreOptions.authenticationPrompt'
    keychainService = 'expo.modules.securestore.SecureStoreOptions.keychainService'
    requireAuthentication = 'expo.modules.securestore.SecureStoreOptions.requireAuthentication'
    notificationIdentifier = 'expo.modules.notifications.notifications.categories.NotificationActionRecord.identifier'
    notificationButtonTitle = 'expo.modules.notifications.notifications.categories.NotificationActionRecord.buttonTitle'
  }
  $probeClasses = @{}
  $probeFields = @{}
  $probeMethods = @{}
  $probeWantedMethods = @{}
  foreach ($probeSpec in $probeMethodSpecs.Values) { $probeWantedMethods[$probeSpec] = $true }
  $probeWantedFields = @{}
  foreach ($probeSpec in $probeFieldSpecs.Values) { $probeWantedFields[$probeSpec] = $true }
  $probeClassPattern = [regex]::new('^(\S+) -> (\S+):$', 'Compiled')
  $probeMethodPattern = [regex]::new('^\s+(?:(\d+):(\d+):)?\S+ ([^ (]+)\(([^)]*)\)(?::\d+(?::\d+)?)? -> (\S+)$', 'Compiled')
  $probeFieldPattern = [regex]::new('^\s+\S+ ([^ ()]+) -> (\S+)$', 'Compiled')
  $probeOriginalOwner = $null
  $probeResidualOwner = $null
  $probePending = $null
  function Save-ProbeMethod($method) {
    if ($null -ne $method -and $probeWantedMethods.ContainsKey($method.Original)) {
      if (-not $probeMethods.ContainsKey($method.Original)) {
        $probeMethods[$method.Original] = [System.Collections.Generic.HashSet[string]]::new()
      }
      [void]$probeMethods[$method.Original].Add($method.Owner + '|' + $method.Name)
    }
  }
  foreach ($probeLine in [System.IO.File]::ReadLines($probeMap)) {
    $probeMatch = $probeClassPattern.Match($probeLine)
    if ($probeMatch.Success) {
      Save-ProbeMethod $probePending
      $probePending = $null
      $probeOriginalOwner = $probeMatch.Groups[1].Value
      $probeResidualOwner = $probeMatch.Groups[2].Value
      $probeClasses[$probeOriginalOwner] = $probeResidualOwner
      continue
    }
    if ($probeLine.TrimStart().StartsWith('#')) { continue }
    $probeMatch = $probeMethodPattern.Match($probeLine)
    if ($probeMatch.Success) {
      $probeOriginalMethod = $probeMatch.Groups[3].Value
      if (-not $probeOriginalMethod.Contains('.')) { $probeOriginalMethod = $probeOriginalOwner + '.' + $probeOriginalMethod }
      $probeCurrent = @{
        Original = $probeOriginalMethod + '(' + $probeMatch.Groups[4].Value + ')'
        Owner = $probeResidualOwner
        Name = $probeMatch.Groups[5].Value
        Range = $probeMatch.Groups[1].Value + ':' + $probeMatch.Groups[2].Value
      }
      # Same residual line range = inlining frames, innermost first. Keep only
      # the final (outermost) frame, so an inlined copy is never invoked as a method.
      if ($null -eq $probePending -or $probeCurrent.Range -eq ':' -or
          $probePending.Range -ne $probeCurrent.Range -or $probePending.Name -ne $probeCurrent.Name) {
        Save-ProbeMethod $probePending
      }
      $probePending = $probeCurrent
      continue
    }
    $probeMatch = $probeFieldPattern.Match($probeLine)
    if ($probeMatch.Success) {
      $probeOriginalField = $probeMatch.Groups[1].Value
      if (-not $probeOriginalField.Contains('.')) { $probeOriginalField = $probeOriginalOwner + '.' + $probeOriginalField }
      if ($probeWantedFields.ContainsKey($probeOriginalField)) { $probeFields[$probeOriginalField] = $probeMatch.Groups[2].Value }
    }
  }
  Save-ProbeMethod $probePending
  $probeNames = [ordered]@{
    aabSha256 = (Get-FileHash -LiteralPath $probeAab -Algorithm SHA256).Hash
    mappingSha256 = $probeMappingHash
  }
  foreach ($probeKey in $probeClassSpecs.Keys) {
    $probeOriginal = $probeClassSpecs[$probeKey]
    if (-not $probeClasses.ContainsKey($probeOriginal) -or $probeClasses[$probeOriginal].Contains('REMOVED')) {
      throw "Cannot resolve live class from mapping: $probeOriginal"
    }
    $probeNames[$probeKey] = $probeClasses[$probeOriginal]
  }
  $probeRequiredException = 'expo.modules.kotlin.exception.FieldRequiredException'
  if ($probeClasses.ContainsKey($probeRequiredException) -and -not $probeClasses[$probeRequiredException].Contains('REMOVED')) {
    $probeNames['fieldRequiredException'] = $probeClasses[$probeRequiredException]
  }
  foreach ($probeKey in $probeMethodSpecs.Keys) {
    $probeOriginal = $probeMethodSpecs[$probeKey]
    if (-not $probeMethods.ContainsKey($probeOriginal) -or $probeMethods[$probeOriginal].Count -ne 1) {
      throw "Cannot resolve one live outermost method from mapping: $probeOriginal"
    }
    $probeResolved = @($probeMethods[$probeOriginal])[0].Split('|')
    if ($probeResolved[0].Contains('REMOVED') -or $probeResolved[1].StartsWith('<')) {
      throw "Required method was removed or only inlined: $probeOriginal"
    }
    $probeNames[$probeKey + '.owner'] = $probeResolved[0]
    $probeNames[$probeKey + '.name'] = $probeResolved[1]
  }
  foreach ($probeKey in $probeFieldSpecs.Keys) {
    $probeOriginal = $probeFieldSpecs[$probeKey]
    # R8 omits unchanged fields from mapping; reflection below must still find
    # them. A removed or incompatibly transformed field fails at runtime.
    if ($probeFields.ContainsKey($probeOriginal)) { $probeNames[$probeKey] = $probeFields[$probeOriginal] }
    else { $probeNames[$probeKey] = $probeOriginal.Substring($probeOriginal.LastIndexOf('.') + 1) }
  }
  $probeNames | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $probeOut 'resolved-symbols.json') -Encoding utf8
  $probeGenerated = [System.Text.StringBuilder]::new()
  [void]$probeGenerated.AppendLine('import java.util.*; final class ProbeMapping { static final Map<String,String> NAMES = new HashMap<>(); static {')
  foreach ($probeKey in $probeNames.Keys) {
    foreach ($probeValue in @($probeKey, $probeNames[$probeKey])) {
      if ($probeValue -notmatch '^[A-Za-z0-9_.$]+$') { throw "Unsafe Java mapping symbol: $probeValue" }
    }
    [void]$probeGenerated.AppendLine('NAMES.put("' + $probeKey + '", "' + $probeNames[$probeKey] + '");')
  }
  [void]$probeGenerated.AppendLine('} }')
  [System.IO.File]::WriteAllText((Join-Path $probeOut 'ProbeMapping.java'), $probeGenerated.ToString(), [System.Text.UTF8Encoding]::new($false))
  $probeClassesDir = Join-Path $probeOut 'classes'
  New-Item -ItemType Directory -Path $probeClassesDir | Out-Null
  & (Join-Path $probeJava 'javac.exe') --release 8 -encoding UTF-8 -d $probeClassesDir (Join-Path $PSScriptRoot 'AndroidRecordsProbe.java') (Join-Path $probeOut 'ProbeMapping.java')
  if ($LASTEXITCODE -ne 0) { throw 'javac failed' }
  & (Join-Path $probeJava 'jar.exe') cf (Join-Path $probeOut 'probe-java.jar') -C $probeClassesDir .
  if ($LASTEXITCODE -ne 0) { throw 'jar failed' }
  $probePreviousJavaHome = $env:JAVA_HOME
  try {
    $env:JAVA_HOME = $JavaHome
    & $probeD8 --min-api $MinApi --output (Join-Path $probeOut 'probe.jar') (Join-Path $probeOut 'probe-java.jar')
    if ($LASTEXITCODE -ne 0) { throw 'd8 failed' }
  } finally { $env:JAVA_HOME = $probePreviousJavaHome }

  # Preserve DEX byte-for-byte. Include kotlin_builtins resources used by the
  # exact release reflection runtime; do not add classes from local dependencies.
  $probeJarPath = Join-Path $probeOut 'release-exact.jar'
  $probeJarStream = [System.IO.File]::Open($probeJarPath, [System.IO.FileMode]::CreateNew)
  $probeOutput = [System.IO.Compression.ZipArchive]::new($probeJarStream, [System.IO.Compression.ZipArchiveMode]::Create)
  $probeDexEntries = 0
  try {
    foreach ($probeEntry in $probeInput.Entries) {
      $probeTarget = $null
      if ($probeEntry.FullName -match '^base/dex/(classes\d*\.dex)$') { $probeTarget = $Matches[1]; $probeDexEntries++ }
      elseif ($probeEntry.FullName.StartsWith('base/root/') -and -not $probeEntry.FullName.EndsWith('/')) { $probeTarget = $probeEntry.FullName.Substring(10) }
      if ($null -eq $probeTarget) { continue }
      $probeSourceStream = $probeEntry.Open()
      $probeDestinationStream = $probeOutput.CreateEntry($probeTarget).Open()
      try { $probeSourceStream.CopyTo($probeDestinationStream) }
      finally { $probeDestinationStream.Dispose(); $probeSourceStream.Dispose() }
    }
  } finally { $probeOutput.Dispose(); $probeJarStream.Dispose() }
  if ($probeDexEntries -eq 0) { throw 'AAB contains no base DEX entries.' }
  function Get-ProbeEntryHash($entry) {
    $entryStream = $entry.Open()
    $entrySha = [System.Security.Cryptography.SHA256]::Create()
    try { return ([BitConverter]::ToString($entrySha.ComputeHash($entryStream))).Replace('-', '') }
    finally { $entrySha.Dispose(); $entryStream.Dispose() }
  }
  $probeDexEvidence = [System.Collections.Generic.List[object]]::new()
  $probeCopiedJar = [System.IO.Compression.ZipFile]::OpenRead($probeJarPath)
  try {
    foreach ($probeEntry in $probeInput.Entries) {
      if ($probeEntry.FullName -notmatch '^base/dex/(classes\d*\.dex)$') { continue }
      $probeCopiedEntry = $probeCopiedJar.GetEntry($Matches[1])
      if ($null -eq $probeCopiedEntry) { throw "Missing copied DEX: $($probeEntry.FullName)" }
      $probeOriginalDexHash = Get-ProbeEntryHash $probeEntry
      $probeCopiedDexHash = Get-ProbeEntryHash $probeCopiedEntry
      if ($probeOriginalDexHash -ne $probeCopiedDexHash) { throw "Copied DEX hash mismatch: $($probeEntry.FullName)" }
      $probeDexEvidence.Add([ordered]@{
        aabEntry = $probeEntry.FullName
        jarEntry = $probeCopiedEntry.FullName
        bytes = $probeEntry.Length
        originalSha256 = $probeOriginalDexHash
        copiedSha256 = $probeCopiedDexHash
        matches = $true
      })
    }
  } finally { $probeCopiedJar.Dispose() }
  [ordered]@{
    aabSha256 = $probeNames.aabSha256
    mappingSha256 = $probeMappingHash
    embeddedMappingMatches = $true
    releaseDexCount = $probeDexEntries
    releaseDexEvidence = @($probeDexEvidence.ToArray())
    probeSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $probeOut 'probe.jar')).Hash
    releaseJarSha256 = (Get-FileHash -Algorithm SHA256 -LiteralPath $probeJarPath).Hash
    runtimeExecuted = $false
  } | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $probeOut 'preparation.json') -Encoding utf8
  Write-Output "Prepared exact-release diagnostic jars: $probeOut"
  Write-Output 'No ADB commands, app install, module call, storage access, network access, or UI action executed.'
  Write-Output 'Compilation is preparation only, not a passing Android runtime test.'
} finally { $probeInput.Dispose() }
