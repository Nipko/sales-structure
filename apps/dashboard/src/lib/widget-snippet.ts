/**
 * The web chat, in the two forms a business hands out.
 *
 * - The SNIPPET: the two lines that put the chat on a website. The settings
 *   page, the setup wizard and the channels overview all copy it, and three
 *   inline copies drift — the first version already had two spellings (one
 *   with newlines, one without). One builder, one string.
 * - The LINK: the public page every agent gets at `/w/<widgetId>` on the
 *   dashboard's own origin. `setup-status` returns the PATH, never a full URL,
 *   so the origin is always the one the person is already looking at and no
 *   `NEXT_PUBLIC_*` variable has to agree with it.
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL || "";

/** Where the loader lives. Same script for the snippet and for the public page. */
export function widgetLoaderUrl(apiUrl: string = API_URL): string {
  return `${apiUrl}/widget/loader.js`;
}

/**
 * The embed snippet, exactly as the web-chat settings page has always built it:
 * the global first, then the async loader. Kept byte-identical on purpose —
 * these lines end up pasted into sites nobody on this side can edit later.
 */
export function buildWidgetSnippet(widgetId: string, apiUrl: string = API_URL): string {
  return `<script>\n  window.__paralllyWidget = { widgetId: '${widgetId}' };\n</script>\n<script async src="${widgetLoaderUrl(apiUrl)}"></script>`;
}

/**
 * The absolute public link: the dashboard's origin plus the path setup-status
 * returned. On the server there is no origin; callers only render this after
 * the setup-status read, which is client-side, so in practice it is complete.
 */
export function buildDemoLinkUrl(
  path: string,
  origin: string = typeof window === "undefined" ? "" : window.location.origin,
): string {
  return `${origin}${path}`;
}
