/**
 * What the pipeline page's board really is.
 *
 * The board is the OPPORTUNITIES board (`GET /crm/kanban/:tenant`): every card id
 * is an opportunity id and every column key a stage slug. It is not pipeline
 * aware, so the multi-pipeline tabs cannot change what it shows, and a drag must
 * always go through the opportunity route. Moving a card through
 * `PUT /pipeline/deals/:tenant/:id/move` (the DEALS system) with an opportunity
 * id answers "Deal not found" - which is what every drag did the moment the
 * pipelines list started returning the auto-seeded primary pipeline.
 *
 * Flip `MULTI_PIPELINE_BOARD_READY` only together with a pipeline-aware board.
 */
export const MULTI_PIPELINE_BOARD_READY = false;

export function opportunityMoveRequest(tenantId: string, opportunityId: string, stageKey: string) {
  return {
    path: `/crm/kanban/${tenantId}/${opportunityId}/move`,
    init: { method: "PUT", body: JSON.stringify({ stage: stageKey }) },
  };
}
