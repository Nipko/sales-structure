import { buildDemoLinkUrl, buildWidgetSnippet, widgetLoaderUrl } from "./widget-snippet";

/**
 * The snippet is pasted into websites this side cannot edit afterwards, so its
 * shape is a contract: the global before the loader, the loader async, and the
 * same `loader.js` the public page injects. The link is the origin the person
 * is already on plus the path the API returned — nothing else decides it.
 */
describe("the web chat snippet", () => {
  const api = "https://api.example.test/api/v1";

  it("is the global, then the async loader, on the API the dashboard points at", () => {
    expect(buildWidgetSnippet("wgt_abc123", api)).toBe(
      "<script>\n  window.__paralllyWidget = { widgetId: 'wgt_abc123' };\n</script>\n" +
      `<script async src="${api}/widget/loader.js"></script>`,
    );
  });

  it("carries exactly two script tags and the shared loader URL", () => {
    const snippet = buildWidgetSnippet("wgt_abc123", api);
    expect(snippet.match(/<script/g)).toHaveLength(2);
    expect(snippet).toContain(widgetLoaderUrl(api));
  });
});

describe("the public link", () => {
  it("is the given origin plus the path setup-status returned", () => {
    expect(buildDemoLinkUrl("/w/wgt_abc123", "https://admin.example.test")).toBe(
      "https://admin.example.test/w/wgt_abc123",
    );
  });

  it("has no origin on the server, and never invents one", () => {
    // `window` does not exist in the node project; the default origin must
    // come out empty rather than throw or fall back to a hardcoded host.
    expect(buildDemoLinkUrl("/w/wgt_abc123")).toBe("/w/wgt_abc123");
  });
});
