---
id: centro-calidad-agente
title: "Agent quality center"
routes: ["/admin/agent/quality"]
roles: ["tenant_admin", "tenant_supervisor"]
keywords: ["quality center", "agent quality", "preparation", "tested quality", "production evidence", "agent at risk", "ready for pilot", "configuration incomplete", "review required", "recommendations", "agent weaknesses", "improve agent"]
---

# Agent quality center

The **Quality center** shows what still needs configuration, what has been tested,
and what is happening in real conversations for each AI agent. Find it under
**Insights → Quality center**. Admins and Supervisors can read it; only Admins can
edit agents, connections, or configuration under **AI & Growth → AI Agent**.

## The three evidence layers

- **Preparation:** checks business and scope, knowledge, conversation and brand,
  actions, safety and handoff, and operational robustness. A capability outside the
  agent's scope can be **Not applicable** and does not lower the result.
- **Tested quality:** shows the latest critical evaluation and simulation, including
  version, date, threshold, and scenarios. Earlier evidence can become outdated when
  the agent changes. It is automated evidence, not a certification.
- **Production:** uses real interactions attributed to the agent and its version. It
  keeps verified resolution, observed conversational quality, handoffs, tool failures,
  and knowledge gaps separate. When the sample is still too small, the result is
  **Insufficient evidence**, not zero.

Historical evidence that does not identify the agent unambiguously is not assigned
retroactively. A newly published version may therefore need new interactions before
it has a useful production signal.

## How to interpret the status

- **Not evaluated yet:** there is not enough evidence yet.
- **Configuration incomplete:** a requirement is missing or preparation has a warning.
- **Agent at risk:** a critical test or important real signal needs review.
- **Ready for a controlled pilot:** preparation and tests support limited use, but
  real-world evidence is still insufficient.
- **Operating with evidence:** configuration, current tests, and a useful production
  sample are available.
- **Review required:** evidence became outdated or recent performance deteriorated.

No status means the agent is perfect, certifies its operation, or guarantees business
results.

## What to improve first

Open Critical and High recommendations first. Each identifies the affected pillar and
dimension and, when available, how many scenarios or interactions produced the signal.
Use them to distinguish among:

- **Strengthen knowledge:** information is missing or the source was not retrieved.
- **Adjust behavior:** the information existed, but the agent asked, explained,
  refused, or handed off incorrectly.
- **Repair a capability:** a tool, connection, policy, approval, or human route failed.

The Quality center does not automatically rewrite prompts, policies, or content. An
Admin makes the change, reruns the tests, and checks whether new evidence confirms the
improvement; a Supervisor can review results and coordinate follow-up.

## Frequently asked questions

**Is the setup checklist the same as the Quality center?**
No. The checklist guides initial adoption. The center adds repeatable tests and
attributed production evidence.

**Is a strong simulation score enough to publish?**
No. It helps reduce risk, but review it together with critical blockers, version
freshness, and real evidence when available.

**Does the system learn and change itself after every conversation?**
No. Interactions create diagnostics and recommendations; a person reviews and
approves any change before it is tested again.
