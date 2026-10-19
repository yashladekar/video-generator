# Taste
- Expects end-to-end working software: real frontend, backend, database, background processing, and integrations wired together — not a plan, landing page, static dashboard, prototype, or set of disconnected endpoints. Explicitly says not to stop after a plan or UI design. Confidence: 0.7
- Prefers phased delivery where the application stays runnable at the end of each phase, with a working vertical slice before optional features. Confidence: 0.65
- Wants existing repository conventions, stack, and functional code reused rather than replaced unnecessarily. Confidence: 0.65
- When something is externally blocked (missing API keys, account permissions, uninstalled local services), expects the proper adapter, configuration flow, and actionable setup instructions to be implemented anyway, the blocker reported clearly, and the rest of the build to continue. Confidence: 0.65
- Strongly values honest status reporting: never claim a feature is implemented unless it actually works, never present mock or sample data as real results, clearly label sample data, and don't invent API endpoints or parameters. Confidence: 0.75
- Wants blockers, requirements, and trade-offs surfaced explicitly — e.g., explain the quality/cost trade-off before starting rather than silently degrading output, and state what remains unverified. Confidence: 0.6
- Prefers local-first / free processing as the default, with paid hosted providers as optional, interchangeable adapters behind a clean interface rather than hardcoded single-vendor calls. Confidence: 0.6
- Expects explicit cost accounting: estimated vs. actually recorded usage tracked separately, prices never invented, hard limits enforced in-app, and honest caveats about what the app can and cannot guarantee. Confidence: 0.6
- Resumes work by sending a bare "continue", meaning the agent should keep going autonomously through the remaining verification/polish/fix steps rather than stopping to ask for confirmation. Confidence: 0.5
