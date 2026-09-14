import java.lang.annotation.Annotation;
import java.lang.reflect.*;
import java.util.*;

/** Uses only fresh synthetic objects from the exact release DEX. Never calls a native module. */
public final class AndroidRecordsProbe {
  private static int failures;
  private static Object provider;
  private static Object optionsConverter;
  private static Object notificationConverter;
  private static Class<?> options;
  private static Class<?> notifications;
  interface Check { void run() throws Throwable; }

  static String symbol(String key) {
    String value = ProbeMapping.NAMES.get(key);
    if (value == null || value.isEmpty()) throw new AssertionError("Unresolved mapping symbol: " + key);
    return value;
  }
  static Class<?> cls(String key) throws Exception { return Class.forName(symbol(key)); }
  static Object invoke(String key, Object target, Class<?>[] parameters, Object... args) throws Throwable {
    try {
      Method method = cls(key + ".owner").getDeclaredMethod(symbol(key + ".name"), parameters);
      method.setAccessible(true);
      return method.invoke(target, args);
    } catch (InvocationTargetException error) { throw error.getCause(); }
  }
  static Object construct(Class<?> type) throws Throwable {
    try { return type.getConstructor().newInstance(); }
    catch (InvocationTargetException error) { throw error.getCause(); }
  }
  static Object field(Object instance, String key) throws Exception {
    Field field = instance.getClass().getDeclaredField(symbol(key));
    field.setAccessible(true);
    return field.get(instance);
  }
  static void check(String stage, Check body) {
    System.out.println("BEGIN " + stage);
    try { body.run(); System.out.println("PASS " + stage); }
    catch (Throwable error) {
      failures++;
      System.out.println("FAIL " + stage + " " + error.getClass().getName() + ": " + error.getMessage());
      error.printStackTrace(System.out);
    }
  }
  static Object map() throws Throwable { return construct(cls("map")); }
  static void putString(Object map, String key, String value) throws Throwable {
    invoke("putString", map, new Class<?>[] {String.class, String.class}, key, value);
  }
  static void putBoolean(Object map, String key, boolean value) throws Throwable {
    invoke("putBoolean", map, new Class<?>[] {String.class, boolean.class}, key, value);
  }
  static Object kotlinType(Class<?> type) throws Throwable {
    return invoke("typeOf", null, new Class<?>[] {Class.class}, type);
  }
  static Object converter(Class<?> type) throws Throwable {
    return invoke("obtainConverter", provider, new Class<?>[] {cls("kType")}, kotlinType(type));
  }
  static Object convert(Object converter, Object map) throws Throwable {
    return invoke("convert", converter, new Class<?>[] {Object.class, cls("appContext"), boolean.class}, map, null, false);
  }
  static void inspectOptions(Object instance, boolean populated) throws Exception {
    if (!options.isInstance(instance)) throw new AssertionError("Wrong options result type");
    Object prompt = field(instance, "authenticationPrompt");
    Object service = field(instance, "keychainService");
    Object authentication = field(instance, "requireAuthentication");
    if (!(prompt instanceof String) || !(service instanceof String) || !(authentication instanceof Boolean))
      throw new AssertionError("Options constructor did not preserve non-null typed defaults");
    if (populated && (!"probe_synthetic_service".equals(service) || !Boolean.TRUE.equals(authentication)))
      throw new AssertionError("Provided options did not reach the record fields");
    // SDK 54 expo-secure-store uses this alias for existing stored credentials.
    // Accepting another non-null string would miss a storage-compatibility break.
    if (!" ".equals(prompt)) throw new AssertionError("Default authenticationPrompt changed");
    if (!populated && (!"key_v1".equals(service) || !Boolean.FALSE.equals(authentication)))
      throw new AssertionError("Default keychainService or requireAuthentication changed");
  }
  static void assertNoNpe(Throwable error) {
    Set<Throwable> seen = Collections.newSetFromMap(new IdentityHashMap<Throwable, Boolean>());
    for (Throwable cause = error; cause != null && seen.add(cause); cause = cause.getCause())
      if (cause instanceof NullPointerException) throw new AssertionError("Unexpected NPE in rejection", error);
  }
  static void expectRejection(Object converter, Object map, String fieldName, boolean required) throws Throwable {
    try { convert(converter, map); }
    catch (Throwable error) {
      assertNoNpe(error);
      String message = String.valueOf(error.getMessage());
      if (!cls("codedException").isInstance(error) || !message.contains(fieldName)
          || (required ? !message.contains("is required") : !message.toLowerCase(Locale.ROOT).contains("cast")))
        throw new AssertionError("Wrong rejection for " + fieldName, error);
      String requiredClass = ProbeMapping.NAMES.get("fieldRequiredException");
      if (required && requiredClass != null && !Class.forName(requiredClass).isInstance(error))
        throw new AssertionError("Expected mapped FieldRequiredException", error);
      System.out.println("EXPECTED_REJECTION " + error.getClass().getName() + " field=" + fieldName);
      error.printStackTrace(System.out);
      return;
    }
    throw new AssertionError("Invalid record accepted: " + fieldName);
  }
  public static void main(String[] args) {
    System.out.println("AndroidRecordsProbe aab_sha256=" + symbol("aabSha256"));
    System.out.println("mapping_sha256=" + symbol("mappingSha256"));
    System.out.println("Scope=reflection-and-synthetic-map-only; no-module-call; no-storage; no-network; no-UI");
    check("options-java-constructor", () -> {
      options = cls("options");
      notifications = cls("notificationAction");
      inspectOptions(construct(options), false);
    });
    check("options-kotlin-properties-and-fields", () -> {
      Object kClass = invoke("kClassOf", null, new Class<?>[] {Class.class}, options);
      Collection<?> properties = (Collection<?>) invoke("memberProperties", null, new Class<?>[] {cls("kClass")}, kClass);
      System.out.println("PROPERTY_COUNT " + properties.size());
      if (properties.size() != 3) throw new AssertionError("Expected three SecureStore option properties");
      for (Object property : properties) {
        Object name = invoke("propertyName", property, new Class<?>[0]);
        List<?> annotations = (List<?>) invoke("propertyAnnotations", property, new Class<?>[0]);
        Object javaField = invoke("javaField", null, new Class<?>[] {cls("kProperty")}, property);
        boolean hasField = false;
        for (Object annotation : annotations) {
          Class<?> annotationType = ((Annotation) annotation).annotationType();
          System.out.println("ANNOTATION " + name + " " + annotationType.getName());
          hasField |= annotationType.equals(cls("fieldAnnotation"));
        }
        System.out.println("JAVA_FIELD " + name + " present=" + (javaField != null));
        if (!hasField || javaField == null) throw new AssertionError("Missing Field annotation or backing field: " + name);
      }
    });
    check("record-converters", () -> {
      Field singleton = cls("provider").getDeclaredField(symbol("providerInstance"));
      singleton.setAccessible(true);
      provider = singleton.get(null);
      optionsConverter = converter(options);
      notificationConverter = converter(notifications);
      System.out.println("OPTIONS_CONVERTER " + optionsConverter.getClass().getName());
      System.out.println("NOTIFICATION_CONVERTER " + notificationConverter.getClass().getName());
    });
    check("empty-options-repeat-100", () -> {
      Object empty = map();
      for (int i = 0; i < 100; i++) inspectOptions(convert(optionsConverter, empty), false);
    });
    check("populated-options-repeat-100", () -> {
      Object populated = map();
      putString(populated, "keychainService", "probe_synthetic_service");
      putBoolean(populated, "requireAuthentication", true);
      for (int i = 0; i < 100; i++) inspectOptions(convert(optionsConverter, populated), true);
    });
    check("invalid-options-type-rejected-without-npe", () -> {
      Object invalid = map();
      putString(invalid, "requireAuthentication", "invalid");
      expectRejection(optionsConverter, invalid, "requireAuthentication", false);
    });
    check("notification-required-identifier", () -> {
      Object missing = map();
      putString(missing, "buttonTitle", "Synthetic title");
      expectRejection(notificationConverter, missing, "identifier", true);
    });
    check("notification-required-buttonTitle", () -> {
      Object missing = map();
      putString(missing, "identifier", "probe_synthetic_id");
      expectRejection(notificationConverter, missing, "buttonTitle", true);
    });
    check("notification-empty-rejected", () -> {
      try { convert(notificationConverter, map()); }
      catch (Throwable error) {
        assertNoNpe(error);
        String message = String.valueOf(error.getMessage());
        if (!cls("codedException").isInstance(error) || !message.contains("is required")
            || !(message.contains("identifier") || message.contains("buttonTitle")))
          throw new AssertionError("Wrong required-field rejection", error);
        error.printStackTrace(System.out);
        return;
      }
      throw new AssertionError("Empty notification action accepted");
    });
    check("notification-populated-repeat-100", () -> {
      Object populated = map();
      putString(populated, "identifier", "probe_synthetic_id");
      putString(populated, "buttonTitle", "Synthetic title");
      for (int i = 0; i < 100; i++) {
        Object result = convert(notificationConverter, populated);
        if (!notifications.isInstance(result)
            || !"probe_synthetic_id".equals(field(result, "notificationIdentifier"))
            || !"Synthetic title".equals(field(result, "notificationButtonTitle")))
          throw new AssertionError("Required notification values not applied");
      }
    });
    System.out.println("RESULT failures=" + failures);
    if (failures != 0) System.exit(1);
  }
}
