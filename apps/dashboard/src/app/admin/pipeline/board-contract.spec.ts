import { readFileSync } from "fs";
import { resolve } from "path";
import { MULTI_PIPELINE_BOARD_READY, opportunityMoveRequest } from "./board-contract";

const page = readFileSync(resolve(__dirname, "page.tsx"), "utf8");

describe("pipeline board drag (the board holds opportunities, not deals)", () => {
  it("builds the opportunity move request regardless of any pipeline", () => {
    const move = opportunityMoveRequest("t1", "opp1", "calificado");
    expect(move.path).toBe("/crm/kanban/t1/opp1/move");
    expect(move.init).toEqual({ method: "PUT", body: JSON.stringify({ stage: "calificado" }) });
  });

  it("the drop handler always uses it, even when pipelines exist (no deals-route branch)", () => {
    expect(page).toMatch(/opportunityMoveRequest\(activeTenantId, draggedDeal, stage\.id\)/);
    expect(page).not.toMatch(/\/pipeline\/deals\/\$\{activeTenantId\}\/\$\{draggedDeal\}\/move/);
    expect(page).not.toMatch(/if \(activePipelineId\) \{\s*await api\.fetch/);
  });

  it("keeps the pipeline tabs and the list request off until the board is pipeline-aware", () => {
    expect(MULTI_PIPELINE_BOARD_READY).toBe(false);
    expect(page).toMatch(/MULTI_PIPELINE_BOARD_READY && pipelines\.length > 0/);
    expect(page).toMatch(/if \(!MULTI_PIPELINE_BOARD_READY\) \{[\s\S]{0,400}return;/);
  });
});
