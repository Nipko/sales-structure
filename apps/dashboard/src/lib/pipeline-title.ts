import { resolveNavigationDisplayLabel, type NavigationLabelOverrides } from "./navigation-contract";

/**
 * The title of the sales pipeline page.
 *
 * It used to come from the vertical's `pipelineNoun`, a different word from the
 * one the menu shows for the same screen. For a salon the noun was "citas", so
 * the entry called "Oportunidades" opened a page titled "Citas" — next to the
 * real appointments screen. The menu label is now the single source: the title
 * is whatever the menu calls this page, and the noun is only the fallback for a
 * business whose menu has no entry for it.
 */
export function pipelinePageTitle(
  pipelineNoun: string,
  locale: string,
  overrides?: NavigationLabelOverrides | null,
): string {
  const fallback = pipelineNoun.charAt(0).toUpperCase() + pipelineNoun.slice(1);
  return resolveNavigationDisplayLabel("pipeline", fallback, locale, overrides);
}
