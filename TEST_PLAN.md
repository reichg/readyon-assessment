# Test Plan

## 1. Purpose

This plan defines how the ReadyOn Time-Off Microservice will prove correctness before submission.

The system is considered high risk in four areas:

1. stale local balances;
2. duplicate or replayed submissions;
3. concurrent approvals against limited balance; and
4. drift between ReadyOn and HCM after external changes or partial failures.

The test strategy therefore prioritizes behavior proof over raw volume.

## 2. Scope and References

This plan covers:

- public ReadyOn REST endpoints;
- mock HCM contract behavior;
- Prisma-backed SQLite persistence, migration/bootstrap behavior, and domain invariants;
- reconciliation and stale-batch handling;
- idempotency, replay safety, and race conditions; and
- consistent client-facing error contracts.

Reference documents:

- `TRD.md`
- `README.md`
- `readyon_timeoff_agent_instructions.md`

## 3. Business Risks and Quality Goals

| Risk ID | Business risk                                                               | Quality goal                                                    |
| ------- | --------------------------------------------------------------------------- | --------------------------------------------------------------- |
| R1      | ReadyOn approves time off against stale local balance                       | Approval must re-confirm with HCM before final approval         |
| R2      | Invalid employee/location combinations leak through and corrupt local state | Validate locally and map HCM invalid-dimension responses safely |
| R3      | Duplicate create or approval retries double-apply effects                   | Create and approval flows must be idempotent                    |
| R4      | Concurrent approvals overdraw available balance                             | Same employee/location approvals must serialize safely          |
| R5      | Batch reconciliation overwrites fresher state or accepts malformed input    | Reconciliation must be deterministic and replay-safe            |
| R6      | HCM failures leave ambiguous or inconsistent request state                  | Unknown outcomes must remain retry-safe and not falsely approve |
| R7      | HCM-side changes are not reflected in ReadyOn                               | Refresh and batch reconciliation must heal drift                |
| R8      | API error behavior is inconsistent or leaky                                 | Stable error envelope and stable error codes are required       |
| R9      | Workflow state becomes invalid                                              | Only allowed status transitions may occur                       |
| R10     | Coverage looks high while critical branches remain untested                 | Coverage proof must include the critical failure paths          |
| R11     | Boundary telemetry is missing or leaks sensitive internals                  | Key boundaries emit sanitized structured telemetry only         |

## 4. Test Levels and What Each Must Prove

### Unit tests

Unit tests prove pure logic and domain rules in isolation:

- request payload validation rules;
- state-transition guards;
- stale-batch policy decisions;
- idempotency-key conflict behavior;
- error-code mapping;
- duplicate-row detection; and
- concurrency helper behavior where feasible.

### Integration tests

Integration tests are planned to prove services and repositories against SQLite and controlled mock HCM collaborators:

- Prisma schema bootstrap and migration parity for isolated SQLite files;
- persistence constraints;
- repository contract parity after internal refactors;
- orchestration across repositories and HCM calls;
- atomic local updates after approval;
- reconciliation behavior;
- sanitized telemetry emission for database bootstrap, health ping, and repository mutation paths; and
- retry convergence.

### End-to-end tests

End-to-end tests are planned to prove the public HTTP contract using Supertest against a Nest application with isolated SQLite state and the in-repo mock HCM:

- request and response DTOs;
- error envelopes and status codes;
- controller wiring;
- full request lifecycle; and
- reconciliation ingestion behavior.

### Mock HCM contract tests

These tests prove the Phase 5 mock HCM itself is trustworthy as a regression dependency:

- atomic deduction;
- invalid dimension rejection;
- independent balance changes;
- transient failures; and
- duplicate external request id idempotency.

## 5. Environment and Tooling Plan

Target tooling after scaffolding:

- TypeScript
- NestJS test utilities
- Jest
- Supertest
- Prisma
- Prisma migrations and generated client
- SQLite with isolated test databases

Target validation commands after scaffolding:

```bash
pnpm build
pnpm lint
pnpm test
pnpm test:e2e
pnpm test:cov
```

Current status:

- The Phase 3 scaffold now supports executable build, lint, unit, e2e, and coverage runs.
- The Phase 4 persistence slice now uses Prisma-backed repository-contract parity over isolated SQLite files.
- The Phase 5 mock HCM now runs through a resettable in-memory service plus a dedicated test-only HTTP module for focused contract coverage.
- The Phase 6 balance API now supports local balance reads and HCM-backed refresh with focused integration and e2e coverage.
- The Phase 7 request lifecycle now supports create, get, approve, and reject behavior with focused service, controller, and e2e coverage for success, rejection, and transient failure paths.
- Reconciliation and race-condition scenarios remain later-phase work.
- The scenario matrix below remains the target-state behavior plan, now mixing implemented phase 7 lifecycle coverage with still-planned later-phase scenarios.

## 6. Test Data and Fixture Strategy

1. Use deterministic employee/location pairs such as `emp_123` and `loc_001`.
2. Seed balances explicitly for each test.
3. Reset SQLite state between tests.
4. Reset mock HCM state between tests using the service reset path and fresh per-test app composition.
5. Use fixed timestamps and source versions where ordering matters.
6. Use stable request ids and idempotency keys in retry scenarios.

## 7. Scenario Matrix

Columns:

- `ID`: unique scenario id
- `Capability`: feature area
- `Risk`: business risk id
- `Scenario`: behavior under test
- `Level`: unit, integration, e2e, or mock-hcm
- `Expected assertion`: the core proof point

| ID   | Capability           | Risk | Scenario                                                                  | Level       | Expected assertion                                                                         |
| ---- | -------------------- | ---- | ------------------------------------------------------------------------- | ----------- | ------------------------------------------------------------------------------------------ |
| B01  | Balance read         | R7   | Get existing balance                                                      | e2e         | Returns 200 and the local projection                                                       |
| B02  | Balance read         | R7   | Get missing balance                                                       | e2e         | Returns 404 with `BALANCE_NOT_FOUND`                                                       |
| B03  | Balance refresh      | R7   | Refresh balance from HCM success                                          | integration | Upserts local projection from HCM                                                          |
| B04  | Balance refresh      | R2   | Refresh invalid employee/location                                         | e2e         | Returns 404 with `INVALID_EMPLOYEE_LOCATION` and no invalid projection write               |
| B05  | Balance refresh      | R6   | Refresh when HCM is unavailable                                           | integration | Returns upstream-unavailable error without corrupting projection                           |
| C01  | Create request       | R9   | Create valid request                                                      | e2e         | Persists `PENDING` request and returns 201                                                 |
| C02  | Create request       | R8   | Reject zero requestedDays                                                 | unit        | Validation fails before persistence                                                        |
| C03  | Create request       | R8   | Reject negative requestedDays                                             | unit        | Validation fails before persistence                                                        |
| C04  | Create request       | R8   | Reject missing employeeId                                                 | unit        | Validation fails before persistence                                                        |
| C05  | Create request       | R8   | Reject missing locationId                                                 | unit        | Validation fails before persistence                                                        |
| C06  | Create request       | R1   | Reject request when known local balance is insufficient                   | integration | Returns `INSUFFICIENT_BALANCE` without creating a request                                  |
| C07  | Create request       | R1   | Allow request creation when no local balance projection exists            | integration | Request is still created as `PENDING`                                                      |
| C08  | Create request       | R3   | Duplicate create with same idempotency key and same payload               | integration | Returns the original request, no duplicate row                                             |
| C09  | Create request       | R3   | Duplicate create with same idempotency key and different payload          | integration | Returns `IDEMPOTENCY_KEY_CONFLICT`                                                         |
| A01  | Approval             | R1   | Approve valid pending request                                             | e2e         | HCM is called, request becomes `APPROVED`, local projection updates                        |
| A02  | Approval             | R9   | Reject approval when request is not pending                               | e2e         | Returns `INVALID_REQUEST_STATE`                                                            |
| A03  | Approval             | R2   | Reject approval when HCM says invalid employee/location                   | integration | Request becomes `REJECTED`, no local deduction                                             |
| A04  | Approval             | R1   | Reject approval when HCM says insufficient balance                        | integration | Request becomes `REJECTED`, local projection is refreshed or corrected                     |
| A05  | Approval             | R6   | HCM unavailable before confirmed outcome                                  | integration | Request stays non-approved and retry-safe                                                  |
| A06  | Approval             | R3   | Retry approval after transient HCM failure                                | integration | No double deduction; request converges safely                                              |
| A07  | Approval             | R3   | Retry approval after prior HCM success                                    | integration | Returns approved result without second deduction                                           |
| A08  | Approval             | R6   | Crash or persistence failure after HCM success                            | integration | Retry converges via same external request id without double deduction                      |
| A09  | Approval             | R3   | Concurrent approval of the same request                                   | integration | Only one effective approval is applied                                                     |
| RJ01 | Manager rejection    | R9   | Reject pending request                                                    | e2e         | Request becomes `REJECTED`                                                                 |
| RJ02 | Manager rejection    | R9   | Reject already approved request                                           | e2e         | Returns `INVALID_REQUEST_STATE`                                                            |
| RJ03 | Manager rejection    | R3   | Reject pending request does not call HCM                                  | integration | No HCM deduction side effect occurs                                                        |
| H01  | HCM external changes | R7   | Simulate work anniversary bonus in HCM                                    | mock-hcm    | HCM state increases independently                                                          |
| H02  | HCM external changes | R7   | Local projection is stale before refresh                                  | integration | Local read differs from HCM until refresh                                                  |
| H03  | HCM external changes | R7   | Refresh corrects stale local projection                                   | integration | Local projection matches HCM after refresh                                                 |
| H04  | HCM external changes | R7   | Batch reconciliation corrects stale local projection                      | integration | Local projection is healed from batch snapshot                                             |
| Q01  | Reconciliation       | R5   | Insert new balance from batch                                             | integration | New local balance row is created                                                           |
| Q02  | Reconciliation       | R5   | Update existing balance from batch                                        | integration | Existing projection updates to authoritative values                                        |
| Q03  | Reconciliation       | R5   | Exact replay of same sourceVersion                                        | integration | Operation is idempotent no-op                                                              |
| Q04  | Reconciliation       | R5   | Stale sourceVersion or older effectiveAt                                  | integration | Returns `STALE_SOURCE_VERSION` and performs no writes                                      |
| Q05  | Reconciliation       | R5   | Duplicate employee/location rows in one batch                             | integration | Returns `DUPLICATE_RECONCILIATION_ROW`                                                     |
| Q06  | Reconciliation       | R8   | Invalid batch payload                                                     | e2e         | Returns `VALIDATION_ERROR`                                                                 |
| RC01 | Race conditions      | R4   | Two approvals within total balance both succeed                           | integration | Both approvals succeed when HCM balance allows it                                          |
| RC02 | Race conditions      | R4   | Two approvals exceeding total balance do not both succeed                 | integration | At most one approval succeeds when total days exceed balance                               |
| RC03 | Race conditions      | R4   | Same-request concurrent approval only succeeds once                       | integration | One logical approval and one HCM deduction                                                 |
| T01  | Telemetry            | R11  | Database bootstrap emits a structured success event                       | integration | Event includes component, operation, outcome, and duration without path or URL leakage     |
| T02  | Telemetry            | R11  | Translated persistence conflicts and constraints emit sanitized telemetry | integration | Event category is stable and excludes raw Prisma or SQLite details                         |
| T03  | Telemetry            | R11  | HTTP request lifecycle telemetry stays sanitized                          | e2e         | Event includes request id, method, route, status, and duration without body or identifiers |
| MH01 | Mock HCM             | R2   | Realtime balance lookup valid dimensions                                  | mock-hcm    | Returns current HCM balance                                                                |
| MH02 | Mock HCM             | R2   | Realtime balance lookup invalid dimensions                                | mock-hcm    | Returns clean invalid-dimension error                                                      |
| MH03 | Mock HCM             | R1   | Deduct time off with sufficient balance                                   | mock-hcm    | Deduction is atomic and returns transaction id                                             |
| MH04 | Mock HCM             | R1   | Deduct time off with insufficient balance                                 | mock-hcm    | Rejects cleanly without partial mutation                                                   |
| MH05 | Mock HCM             | R3   | Duplicate externalRequestId submission                                    | mock-hcm    | Returns idempotent result without double deduction                                         |
| MH06 | Mock HCM             | R6   | Transient HCM error simulation                                            | mock-hcm    | Controlled failure path is available for retry tests                                       |
| E01  | Error handling       | R8   | Validation error envelope shape                                           | e2e         | Error response contains stable code/message/details shape                                  |
| E02  | Error handling       | R8   | Missing resource error envelope                                           | e2e         | Uses stable not-found code without raw internals                                           |
| E03  | Error handling       | R8   | Invalid state transition error                                            | e2e         | Returns `INVALID_REQUEST_STATE`                                                            |
| E04  | Error handling       | R8   | Upstream failure error                                                    | e2e         | Returns `HCM_UNAVAILABLE` without raw upstream body                                        |
| E05  | Error handling       | R8   | No raw SQLite or stack trace leakage                                      | e2e         | Response body excludes internal exception details                                          |

## 8. Coverage and Exit Criteria

### Target coverage thresholds

- Statements: 80%+
- Branches: 75%+
- Functions: 80%+
- Lines: 80%+

### Critical branches that must be covered even if raw thresholds are met

1. HCM insufficient balance during approval
2. Invalid employee/location during refresh and approval
3. HCM transient failure during approval
4. Retry after ambiguous or prior success outcome
5. Stale reconciliation batch rejection
6. Duplicate reconciliation row rejection
7. Duplicate create idempotency conflict
8. Concurrent approvals exceeding balance
9. Prisma-backed persistence constraint translation preserves stable conflict and constraint errors
10. Isolated SQLite bootstrap applies the expected Prisma-managed schema before repository tests run
11. Database bootstrap and translated persistence failures emit sanitized telemetry without raw identifiers, paths, or driver internals

### Exit criteria for the final submission

1. `pnpm test` passes.
2. `pnpm test:e2e` passes.
3. `pnpm test:cov` passes.
4. `coverage/` contains generated proof.
5. README includes the final coverage summary.
6. The implemented test suite covers all required risks in this plan.

## 9. Traceability Back to Design

- `TRD.md` owns the architecture, consistency model, and tradeoff decisions.
- `TEST_PLAN.md` owns the risk-to-scenario proof plan.
- README owns the reviewer-facing summary and later the final coverage result.

The final implementation is acceptable only if the tested behavior matches the TRD decisions on:

1. HCM as source of truth
2. approval-time HCM confirmation
3. local balance projection semantics
4. batch reconciliation freshness rules
5. create and approval idempotency
6. concurrency protection
7. stable error contracts

## 10. Phase 4 Persistence Validation Plan

This phase validates the runtime scaffold and Prisma-backed persistence foundation. It does not claim that the domain behaviors in the scenario matrix are already implemented.

This phase is complete when:

1. `package.json`, `src/`, `test/`, and the supporting NestJS, TypeScript, Jest, and ESLint config files exist.
2. `pnpm build` passes.
3. `pnpm lint` passes.
4. `pnpm test` passes with a Prisma-managed SQLite bootstrap smoke spec and Prisma-backed repository parity checks.
5. `pnpm test:e2e` passes with a health endpoint smoke spec.
6. `pnpm test:cov` generates `coverage/`.
7. The scaffold uses isolated file-backed SQLite test databases, applies the expected Prisma-managed schema and migrations for the current persistence layer, and cleans them up per run.
8. The database infrastructure remains explicitly imported by health and persistence ownership boundaries rather than exposed globally across the app.
9. Boundary telemetry covers HTTP request lifecycle, database bootstrap and ping, and repository mutation outcomes with sanitized low-cardinality metadata.

## 11. Phase 5 Mock HCM Validation Plan

This phase validates the mock HCM contract as a trustworthy upstream dependency before the public balance and request lifecycle APIs consume it.

This phase is complete when:

1. The HCM feature provides a resettable in-memory mock service and a dedicated test-only HTTP module for the documented mock routes.
2. Focused contract tests prove realtime balance lookup for valid and invalid employee/location dimensions.
3. Focused tests prove atomic deduction and deterministic insufficient-balance rejection.
4. Focused tests prove duplicate `externalRequestId` submissions are idempotent and do not deduct twice.
5. Focused tests prove transient upstream failures remain retry-safe and do not mutate balance or idempotency state.
6. Focused tests prove independent external balance adjustments and full batch snapshot output.
7. Mock HCM state is reset between tests without relying on SQLite cleanup.
8. `pnpm test -- test/hcm` passes before broader repository validation.

## 12. Phase 6 Balance API Validation Plan

This phase validates the first public ReadyOn API slice for local balance reads and explicit HCM-backed refresh.

This phase is complete when:

1. `GET /balances/:employeeId/:locationId` returns the latest known local balance projection.
2. `GET /balances/:employeeId/:locationId` returns `404` with `BALANCE_NOT_FOUND` when no local projection exists.
3. `POST /balances/:employeeId/:locationId/refresh` returns `200` and upserts the authoritative HCM balance into the local projection.
4. Refresh preserves existing local projection data when HCM reports `INVALID_EMPLOYEE_LOCATION` or `HCM_UNAVAILABLE`.
5. Refresh maps invalid employee/location pairs to `404` with `INVALID_EMPLOYEE_LOCATION`.
6. Refresh maps transient upstream failures to `503` with `HCM_UNAVAILABLE`.
7. Focused integration tests prove refresh insert, stale-data correction, and no-write behavior on upstream failure.
8. Focused e2e tests prove the balance read and refresh HTTP contract.
9. Phase 5 mock HCM contract tests remain green as a regression dependency.

## 13. Phase 7 Request Lifecycle Validation Plan

This Phase 7 slice validates the complete request lifecycle for create, get, approve, and reject before reconciliation and concurrency hardening land.

This slice is complete when:

1. `POST /time-off-requests` returns `201` on first create and persists a `PENDING` request without deducting HCM balance.
2. `POST /time-off-requests` returns `200` on idempotent replay with the same payload.
3. `POST /time-off-requests` returns `409` with `INSUFFICIENT_BALANCE` when the known local projection is already too low and does not persist a request.
4. `POST /time-off-requests` returns `409` with `IDEMPOTENCY_KEY_CONFLICT` when the same idempotency key is reused with a different payload.
5. `POST /time-off-requests` returns `400` with `VALIDATION_ERROR` for malformed payloads.
6. `GET /time-off-requests/:id` returns `200` for an existing request and `404` with `TIME_OFF_REQUEST_NOT_FOUND` when the request does not exist.
7. `POST /time-off-requests/:id/approve` returns `200` and persists `APPROVED` only after HCM accepts the deduction.
8. Approval-time HCM business denials return stable `409` errors, persist `REJECTED`, and only update the local balance projection from authoritative HCM data.
9. Approval-time upstream unavailability returns `503` and leaves the request retry-safe `PENDING`.
10. `POST /time-off-requests/:id/reject` returns `200`, persists `REJECTED`, and does not call HCM.
11. Non-pending approve and reject attempts return `409` with `INVALID_REQUEST_STATE`.
12. Focused service, controller, and e2e tests prove the lifecycle contract.
13. Reconciliation and race-hardening scenarios remain pending later slices of implementation.

## 14. Open Questions To Revisit During Scaffolding

1. Which future recovery paths, if any, should transition to `FAILED` rather than remain retry-safe `PENDING` until recovery confirms the final outcome.
2. Whether exact `sourceVersion` replay and `effectiveAt` ordering need additional reconciliation metadata.
3. Whether a dedicated HCM transaction audit table is sufficient or if a richer event log is needed.
