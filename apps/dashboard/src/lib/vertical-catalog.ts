export const CANONICAL_VERTICAL_COUNT = 20;

export type VerticalCatalogLocale = "es" | "en" | "pt" | "fr";

export interface VerticalCatalogLabel {
  es: string;
  en?: string;
  pt?: string;
  fr?: string;
}

export type VerticalAvailability = "selectable" | "pilot" | "waitlist" | "legacy_only";

export interface VerticalCatalogSubType {
  key: string;
  label: VerticalCatalogLabel;
  /**
   * Si este subtipo se puede elegir hoy. Puede faltar: un API viejo no lo
   * manda, y en ese caso se trata como elegible para no romper la pantalla
   * durante un despliegue parcial. La puerta real está en el servidor.
   */
  availability?: VerticalAvailability;
}

export type VerticalDefinitions = Record<string, VerticalCatalogSubType[]>;

/**
 * Fail closed when the API serves an incomplete or malformed catalog. Both
 * onboarding and the administrative tenant editor use this same boundary so a
 * partial deployment cannot silently expose different vertical choices.
 */
export function isCanonicalVerticalCatalog(value: unknown): value is VerticalDefinitions {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length !== CANONICAL_VERTICAL_COUNT) return false;

  return entries.every(([industry, subTypes]) => (
    industry.length > 0
    && Array.isArray(subTypes)
    && subTypes.every((subType) => {
      if (!subType || typeof subType !== "object" || Array.isArray(subType)) return false;
      const candidate = subType as Record<string, unknown>;
      const label = candidate.label as Record<string, unknown> | undefined;
      return typeof candidate.key === "string"
        && candidate.key.length > 0
        && Boolean(label)
        && typeof label?.es === "string"
        && label.es.length > 0;
    })
  ));
}

export function getVerticalLabel(
  subType: VerticalCatalogSubType,
  locale: VerticalCatalogLocale,
): string {
  return subType.label[locale] || subType.label.es || subType.key;
}

/**
 * Los subtipos que esta superficie puede OFRECER.
 *
 * `keep` es el subtipo que el tenant ya tiene: se conserva aunque haya dejado
 * de ofrecerse, porque si no, su propia pantalla no sabría cómo llamarlo y el
 * primer guardado lo cambiaría por otra cosa. Cerrar la puerta a las altas
 * nuevas no es migrar a nadie en silencio.
 */
export function offerableSubTypes(
  subTypes: VerticalCatalogSubType[],
  allowed: readonly VerticalAvailability[],
  keep?: string | null,
): VerticalCatalogSubType[] {
  return subTypes.filter((subType) => {
    if (keep && subType.key === keep) return true;
    // Sin dato, elegible: un API anterior a este campo no puede dejar el
    // selector vacío y bloquear todas las altas.
    if (!subType.availability) return true;
    return allowed.includes(subType.availability);
  });
}

/**
 * Hide an industry when every one of its subtypes is closed on this surface.
 * The API intentionally returns waitlist/legacy entries for compatibility; an
 * empty-looking industry in onboarding would still be a misleading offer.
 */
export function offerableIndustries(
  definitions: VerticalDefinitions,
  allowed: readonly VerticalAvailability[],
  keepIndustry?: string | null,
  keepSubtype?: string | null,
): string[] {
  return Object.keys(definitions).filter((industry) => {
    if (keepIndustry && industry === keepIndustry) return true;
    const subTypes = definitions[industry] || [];
    if (subTypes.length === 0) return true;
    return offerableSubTypes(
      subTypes,
      allowed,
      keepIndustry === industry ? keepSubtype : undefined,
    ).length > 0;
  });
}

/** Lo que puede elegir cualquiera en un alta. */
export const SIGNUP_AVAILABILITY: readonly VerticalAvailability[] = ["selectable"];
/** Un super_admin además puede poner a un tenant en un piloto. */
export const ADMIN_CREATE_AVAILABILITY: readonly VerticalAvailability[] = ["selectable", "pilot"];
