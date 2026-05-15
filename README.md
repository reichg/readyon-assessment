# ReadyOn Time-Off Microservice

## Project Summary

This repository is the final take-home submission for the ReadyOn Time-Off Microservice.

It delivers a NestJS + Prisma + SQLite backend that:

- exposes REST endpoints for balances, time-off requests, and reconciliation;
- treats HCM as the source of truth for entitlement and final deduction state;
- keeps a local balance projection for fast reads, defensive create-time validation, and operator visibility;
- confirms balance with HCM before approval and corrects drift through reconciliation; and
- proves the core business risks with focused Jest and Supertest coverage.

## Reviewer Quick Start

### Prerequisites

- Node.js 22 or later
- pnpm 10 or later

### Fastest evaluation path

The fastest reviewer path is:

1. Run `pnpm install`.
2. Run `pnpm build`, `pnpm lint`, `pnpm test`, `pnpm test:e2e`, and `pnpm test:cov`.
3. Open `coverage/lcov-report/index.html` for the HTML coverage summary.
4. Read `TRD.md` for the architecture, consistency model, API contract, and tradeoffs.
5. Read `TEST_PLAN.md` for the risk-driven scenario matrix and validation scope.

### Run the service locally

```bash
pnpm start:dev
```

- Base URL: `http://localhost:3000`
- Smoke check: `GET /health`
- Optional overrides: `PORT`, `READYON_DB_PATH`, or `DATABASE_URL=file:/absolute/path/to/readyon.sqlite`
- `README.md`, `TRD.md`, and `TEST_PLAN.md` describe the final shipped state. `given-task.md` and `readyon_timeoff_agent_instructions.md` are useful as exercise and workflow provenance, but they are not the primary reviewer guide.

## Implemented Scope

- Public ReadyOn balance read and refresh endpoints
- Time-off request create, get, approve, and reject lifecycle
- Approval-time HCM confirmation and local projection correction on authoritative HCM outcomes
- Authoritative batch reconciliation with replay-safe and stale-batch handling
- Consistent public API error envelope with stable error codes
- Create-time idempotency plus approval replay safety
- Keyed in-process approval serialization per `employeeId + locationId`
- Deterministic mock-backed HCM behavior for the take-home runtime, with a separate `/mock-hcm/*` HTTP contract mounted only in test composition

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
- [x] Phase 8 - Batch reconciliation
- [x] Phase 9 - Race conditions and idempotency hardening
- [x] Phase 10 - Error handling and API polish
- [x] Phase 11 - Coverage and final test proof
- [x] Phase 12 - Final evaluator review

## Architecture Overview

The implementation is organized by controller, service, repository, and adapter ownership rather than a strict hexagonal split with abstract domain ports.

1. API and transport
   - Thin Nest controllers for balances, time-off requests, reconciliation ingest, and health.
   - Shared validation and a single public ReadyOn exception filter for consistent error envelopes.

2. Application services
   - `BalanceService`, `TimeOffRequestService`, and `ReconciliationService` own request orchestration, status transitions, idempotency handling, and projection updates.
   - `ApprovalConcurrencyGate` serializes approval work per `employeeId + locationId` in-process.

3. Persistence layer
   - Prisma-backed SQLite repositories own storage mapping, constraints, and short local transactions.
   - Feature modules wire the repositories they use directly; persistence infrastructure is shared, but repository ownership stays feature-local.

4. HCM integration
   - Separate HCM balance and time-off clients back the public app flows.
   - In this take-home, those clients are backed by an in-repo mock HCM service for deterministic behavior.
   - A separate `MockHcmHttpModule` mounts `/mock-hcm/*` only in tests for upstream contract coverage.

5. Infrastructure
   - Database bootstrap, Prisma lifecycle, HTTP telemetry, and request correlation are centralized in shared infrastructure modules.
   - Services stay framework-light, but they depend on concrete repositories and HCM adapters rather than abstract ports.

## API Overview

Public ReadyOn endpoints:

- `GET /balances/:employeeId/:locationId`
- `POST /balances/:employeeId/:locationId/refresh`
- `POST /time-off-requests`
- `GET /time-off-requests/:id`
- `POST /time-off-requests/:id/approve`
- `POST /time-off-requests/:id/reject`
- `POST /hcm/balances/batch`

Mock HCM endpoints for test composition only:

- `GET /mock-hcm/balances/:employeeId/:locationId`
- `POST /mock-hcm/time-off`
- `POST /mock-hcm/balances/:employeeId/:locationId/adjust`
- `GET /mock-hcm/balances/batch`

The mock HCM HTTP surface is not mounted in the public app and does not share the ReadyOn public error envelope. It exists to exercise upstream contract behavior in focused tests.

## Common API Errors

Public ReadyOn endpoints return non-2xx responses in one stable envelope:

```json
{
  "error": {
    "code": "INSUFFICIENT_BALANCE",
    "message": "Available balance is insufficient for the requested time off.",
    "details": {
      "employeeId": "emp_123",
      "locationId": "loc_001",
      "requestedDays": 2,
      "availableDays": 1,
      "source": "HCM"
    }
  }
}
```

Contract rules:

- `error.code` is the stable client-facing identifier to assert in tests and use in callers.
- `error.message` is human-readable and safe to display or log.
- `error.details` is optional and only contains allow-listed domain context.
- Validation errors use `error.details.violations` for the constraint list.
- Unexpected server-side failures return `INTERNAL_SERVER_ERROR` without raw SQLite, Prisma, HCM, or stack-trace details.

Representative public error codes:

- `VALIDATION_ERROR`
- `BALANCE_NOT_FOUND`
- `TIME_OFF_REQUEST_NOT_FOUND`
- `INVALID_REQUEST_STATE`
- `INSUFFICIENT_BALANCE`
- `INVALID_EMPLOYEE_LOCATION`
- `HCM_UNAVAILABLE`
- `IDEMPOTENCY_KEY_CONFLICT`
- `DUPLICATE_RECONCILIATION_ROW`
- `STALE_SOURCE_VERSION`

Operation notes:

- `INVALID_EMPLOYEE_LOCATION` returns `404` for balance refresh because the lookup target is missing in HCM.
- `INVALID_EMPLOYEE_LOCATION` returns `409` for approval because the pending request becomes a terminal business rejection.

## Consistency Model Summary

The chosen consistency model is intentionally conservative:

- HCM is the source of truth for entitlement and deduction.
- ReadyOn stores a local balance projection for reads, UX, and resilience.
- Create-time validation may reject obviously impossible requests using the local projection.
- Approval never trusts the local projection alone; it must confirm against HCM.
- The local projection is updated only after authoritative HCM confirmation, including business-denial correction paths, or after authoritative reconciliation.
- Batch reconciliation is required to repair drift caused by external HCM changes or partial failures.
- Create requests use a client idempotency key.
- Approval retries use a stable external request id derived from the ReadyOn request id.
- Concurrency control is serialized per `employeeId + locationId` in the take-home implementation.

## What the Employee Can Trust

- `GET /balances/:employeeId/:locationId` returns ReadyOn's latest known local projection and includes `lastSyncedAt` so the employee can see when it was last synchronized.
- `POST /balances/:employeeId/:locationId/refresh` asks HCM for the current authoritative balance and updates the local projection immediately.
- Approval never trusts the cached balance alone: ReadyOn re-checks HCM before approving, corrects the projection when HCM rejects, and relies on reconciliation to repair any remaining drift from external HCM-side changes.

## Reconciliation Strategy

- `effectiveAt` is the primary freshness signal.
- `sourceVersion` is the replay key for exact batch-idempotency.
- Exact `sourceVersion` replay is a no-op.
- Older `effectiveAt` values are rejected as stale.
- Duplicate `employeeId + locationId` rows within a batch are rejected as invalid input.
- Reconciliation is the drift-repair mechanism for external HCM changes, missed refreshes, and partial failure recovery.

## Testing Strategy and Coverage

The validation strategy is risk-driven rather than coverage-driven. The implemented suite includes:

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
- the public request lifecycle supports request creation, request lookup by id, approval-time HCM confirmation, authoritative projection correction on approval-time business denial, rejection without HCM deduction, stable validation handling, local insufficient-balance rejection, transient upstream failure handling that leaves requests retry-safe `PENDING`, and idempotent create replay and approval replay behavior; and
- the reconciliation slice supports fresh batch ingest, replay-safe no-op handling, duplicate-row rejection, stale-batch rejection, and projection correction from authoritative HCM snapshots; and
- the phase 9 hardening slice proves same-request approval replay, retry-after-transient-HCM failure convergence, and concurrent approval behavior for shared employee/location balance buckets; and
- the phase 10 public error-contract slice proves structured domain error details, consistent validation envelopes, and safe generic fallback behavior for unexpected internal failures; and
- the build, lint, unit, e2e, and coverage commands are the final reviewer validation path.

Target thresholds after implementation:

- Statements: 80%+
- Branches: 75%+
- Functions: 80%+
- Lines: 80%+

The current coverage artifact reports 93.70% statements, 81.57% branches, 91.13% functions, and 93.37% lines, exceeding the plan thresholds.

## Known Limitations and Tradeoffs

- SQLite is required by the exercise and favors correctness and simplicity over horizontal write scale.
- The phase-one concurrency plan assumes a single service instance and keyed in-process serialization for approval safety.
- Local balance reads are intentionally eventually consistent until refresh or batch reconciliation occurs.
- The current HCM dependency is exercise-local and mock-backed: the app uses in-repo mock-backed HCM clients for deterministic runtime behavior, while the separate mock HCM HTTP module remains test-only.
- Telemetry safety relies on allow-listed event payloads and focused tests; there is no centralized redaction layer, and HCM client edges are not instrumented separately.
- Authentication, authorization, payroll integrations, UI, and production deployment are intentionally out of scope.

## Future Improvements

The final submission should call out at least these follow-up areas:

- distributed locking or stronger multi-instance concurrency control;
- production-grade migrations, backup, and operational tooling;
- authentication and manager identity enforcement;
- richer observability dashboards and alerting;
- fractional-day leave support if the business requires it; and
- a real vendor-facing HCM adapter contract test suite.
