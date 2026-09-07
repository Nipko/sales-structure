# Operational version and effect boundary audit

Date: 2026-09-07. Read-only production-code inspection; the companion PostgreSQL probe uses only a disposable schema and synthetic rows. This is an implementation review, not a claim that publication is safe to expose.

## Conclusion

An outer `agent_personas FOR SHARE` or tenant row guard around `executor.execute()` is insufficient. A canonical database effect must validate the served agent ID, operational version, configuration hash and active state **using the transaction/query that commits that effect**. Keep its row lock until commit. Publication then either waits for the old effect to finish or wins first and causes the old effect to fail before writing.

Do not hold an outer transaction while invoking a handler that opens a different connection. Losing the outer transaction does not cancel the handler. Reacquiring a shared advisory gate on a different connection is also unsafe when a publisher is already queued for the exclusive gate.

For the first bounded implementation, pass a server-only authority object down to the canonical appointment, gym, education, repair and catalog commands. Acquire and validate the agent row inside each effect transaction before domain rows. Preserve human API and isolated evaluation semantics explicitly. A tenant-wide advisory gate is useful only if both runtime commands and every operational configuration writer adopt it before all other locks; it cannot repair a wrapper whose callback runs elsewhere.

## Lock evidence

`agent-publication-lock-probe.cjs` passed all six disposable PostgreSQL cases:

1. Outer tenant `FOR SHARE` blocks a nested handler's tenant `UPDATE` on another connection (`55P03`).
2. Outer agent `FOR SHARE`, publisher tenant `FOR UPDATE` then agent `FOR UPDATE`, and nested handler tenant `UPDATE` form an application wait cycle. PostgreSQL sees two waiting queries but cannot see that the outer holder awaits the handler.
3. A dedicated exclusive advisory gate acquired by publication **before tenant rows** lets an already admitted handler finish.
4. Nested shared advisory acquisition on another connection waits behind a queued exclusive publisher (`55P03`), even when the outer caller owns the shared lock.
5. After the outer guard is lost, a delayed callback can commit an effect for version 8 while the agent is version 9.
6. A version check in the effect transaction rejects that stale operation with no insert.

The probe checks PostgreSQL lock semantics, not every production service or Prisma cancellation behavior. All SQL statements are separate. It requires `PARALLLY_ISOLATION_TEST_URL` pointing at the approved loopback `parallly_eval_isolation` database and removes only its own generated schema.

## Reachable tenant-row mutations within tool work

| Path | Evidence | Lock consequence |
| --- | --- | --- |
| MCP `listServers()` | `mcp-client.service.ts:83–120` awaits lazy secret rewrap; `persistRewrappedHeaders()` calls `mutateTenantSettingsBranchAtomic()` | The helper opens another transaction and locks `public.tenants FOR UPDATE`. Tool discovery and execution read server settings. |
| Ecommerce `decryptConfig()` | `ecommerce.service.ts:478–510` awaits compatible-secret rewrap; `persistRewrappedSecrets()` uses the same branch helper | Runtime provider configuration reads can need the tenant row. |
| Vertical integrations `decryptSecrets()` | `vertical-integrations.service.ts:302–340` starts asynchronous rewrap; `persistRewrappedSecrets()` uses the leaf helper | Background mutation may wait for tenant row. It is not awaited by decrypt, unlike MCP/ecommerce, so it is not by itself the same synchronous wait cycle. |
| Tenant payments configuration/credential rewrap | `tenant-payments.service.ts:672`, `1970–2084` lock provider and tenant configuration | Explicit administration/rotation paths. `readStoredConfig()` and runtime credential resolution do not automatically call the rewrap writer; do not count it as a proven nested writer merely because it exists. |
| Operating currency | `operating-currency.service.ts` locks tenant in configuration and `recordTransactionalAmount()` | No production caller of `recordTransactionalAmount()` was found. This is a potential boundary, not evidence that every commercial tool locks tenant for currency. |

The helpers in `common/utils/tenant-settings-branch.util.ts` and `tenant-settings.util.ts` perform independent Prisma transactions. Plain tenant `UPDATE` also acquires a row lock even without an explicit `FOR UPDATE` query.

## Operational configuration writers requiring coordination

| Writer | Current behavior/order |
| --- | --- |
| New `AgentPublicationStore` primitive | Privacy shared gate → tenant `FOR UPDATE` → request-idempotency advisory → agent `FOR UPDATE` → reviewed candidate/source locks. Not yet a public endpoint. |
| `PersonaService.updateAgent()` | Tenant `FOR UPDATE` → agent `FOR UPDATE`, CAS deactivation and version increment. |
| `PersonaService.deleteAgent()` | Separate direct update deactivates, clears assignments and increments version. No common publication gate. |
| `PersonaService.createAgent()` | Separate statements unassign previous defaults/channels/bindings, increment displaced channel/binding versions, insert new agent. Clearing `is_default` does not increment its previous owner's version. This is not one atomic routing transition. |
| Persona migration/default creation | `listAgents()` can migrate legacy config into an active default; `createDefaultAgentFromGoals()` inserts an active default. These creation boundaries remain separate from reviewed publication. Legacy `persona_config` internal writes are another fallback configuration source. |
| Assist account hours | `AgentConfigurationService.apply()`: proposal row → tenant row → settings and all agent versions. The proposal-first order matters if future publication locks related proposals. |
| Tenant hours settings | Tenant update → increment all agent versions. |
| Vertical bootstrap/migration | `patchDefaultAgent`, `enableSimpleTool`, `disableSimpleTool`, `restoreAppointmentsTool` lock selected/all active agent rows and increment versions. Some run in a supplied migration transaction; standalone paths open their own transaction. Migration takes tenant first. |
| Channel disconnection | Provider/account deactivation followed by direct agent binding removal and version increment; external disconnection is not atomic with the agent update. |

Search covered writes to `agent_personas` and its version, active/default/channel/config fields. It does **not** imply that agent version represents every runtime dependency. Plan/entitlement changes, provider/tool approvals, vertical configuration, knowledge/catalog changes and learning releases have independent authority/version boundaries. `LearningService` uses an agent shared row lock while publishing learning data but does not bump the agent configuration version.

## Approval and continuation race

`AiToolExecutorService.execute()` accepts a `draftScope` only for draft review; normal authority has no universally required served version/hash. `ToolExecutionControlService.preflight()` owns a short privacy transaction. Its ledger lease validates active agent/version only when `request_payload.draftReview` exists, and that transaction ends before the handler starts. `complete()` cannot undo a domain effect already committed under changed configuration.

`ToolApprovalWorkflowService` claims a ticket/ledger, reloads the current persona and capabilities, and checks exact version only for `claim.draftReview`. It then calls the executor without an operational version token. Publication can win between that read/preflight and the effect. Ordinary confirmation/resume must preserve the original trusted version and hash in durable metadata; reloading today's permissions does not authorize silently replaying yesterday's proposal under another version. Mission-focus/proposal identity guards protect consent referents but do not replace the operational configuration boundary.

## Effects outside the main executor

* `ConversationsService` sends WhatsApp Flow forms (`sendFlow`, engine dispatch around 2751), payment links, product media and normal replies through outbound queues after generation. Flow tokens constrain proposal/response identity, not a universal served configuration revision.
* Handoff occurs at pre-generation keyword checks, deterministic booking/procedure branches, after intake and after tool/LLM output. Several paths invoke `HandoffService.executeHandoff()` directly. A main-executor-only fence cannot cover these actions.
* `ToolApprovalEffectsService.deliver()` has durable effects, privacy/tenant guards, leases and reconciliation states, but it does not universally revalidate the original operational version. It sends media/payment messages or canonical handoff after the domain operation, through separate jobs.
* Operational notices, calendar synchronization, provider payment requests, widget delivery and learned-memory extraction have their own transactions/jobs. Effects already accepted by a provider must retain that fact; configuration publication is not a cancellation or refund.

A follow-up for these boundaries needs explicit durable intent, idempotency, dispatch authorization and post-provider reconciliation. Do not hold a long transaction around arbitrary network work and describe the result as atomic publication safety. Do not silently drop a delivery that is part of an already committed business operation.

## Implementable lock order and rollout

1. First add a typed server-only served-authority port, passed outside model/tool arguments and outside HTTP DTOs. Bind tenant/schema, agent ID, operational version and canonical configuration hash. Distinguish human commands and isolated sessions without granting either a model-controlled bypass.
2. In each existing canonical effect transaction, take the agent row lock and compare all authority fields **before any domain row mutation**. Keep the same query throughout the canonical command. Helpers must never open a second transaction to guard this one.
3. Keep network calls, secret rewrap, DDL preparation and ordinary reads outside that short command transaction. If a command also needs tenant locking, take tenant before agent using the same query and align publication; inspect each family before wiring. Do not wrap the entire executor in an agent lock.
4. If a dedicated advisory gate is added later, acquire it first in both commands and publication: operational gate → privacy gate → tenant row if needed → sorted agent rows → domain/source/ledger rows. Publication must not hold privacy/tenant rows while waiting on the operational gate. No nested gate reacquisition on another connection.
5. Add concurrent tests per family: effect admitted first delays publication; publication/deactivation first rejects stale effect; stale hash at equal version rejects; rollback releases the lock; human and evaluation routes preserve their explicit semantics. Include approval replay provenance tests separately.
6. Keep publication unexposed until all intended effects and operational writers participate or the unsupported scope is rejected explicitly. Initial canonical database coverage must not be advertised as coverage of all tools or external deliveries.
