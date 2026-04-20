---
name: Critical Booking Flow Refactor
description: The booking flow MUST be refactored to deterministic backend control — LLM cannot be trusted with flow decisions
type: feedback
originSessionId: d5aaa220-582d-4f39-aed4-0a7831ce3013
---
## Problem (April 20, 2026)
After 10+ iterations trying to make the LLM follow booking instructions, it still:
- Asks for service when it already knows
- Asks for email before the customer chose a time
- Doesn't follow the state machine instructions
- Loops infinitely asking the same questions
- The fuzzy matching picked wrong service

## Root cause
We're trying to control a non-deterministic system (LLM) with text instructions.
LLMs are unreliable for flow control regardless of prompt quality.

## Required solution: DETERMINISTIC BOOKING ENGINE
The backend must control 100% of the booking flow:

1. Backend receives message
2. Backend analyzes intent (NLP or simple keyword match)
3. Backend decides what to do next (NOT the LLM)
4. Backend calls tools directly when needed
5. Backend constructs the response template
6. LLM ONLY fills in natural language phrasing — it does NOT decide the flow

Example:
```
State: has_service + has_date → Backend calls check_availability directly
→ Gets slots → Backend builds: "Tenemos estos horarios: {slots}. ¿Cuál prefieres?"
→ LLM polishes the phrasing but the CONTENT is fixed
```

## Also needed
- The bot should be cordial and human-like — ask the customer's name early
- The persona personality should show in every response
- Don't jump straight to business — build rapport first

**Why:** 10+ code iterations failed because we trusted the LLM with decisions.
**How to apply:** Build a deterministic booking engine. LLM is the voice, not the brain.
