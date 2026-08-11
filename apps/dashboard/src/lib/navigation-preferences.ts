import { getNavigationRoute, resolveNavigationRoute } from "./navigation-contract";

export const MAX_NAVIGATION_FAVORITES = 8;
export const MAX_NAVIGATION_RECENTS = 6;

export interface RecentNavigationEntry {
  routeId: string;
  href: string;
  visitedAt: number;
}

export interface NavigationPreferences {
  favorites: string[];
  recents: RecentNavigationEntry[];
}

export const EMPTY_NAVIGATION_PREFERENCES: NavigationPreferences = {
  favorites: [],
  recents: [],
};

export function sanitizeNavigationPreferences(value: unknown): NavigationPreferences {
  if (!value || typeof value !== "object") return EMPTY_NAVIGATION_PREFERENCES;
  const source = value as Partial<NavigationPreferences>;
  const favorites = Array.isArray(source.favorites)
    ? Array.from(new Set(
        source.favorites.filter(
          (item): item is string => {
            if (typeof item !== "string" || item.length === 0) return false;
            const definition = getNavigationRoute(item);
            return Boolean(definition && definition.discoverable !== false);
          },
        ),
      )).slice(0, MAX_NAVIGATION_FAVORITES)
    : [];
  const recents = Array.isArray(source.recents)
    ? source.recents
        .filter((item): item is RecentNavigationEntry => {
          if (!item
            || typeof item.routeId !== "string"
            || typeof item.href !== "string"
            || !item.href.startsWith("/admin")
            || !Number.isFinite(item.visitedAt)) return false;
          const definition = getNavigationRoute(item.routeId);
          const resolved = resolveNavigationRoute(item.href);
          return Boolean(
            definition
            && definition.discoverable !== false
            && resolved?.definition.id === definition.id,
          );
        })
        .slice(0, MAX_NAVIGATION_RECENTS)
    : [];
  return { favorites, recents };
}
