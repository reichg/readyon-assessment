# ReadyOn Time-Off Microservice

ReadyOn uses this service to manage time-off requests while keeping the HCM system authoritative for balances and deductions. The service provides fast local reads, approval-time HCM confirmation, and reconciliation paths that repair drift when HCM changes independently.

## Table of Contents

- [Project Summary](#project-summary)
- [Reviewer Quick Start](#reviewer-quick-start)
- [Implemented Scope](#implemented-scope)
- [API Overview](#api-overview)
- [Consistency Model](#consistency-model)
- [Validation and Coverage](#validation-and-coverage)
- [Architecture Overview](#architecture-overview)
- [Known Limitations and Tradeoffs](#known-limitations-and-tradeoffs)
- [Future Improvements](#future-improvements)
- [Appendix: Phase Checklist](#appendix-phase-checklist)

## Project Summary

This repository is the ReadyOn Time-Off Microservice take-home submission. It delivers a NestJS + Prisma + SQLite backend that:

- exposes REST endpoints for balances, time-off requests, and reconciliation;
- treats HCM as the source of truth for entitlement and deduction state;
- keeps a local balance projection for fast reads, defensive validation, and operator visibility;
- re-confirms with HCM before approval so cached data alone cannot approve time off; and
- uses a focused Jest and Supertest suite to prove the main business risks.

The main reviewer documents are:

- `README.md` for the quick evaluation path and current-state summary;
- `TRD.md` for architecture, tradeoffs, and consistency decisions; and
- `TEST_PLAN.md` for the risk-driven test matrix and validation scope.

## Reviewer Quick Start

### Prerequisites

- Node.js 22 or later
- pnpm 10 or later

### Fastest evaluation path

Run the repository in this order:

```bash
pnpm install
pnpm build
pnpm lint
pnpm test
pnpm test:e2e
pnpm test:cov
```

Then review:

1. `coverage/lcov-report/index.html` for the HTML coverage report.
2. `TRD.md` for the system design and tradeoffs.
3. `TEST_PLAN.md` for the scenario matrix and risk coverage.

### Run the service locally

```bash
pnpm start:dev
```

- Base URL: `http://localhost:3000`
- Smoke check: `GET /health`
- The runtime entrypoint auto-loads a repo-root `.env` when present.
- Shell environment variables still win over `.env` values, which keeps one-off local overrides explicit.
- Common local settings: `PORT`, `READYON_DB_PATH`, `DATABASE_URL=file:/absolute/path/to/readyon.sqlite`, `READYON_ENABLE_MOCK_HCM_HTTP=true`, and `READYON_TELEMETRY_FORMAT=json|pretty`
- Telemetry logs remain structured JSON. Use `READYON_TELEMETRY_FORMAT=pretty` for multiline formatted local output, or leave it unset for compact JSON.
- `.env` files are ignored in this repository. Do not commit secrets or machine-specific values.

### Enable live mock HCM locally

Common local env variables in `.env`.

```
READYON_ENABLE_MOCK_HCM_HTTP=true
READYON_TELEMETRY_FORMAT=pretty
PORT=3000
```

With `READYON_ENABLE_MOCK_HCM_HTTP=true`, the same Nest process exposes `/mock-hcm/*` for local Postman testing. Those routes are still not part of the public ReadyOn API, but they do mutate the same in-process mock HCM state used by public balance refresh and approval flows. The default seed is `emp_123` at `loc_001` with `10` available days, and the mock state resets when the process restarts.

One useful manual flow is:

1. `GET /mock-hcm/balances/emp_123/loc_001`
2. `POST /mock-hcm/balances/emp_123/loc_001/adjust` with `{ "deltaDays": 3 }`
3. `POST /balances/emp_123/loc_001/refresh`
4. `GET /balances/emp_123/loc_001`

This README, `TRD.md`, and `TEST_PLAN.md` describe the shipped repository state.

## Implemented Scope

- Balance read and refresh endpoints.
- Time-off request create, get, approve, and reject lifecycle.
- Approval-time HCM confirmation and authoritative balance correction.
- Batch reconciliation with replay-safe and stale-batch handling.
- Stable public API error envelopes and error codes.
- Create-time idempotency and approval replay safety.
- In-process approval serialization keyed by `employeeId + locationId`.
- Mock-backed HCM behavior for deterministic tests, with an opt-in `/mock-hcm/*` HTTP surface for local and evaluator-driven manual testing.

## API Overview

### Public ReadyOn endpoints

- `GET /balances/:employeeId/:locationId`
- `POST /balances/:employeeId/:locationId/refresh`
- `POST /time-off-requests`
- `GET /time-off-requests/:id`
- `POST /time-off-requests/:id/approve`
- `POST /time-off-requests/:id/reject`
- `POST /hcm/balances/batch`

### Mock HCM endpoints for local and test use

- `GET /mock-hcm/balances/:employeeId/:locationId`
- `POST /mock-hcm/time-off`
- `POST /mock-hcm/balances/:employeeId/:locationId/adjust`
- `GET /mock-hcm/balances/batch`

The mock HCM HTTP surface is not part of the public ReadyOn API. It is exposed only when `READYON_ENABLE_MOCK_HCM_HTTP=true`, which keeps it available for local Postman testing while leaving the default runtime surface unchanged.

### Public error envelope

Non-2xx ReadyOn responses use one stable envelope:

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

## Consistency Model

The system uses a conservative consistency model:

- HCM is the source of truth for balance and deduction outcomes.
- ReadyOn stores a local balance projection for fast reads and user experience.
- Create-time validation can reject obviously impossible requests using the local projection.
- Approval never trusts the local projection alone; it must confirm against HCM.
- ReadyOn updates the local projection only after an authoritative HCM outcome or an authoritative reconciliation batch.
- Batch reconciliation repairs drift caused by external HCM changes, missed refreshes, or partial failures.
- Create requests rely on a client idempotency key.
- Approval retries rely on a stable external request id derived from the ReadyOn request id.
- Approval work is serialized per `employeeId + locationId` in this take-home implementation.

What a reviewer should expect from the balance experience:

- `GET /balances/:employeeId/:locationId` returns the latest known local projection.
- `POST /balances/:employeeId/:locationId/refresh` updates that projection from HCM.
- Approval re-checks HCM before success and corrects drift when HCM rejects for business reasons.

## Validation and Coverage

The validation strategy is risk-driven rather than coverage-driven. The repository includes:

- unit tests for validation, state transitions, stale-batch logic, and idempotency checks;
- integration tests for services, repositories, SQLite-backed invariants, reconciliation, and concurrency behavior;
- Supertest e2e coverage for the public HTTP contract;
- mock HCM contract tests for balance lookup, deduction, idempotency, transient failures, and batch snapshots; and
- generated coverage output under `coverage/`.

The main validation commands are:

```bash
pnpm build
pnpm lint
pnpm test
pnpm test:e2e
pnpm test:cov
```

The committed coverage artifact currently reports:

- Statements: 93.70%
- Branches: 81.57%
- Functions: 91.13%
- Lines: 93.37%

For the detailed risk-to-scenario proof map, use `TEST_PLAN.md`.

## Architecture Overview

The implementation is organized around clear controller, service, repository, and adapter ownership.

1. API layer
   Thin Nest controllers expose transport-only behavior for balances, requests, reconciliation, and health.

2. Application services
   `BalanceService`, `TimeOffRequestService`, and `ReconciliationService` own orchestration, lifecycle rules, idempotency handling, and projection updates.

3. Concurrency control
   `ApprovalConcurrencyGate` serializes approval work per `employeeId + locationId` in-process.

4. Persistence
   Prisma-backed SQLite repositories own storage access, constraints, and short local transactions.

5. HCM integration
   Separate HCM balance and time-off clients back the public flows, while the mock HCM HTTP module can be mounted in local runtime with `READYON_ENABLE_MOCK_HCM_HTTP=true` for Postman and contract-style testing.

6. Shared infrastructure
   Database bootstrap, Prisma lifecycle, HTTP telemetry, and request correlation live in shared infrastructure modules.

## Known Limitations and Tradeoffs

- SQLite is the exercise database and favors correctness and simplicity over write scale.
- The concurrency approach assumes a single service instance and in-process keyed serialization.
- Local balance reads are eventually consistent until refresh or batch reconciliation occurs.
- The current HCM dependency is exercise-local and mock-backed, not a production vendor integration.
- Telemetry is intentionally focused and uses allow-listed metadata rather than a full observability platform.
- Authentication, authorization, payroll integrations, UI, and deployment concerns are out of scope.

## Future Improvements

1. Add distributed locking or stronger multi-instance concurrency control.
2. Add production-grade migration, backup, and operational tooling.
3. Add authentication and manager identity enforcement.
4. Expand observability dashboards and alerting.
5. Support fractional-day leave if the business requires it.
6. Add vendor-facing HCM adapter contract tests.

## Appendix: Phase Checklist

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
