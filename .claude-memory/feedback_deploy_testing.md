---
name: Always deploy to test
description: User never tests locally, always deploys to production server first
type: feedback
---

Never test locally — always push and deploy to production to test.

**Why:** User prefers to test on real production environment rather than running locally.

**How to apply:** Don't suggest "test locally first". Ensure deploy pipeline and Docker builds are correct before pushing. Check Docker-specific issues (missing packages, env vars, network) proactively.
