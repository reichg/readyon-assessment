# ReadyOn Time-Off Microservice

## Project Summary

This repository is the take-home submission workspace for the ReadyOn Time-Off Microservice.

The target system is a production-ready NestJS + SQLite backend that:

- exposes a REST API for balances and time-off requests;
- treats HCM as the source of truth for entitlement and final deduction state;
- keeps a local balance projection for fast reads and resilience;
- now uses a mock HCM in the automated test suite through an isolated test-only HTTP module; and
- proves correctness with focused Jest and Supertest coverage.

## Current Status

The repository now includes a validated Phase 5 mock HCM slice, an implemented Phase 6 balance API slice, and a completed Phase 7 time-off request lifecycle slice.

- `README.md` is present.
- `TRD.md` is present.
- `TEST_PLAN.md` is present.
- `package.json`, `src/`, and `test/` now exist as a runnable NestJS + Prisma + SQLite backend foundation.
- `src/hcm/` now includes a resettable in-memory mock HCM service; the app-facing balance refresh uses the same adapter against a deterministic in-process seed, and a dedicated test-only HTTP module covers the mock contract.
- `src/time-off/` now includes public balance read and refresh routes with ReadyOn-owned error mapping and focused integration and e2e coverage.
- `src/time-off/` now includes `POST /time-off-requests`, `GET /time-off-requests/:id`, `POST /time-off-requests/:id/approve`, and `POST /time-off-requests/:id/reject`, with approval-time HCM confirmation, local projection updates only after accepted HCM deductions, manager rejection without HCM deduction, create-time idempotency replay and conflict handling, and focused service, controller, and e2e coverage.
- `coverage/` is generated locally by `pnpm test:cov`.
- Domain behavior from later phases is still in progress.

## Submission Goal

The final submission must prove the following behaviors:

1. Employees can view accurate balances.
2. Employees can create time-off requests.
3. Managers can approve or reject requests.
4. ReadyOn validates balances before approval.
5. HCM is called before approved time off is committed locally.
6. Batch reconciliation corrects local drift.
7. HCM-side balance changes are reflected safely.
8. Invalid employee/location combinations fail cleanly.
9. Insufficient balance is handled deterministically.
10. Duplicate submissions and retries are idempotent.
11. Concurrent approvals do not overdraw balance.
12. Coverage proof is included.

## Reviewer Quick Start

### Current repository state

The fastest way to evaluate the repository today is:

1. Run `pnpm install`.
2. Run `pnpm build`, `pnpm lint`, `pnpm test`, `pnpm test:e2e`, and `pnpm test:cov`.
3. Read `TRD.md` for the chosen architecture, API contract, consistency model, and tradeoffs.
4. Read `TEST_PLAN.md` for the risk-driven validation strategy.
5. Use the checklist below to track delivery progress.

### Available scaffold commands

The following commands are available in the scaffold today. Later phases will extend the same command surface with domain behavior and broader coverage.

```bash
pnpm install
pnpm build
pnpm lint
pnpm test
pnpm test:e2e
pnpm test:cov
pnpm start:dev
```

## Phase Checklist

- [x] Phase 0 - Project planning and README
- [x] Phase 1 - Technical Requirements Document
- [x] Phase 2 - Test plan
- [x] Phase 3 - NestJS + SQLite scaffolding
- [x] Phase 4 - Data model and persistence
- [x] Phase 5 - Mock HCM
- [x] Phase 6 - Balance API
- [x] Phase 7 - Time-off request lifecycle
- [ ] Phase 8 - Batch reconciliation
- [ ] Phase 9 - Race conditions and idempotency hardening
- [ ] Phase 10 - Error handling and API polish
- [ ] Phase 11 - Coverage and final test proof
- [ ] Phase 12 - Final evaluator review

## Planned Architecture Overview

The target service is organized into four primary layers:

1. API layer
   - Thin Nest controllers for balances, time-off requests, and reconciliation ingestion.
   - Shared validation, exception mapping, and error envelopes.

2. Domain layer
   - Services that own request creation, approval, rejection, balance refresh, and reconciliation orchestration.
   - Explicit invariants around status transitions, idempotency, and local projection updates.

3. Persistence layer
   - Prisma-backed SQLite repositories for balances, time-off requests, HCM transaction audit data, and reconciliation runs.
   - Short local transactions around state transitions and projection writes.

4. External integration layer
   - An HCM client adapter for real-time balance lookup and deduction submission.
   - A mock HCM implementation with resettable in-memory state and a dedicated test-only HTTP surface for contract tests.

## Planned API Overview

Target public ReadyOn endpoints:

- `GET /balances/:employeeId/:locationId`
- `POST /balances/:employeeId/:locationId/refresh`
- `POST /time-off-requests`
- `GET /time-off-requests/:id`
- `POST /time-off-requests/:id/approve`
- `POST /time-off-requests/:id/reject`
- `POST /hcm/balances/batch`

Implemented mock HCM endpoints for test composition:

- `GET /mock-hcm/balances/:employeeId/:locationId`
- `POST /mock-hcm/time-off`
- `POST /mock-hcm/balances/:employeeId/:locationId/adjust`
- `GET /mock-hcm/balances/batch`

## Consistency Model Summary

The chosen consistency model is intentionally conservative:

- HCM is the source of truth for entitlement and deduction.
- ReadyOn stores a local balance projection for reads, UX, and resilience.
- Create-time validation may reject obviously impossible requests using the local projection.
- Approval never trusts the local projection alone; it must confirm against HCM.
- The local projection is updated only after HCM accepts the deduction or after authoritative reconciliation.
- Batch reconciliation is required to repair drift caused by external HCM changes or partial failures.
- Create requests use a client idempotency key.
- Approval retries use a stable external request id derived from the ReadyOn request id.
- Concurrency control will be serialized per `employeeId + locationId` in the take-home implementation.

## Planned Testing Strategy

The final proof of quality will come from:

- unit tests for validation, state transitions, stale-batch logic, and idempotency checks;
- integration tests for services, repositories, and SQLite-backed invariants;
- Supertest end-to-end coverage for the HTTP contract;
- mock HCM contract tests for balance lookups, deductions, adjustments, transient failures, batch snapshots, and duplicate submissions;
- reconciliation tests for stale, duplicate, and corrective batch behavior;
- race-condition and idempotency tests for concurrent approvals and retries; and
- coverage output captured under `coverage/` and refreshed with the current validation suite.

The current implementation already proves:

- the Nest app boots and serves `GET /health`;
- Prisma applies the SQLite schema through the shared database bootstrap path;
- the mock HCM contract supports valid lookups, invalid dimensions, atomic deduction, idempotent duplicate external request ids, transient failures, independent balance changes, and batch snapshots via isolated tests;
- the public balance API supports local projection reads, HCM-backed refresh, stable not-found handling, clean invalid-dimension handling, and retry-safe upstream-unavailable handling; and
- the public request lifecycle supports request creation, request lookup by id, approval-time HCM confirmation, local projection updates only after accepted HCM deductions, rejection without HCM deduction, stable validation handling, local insufficient-balance rejection, approval-time business rejection, transient upstream failure handling that leaves requests retry-safe `PENDING`, and idempotent create replay and approval retry behavior; and
- the build, lint, unit, e2e, and coverage commands run successfully as implementation progresses.

Target thresholds after implementation:

- Statements: 80%+
- Branches: 75%+
- Functions: 80%+
- Lines: 80%+

The latest full coverage refresh, captured after the completed Phase 7 lifecycle slice, was 91.17% statements, 76.84% branches, 90.41% functions, and 90.55% lines.

## Known Tradeoffs

- SQLite is required by the exercise and favors correctness and simplicity over horizontal write scale.
- The phase-one concurrency plan assumes a single service instance and keyed in-process serialization for approval safety.
- Local balance reads are intentionally eventually consistent until refresh or batch reconciliation occurs.
- The current HCM dependency is exercise-local and mock-backed: balance refresh uses an in-process adapter seed for deterministic runtime behavior, while the dedicated mock HCM HTTP module remains test-only.
- Authentication, authorization, payroll integrations, UI, and production deployment are intentionally out of scope.

## Future Improvements

The final submission should call out at least these follow-up areas:

- distributed locking or stronger multi-instance concurrency control;
- production-grade migrations, backup, and operational tooling;
- authentication and manager identity enforcement;
- richer observability dashboards and alerting;
- fractional-day leave support if the business requires it; and
- a real vendor-facing HCM adapter contract test suite.
