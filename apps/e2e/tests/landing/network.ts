import { expect, type Page } from "@playwright/test";

export type LandingNetworkState = {
  productionApiRequests: string[];
};

export async function isolateLandingFromProduction(
  page: Page,
): Promise<LandingNetworkState> {
  const state: LandingNetworkState = { productionApiRequests: [] };

  page.on("request", (request) => {
    if (new URL(request.url()).hostname === "api.parallly-chat.cloud") {
      state.productionApiRequests.push(request.url());
    }
  });

  await page.route(/^https:\/\/api\.parallly-chat\.cloud\/.*/, (route) =>
    route.abort("blockedbyclient"),
  );
  await page.route(
    "http://127.0.0.1:3999/api/v1/billing/public/plans?**",
    (route) =>
      route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ success: true, data: [] }),
      }),
  );

  return state;
}

export async function expectNoProductionApiRequests(
  state: LandingNetworkState,
): Promise<void> {
  await expect.poll(() => state.productionApiRequests).toEqual([]);
}
