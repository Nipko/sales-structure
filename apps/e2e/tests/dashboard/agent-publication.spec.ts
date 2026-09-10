import { expect, test, type Page } from "@playwright/test";
import { dashboardShell } from "../../fixtures/dashboard-routes";
import {
  expectHermetic,
  hermeticDashboard,
  ok,
  settled,
  signIn,
  type ApiRoutes,
  type HermeticState,
} from "../../fixtures/dashboard-session";

/**
 * Publishing a configuration, and taking it back, from the browser.
 *
 * This is the one screen in the product where a click changes what a real
 * customer will be answered by, and the only one whose "undo" is itself a
 * publication. The transaction is proven against PostgreSQL elsewhere
 * (`agent-publication-walk.postgres.spec.ts`, which walks controller → service
 * → store → the next turn). What a browser has to settle is the other half:
 *
 *   · that the decision is never one click — the consequence is spelled out in
 *     this specific case, with the version number it will produce, before
 *     anything is sent;
 *   · that what leaves the page is exactly what the page just read, since every
 *     request here is compare-and-swap and a value remembered from a minute ago
 *     is precisely what the server exists to refuse;
 *   · that a conflict is not shown as a generic failure but stops offering the
 *     action and asks for a reload — a recoverable error, recovered;
 *   · that the rollback offers itself only when it can actually succeed, and
 *     names the publication it undoes.
 *
 * The API is declared, not run: an undeclared call fails the test rather than
 * being quietly stubbed. Nothing here reaches a model, a provider or a network.
 */

const TENANT = "33333333-3333-4333-8333-333333333333";
const AGENT = "77777777-7777-4777-8777-777777777777";
const CANDIDATE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PUBLICATION = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const OPERATIONAL_HASH = "1".repeat(64);
const PUBLISHED_HASH = "2".repeat(64);
const EVIDENCE_HASH = "3".repeat(64);
const REQUESTER = "22222222-2222-4222-8222-222222222222";

/** What the editor says is serving right now. */
const workspace = (version: number, hash: string) => ok({
  agentId: AGENT,
  operational: {
    version, hash,
    body: {
      name: "Laura Sofía", configJson: { persona: { name: "Laura Sofía" } },
      channels: ["whatsapp"], channelBindings: ["whatsapp:wa-main"],
      scheduleMode: "24_7", isActive: true, isDefault: true,
    },
  },
  draft: null,
  evaluationRevisionId: null,
});

/** The publication history: what is serving, and what it replaced. */
const publications = (head: Record<string, unknown> | null, version: number) => ok({
  agentId: AGENT,
  operationalVersion: version,
  head,
  events: head
    ? [{
      id: PUBLICATION, kind: "publish", candidateId: CANDIDATE, rollbackOf: null,
      baseVersion: version - 1, operationalVersion: version,
      beforeHash: OPERATIONAL_HASH, afterHash: PUBLISHED_HASH, evidenceHash: EVIDENCE_HASH,
      requestedBy: REQUESTER, createdAt: "2026-09-09T14:00:00.000Z",
    }]
    : [],
});

const publishedHead = {
  id: PUBLICATION, kind: "publish", operationalVersion: 8,
  operationalHash: PUBLISHED_HASH, createdAt: "2026-09-09T14:00:00.000Z",
};

const approvedCandidate = (overrides: Record<string, unknown> = {}) => ok({
  id: CANDIDATE, agentId: AGENT, configurationRevisionId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  status: "approved", version: 2, revisionState: "current",
  channels: ["whatsapp"], createdAt: "2026-09-09T13:00:00.000Z", error: null,
  evaluations: [{ id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", channel: "whatsapp", status: "completed",
    attempts: 1, error: null, runId: null, nextAttemptAt: null, completedScenarios: 8 }],
  review: { evidenceHash: EVIDENCE_HASH, eligibleForReview: false, sampleHashes: [], samples: [] },
  activationAllowed: false, certified: false,
  ...overrides,
});

const routes = (extra: ApiRoutes = {}): ApiRoutes => ({
  ...dashboardShell(TENANT),
  [`persona/${TENANT}/agents/${AGENT}/configuration`]: workspace(7, OPERATIONAL_HASH),
  [`agent-publications/${TENANT}/agents/${AGENT}`]: publications(null, 7),
  [`agent-releases/${TENANT}/agents/${AGENT}/${CANDIDATE}`]: approvedCandidate(),
  [`agent-releases/${TENANT}/agents/${AGENT}`]: ok([
    { id: CANDIDATE, configurationRevisionId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
      status: "approved", version: 2, error: null, createdAt: "2026-09-09T13:00:00.000Z" },
  ]),
  ...extra,
});

async function openPublications(page: Page, extra: ApiRoutes = {}): Promise<HermeticState> {
  const state = await hermeticDashboard(page, routes(extra));
  await signIn(page, "tenant_admin");
  await page.goto(`/admin/agent/${AGENT}/publications`);
  await settled(page);
  await expect(page.getByRole("heading", { name: "Publicar la configuración del agente" })).toBeVisible();
  return state;
}

/** Captures the publish request and answers it, without going near the API. */
async function interceptPublish(page: Page, reply: (body: any) => { status: number; body: unknown }) {
  const sent: Array<{ url: string; body: any }> = [];
  await page.route(`**/api/v1/agent-publications/${TENANT}/agents/${AGENT}/candidates/*`, async (route) => {
    const body = route.request().postDataJSON();
    sent.push({ url: route.request().url(), body });
    const answer = reply(body);
    await route.fulfill({ status: answer.status, contentType: "application/json", body: JSON.stringify(answer.body) });
  });
  return sent;
}

async function interceptRollback(page: Page, reply: (body: any) => { status: number; body: unknown }) {
  const sent: Array<{ url: string; body: any }> = [];
  await page.route(`**/api/v1/agent-publications/${TENANT}/agents/${AGENT}/rollback`, async (route) => {
    const body = route.request().postDataJSON();
    sent.push({ url: route.request().url(), body });
    const answer = reply(body);
    await route.fulfill({ status: answer.status, contentType: "application/json", body: JSON.stringify(answer.body) });
  });
  return sent;
}

test.describe("publicar la configuración del agente, y volver atrás", () => {
  test("no publica de un solo clic: dice qué va a pasar y con qué versión", async ({ page }) => {
    const state = await openPublications(page);

    // Lo que está atendiendo, antes de decidir nada.
    await expect(page.getByText("Versión operativa")).toBeVisible();
    await expect(page.getByText("Todavía no hay ninguna publicación registrada.")).toBeVisible();

    await page.getByRole("button", { name: "Publicar este candidato" }).click();

    // La consecuencia concreta, con el número de versión que va a quedar, y no
    // un "¿estás seguro?".
    const confirm = page.getByRole("group", { name: "Confirmar la publicación" });
    await expect(confirm).toBeVisible();
    await expect(confirm).toContainText("versión 8");
    await expect(confirm).toContainText("atiende a tus clientes");

    // Y todavía no se mandó nada.
    expect(state.writes.filter((entry) => entry.includes("agent-publications"))).toEqual([]);

    // Cancelar deja la pantalla como estaba.
    await confirm.getByRole("button", { name: "Cancelar" }).click();
    await expect(confirm).toBeHidden();
    expect(state.writes.filter((entry) => entry.includes("agent-publications"))).toEqual([]);
    await expectHermetic(state);
  });

  test("manda exactamente lo que la pantalla acababa de leer", async ({ page }) => {
    // El contrato de la pantalla con el servidor: versión y huella salen de la
    // MISMA lectura. Mandar una versión de ahora y una huella de hace un minuto
    // es justo la expectativa vencida que el CAS existe para rechazar.
    const state = await hermeticDashboard(page, routes());
    const sent = await interceptPublish(page, () => ({
      status: 200,
      body: { success: true, data: { id: PUBLICATION, agentId: AGENT, kind: "publish",
        operationalVersion: 8, operationalHash: PUBLISHED_HASH, idempotentReplay: false } },
    }));
    await signIn(page, "tenant_admin");
    await page.goto(`/admin/agent/${AGENT}/publications`);
    await settled(page);

    await page.getByRole("button", { name: "Publicar este candidato" }).click();
    await page.getByRole("group", { name: "Confirmar la publicación" })
      .getByRole("button", { name: "Publicar", exact: true }).click();

    await expect.poll(() => sent.length, { timeout: 20_000 }).toBe(1);
    expect(sent[0].url).toContain(`/candidates/${CANDIDATE}`);
    expect(sent[0].body).toMatchObject({
      expectedOperationalVersion: 7,
      expectedOperationalHash: OPERATIONAL_HASH,
      expectedCandidateVersion: 2,
      evidenceHash: EVIDENCE_HASH,
      activation: "preserve",
    });
    // Y una clave de solicitud propia, que es lo que hace idempotente un doble clic.
    expect(String(sent[0].body.requestKey)).toMatch(/^[0-9a-f-]{36}$/i);
    // Exactamente estas claves: el store rechaza una desconocida de plano.
    expect(Object.keys(sent[0].body).sort()).toEqual([
      "activation", "evidenceHash", "expectedCandidateVersion",
      "expectedOperationalHash", "expectedOperationalVersion", "requestKey",
    ]);
    expect(state.productionRequests).toEqual([]);
  });

  test("publicado: lo dice con la versión que quedó y vuelve a leer el estado", async ({ page }) => {
    // Después de publicar, la pantalla no puede seguir mostrando lo de antes:
    // los valores que tiene en memoria ya no describen lo que atiende.
    let published = false;
    const state = await hermeticDashboard(page, {
      ...dashboardShell(TENANT),
      [`persona/${TENANT}/agents/${AGENT}/configuration`]: () =>
        (published ? workspace(8, PUBLISHED_HASH) : workspace(7, OPERATIONAL_HASH)),
      [`agent-publications/${TENANT}/agents/${AGENT}`]: () =>
        (published ? publications(publishedHead, 8) : publications(null, 7)),
      [`agent-releases/${TENANT}/agents/${AGENT}/${CANDIDATE}`]: approvedCandidate(),
      [`agent-releases/${TENANT}/agents/${AGENT}`]: ok([
        { id: CANDIDATE, configurationRevisionId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
          status: "approved", version: 2, error: null, createdAt: "2026-09-09T13:00:00.000Z" },
      ]),
    });
    await interceptPublish(page, () => {
      published = true;
      return { status: 200, body: { success: true, data: { id: PUBLICATION, agentId: AGENT, kind: "publish",
        operationalVersion: 8, operationalHash: PUBLISHED_HASH, idempotentReplay: false } } };
    });
    await signIn(page, "tenant_admin");
    await page.goto(`/admin/agent/${AGENT}/publications`);
    await settled(page);

    await page.getByRole("button", { name: "Publicar este candidato" }).click();
    await page.getByRole("group", { name: "Confirmar la publicación" })
      .getByRole("button", { name: "Publicar", exact: true }).click();

    // El recibo, con el número.
    await expect(page.getByText("Publicado. La versión operativa quedó en 8.").last()).toBeVisible({ timeout: 20_000 });
    // El estado final, releído: la huella nueva y el historial con la fila.
    await expect(page.getByText("Publicación", { exact: false }).first()).toBeVisible();
    await expect(page.locator("table")).toContainText("7 → 8");
    await expect(page.getByText("Todavía no hay ninguna publicación registrada.")).toBeHidden();
    await expectHermetic(state);
  });

  test("un conflicto no es un fallo genérico: deja de ofrecer la acción y pide releer", async ({ page }) => {
    // El error recuperable. Alguien más movió la configuración mientras esta
    // persona miraba: seguir ofreciendo un botón construido con los valores de
    // pantalla sería ofrecer una decisión que ya no existe.
    const state = await hermeticDashboard(page, routes());
    const sent = await interceptPublish(page, () => ({
      status: 409,
      body: { error: "agent_operational_configuration_changed", statusCode: 409 },
    }));
    await signIn(page, "tenant_admin");
    await page.goto(`/admin/agent/${AGENT}/publications`);
    await settled(page);

    await page.getByRole("button", { name: "Publicar este candidato" }).click();
    await page.getByRole("group", { name: "Confirmar la publicación" })
      .getByRole("button", { name: "Publicar", exact: true }).click();

    await expect.poll(() => sent.length, { timeout: 20_000 }).toBe(1);
    // Se nombra la causa, no "algo salió mal".
    await expect(page.getByRole("alert").filter({ hasText: "Alguien más cambió esta configuración" }).first()).toBeVisible();
    // Y se pide releer antes de decidir de nuevo.
    await expect(page.getByText("Vuelve a cargarla antes de decidir", { exact: false })).toBeVisible();
    await expect(page.getByRole("button", { name: "Publicar este candidato" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Volver atrás", exact: true })).toBeDisabled();

    // La recuperación existe y funciona: recargar devuelve la pantalla al juego.
    await page.getByRole("button", { name: "Volver a cargar" }).click();
    await expect(page.getByRole("button", { name: "Publicar este candidato" })).toBeEnabled({ timeout: 20_000 });
    expect(sent).toHaveLength(1);
    expect(state.productionRequests).toEqual([]);
  });

  test("volver atrás nombra la publicación que deshace, y manda su identificador", async ({ page }) => {
    const state = await hermeticDashboard(page, {
      ...routes(),
      [`persona/${TENANT}/agents/${AGENT}/configuration`]: workspace(8, PUBLISHED_HASH),
      [`agent-publications/${TENANT}/agents/${AGENT}`]: publications(publishedHead, 8),
    });
    const sent = await interceptRollback(page, () => ({
      status: 200,
      body: { success: true, data: { id: "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee", agentId: AGENT,
        kind: "rollback", operationalVersion: 9, operationalHash: OPERATIONAL_HASH, idempotentReplay: false } },
    }));
    await signIn(page, "tenant_admin");
    await page.goto(`/admin/agent/${AGENT}/publications`);
    await settled(page);

    await page.getByRole("button", { name: "Volver atrás", exact: true }).click();
    const confirm = page.getByRole("group", { name: "Confirmar la vuelta atrás" });
    await expect(confirm).toBeVisible();
    // Nombra QUÉ deshace y con qué versión queda, y dice que el efecto es inmediato.
    await expect(confirm).toContainText(PUBLICATION.slice(0, 8));
    await expect(confirm).toContainText("versión 9");
    await expect(confirm).toContainText("de inmediato");

    await confirm.getByRole("button", { name: "Volver atrás", exact: true }).click();
    await expect.poll(() => sent.length, { timeout: 20_000 }).toBe(1);
    expect(sent[0].body).toMatchObject({
      expectedPublicationId: PUBLICATION,
      expectedOperationalVersion: 8,
      expectedOperationalHash: PUBLISHED_HASH,
    });
    expect(Object.keys(sent[0].body).sort()).toEqual([
      "expectedOperationalHash", "expectedOperationalVersion", "expectedPublicationId", "requestKey",
    ]);
    await expect(page.getByText("Se volvió atrás. La versión operativa quedó en 9.").last()).toBeVisible({ timeout: 20_000 });
    expect(state.productionRequests).toEqual([]);
  });

  test("no ofrece volver atrás cuando no hay a qué volver", async ({ page }) => {
    const state = await openPublications(page);
    // Sin publicaciones, el botón no se ofrece, y se dice por qué en vez de
    // dejar que la persona gaste un intento para enterarse.
    await expect(page.getByText("Todavía no hay ninguna publicación a la que volver.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Volver atrás", exact: true })).toBeDisabled();
    await expectHermetic(state);
  });

  test("no ofrece volver atrás si la configuración se movió desde la última publicación", async ({ page }) => {
    // El store compara UNA huella esperada contra la del head y contra la del
    // agente ahora. Si divergieron, ningún valor satisface las dos, y mandar la
    // solicitud igual sería ofrecer algo que no puede salir bien.
    const state = await hermeticDashboard(page, {
      ...routes(),
      [`persona/${TENANT}/agents/${AGENT}/configuration`]: workspace(8, "4".repeat(64)),
      [`agent-publications/${TENANT}/agents/${AGENT}`]: publications(publishedHead, 8),
    });
    await signIn(page, "tenant_admin");
    await page.goto(`/admin/agent/${AGENT}/publications`);
    await settled(page);

    await expect(page.getByText("La configuración operativa cambió después de la última publicación", { exact: false })).toBeVisible();
    await expect(page.getByRole("button", { name: "Volver atrás", exact: true })).toBeDisabled();
    expect(state.writes.filter((entry) => entry.includes("agent-publications"))).toEqual([]);
    await expectHermetic(state);
  });

  test("un candidato cuya evidencia dejó de describir el mundo no se puede publicar", async ({ page }) => {
    const state = await openPublications(page, {
      [`agent-releases/${TENANT}/agents/${AGENT}/${CANDIDATE}`]: approvedCandidate({ revisionState: "changed" }),
    });
    await expect(page.getByText("cambiaron después de aprobarlo", { exact: false })).toBeVisible();
    await expect(page.getByRole("button", { name: "Publicar este candidato" })).toBeDisabled();
    expect(state.writes.filter((entry) => entry.includes("agent-publications"))).toEqual([]);
    await expectHermetic(state);
  });

  test("una supervisora no llega a esta pantalla", async ({ page }) => {
    // La API deja a una supervisora leer el historial; esta pantalla es la
    // decisión, y la decisión es de administración. La regla de ruta la saca
    // antes de que la pantalla exista, así que no hay ni pantalla ni lecturas.
    const state = await hermeticDashboard(page, routes());
    await signIn(page, "tenant_supervisor");
    await page.goto(`/admin/agent/${AGENT}/publications`);
    await settled(page);
    await expect(page).not.toHaveURL(/publications/);
    await expect(page.getByRole("button", { name: "Publicar este candidato" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Volver atrás", exact: true })).toHaveCount(0);
    // Ni siquiera se leyó el historial de publicaciones de este agente.
    expect(state.observed.filter((path) => path.includes("agent-publications"))).toEqual([]);
    expect(state.writes.filter((entry) => entry.includes("agent-publications"))).toEqual([]);
  });
});
