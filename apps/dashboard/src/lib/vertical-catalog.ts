export const CANONICAL_VERTICAL_COUNT = 18;

export type VerticalCatalogLocale = "es" | "en" | "pt" | "fr";

export interface VerticalCatalogLabel {
  es: string;
  en?: string;
  pt?: string;
  fr?: string;
}

export interface VerticalCatalogSubType {
  key: string;
  label: VerticalCatalogLabel;
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
