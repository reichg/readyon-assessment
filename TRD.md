# Technical Requirements Document

## 1. Problem Statement

ReadyOn needs a backend microservice that manages employee time-off requests while keeping balance integrity across two systems.

The hard part is that HCM remains the system of record for employment and time-off entitlement data, but ReadyOn still needs fast reads, responsive request creation, and safe approval flows. HCM balances can change independently because of annual refreshes, work anniversary bonuses, manual adjustments, or delayed processing in external systems.

The service must therefore provide a usable local experience without ever treating the local database as the final authority for approved time-off consumption.

## 2. Goals

1. Provide a REST API for reading balances, creating requests, approving or rejecting requests, and reconciling HCM snapshots.
2. Maintain a local balance projection for fast reads and user experience.
3. Confirm entitlement against HCM before approving time off.
4. Prevent double deduction during retries and concurrent approval attempts.
5. Reconcile drift caused by external HCM balance changes or partial failures.
6. Produce a deterministic, well-tested backend that is easy for a hiring reviewer to evaluate.

## 3. Non-Goals

1. Authentication and authorization.
2. UI, scheduling calendars, or workflow dashboards.
3. Payroll integration.
4. Real Workday or SAP integration.
5. Production deployment automation.
6. Multi-tenant authorization or org hierarchy management.
7. Fractional-day leave support in the first version.

## 4. User Personas

### Employee

- Wants to see an accurate balance quickly.
- Wants immediate feedback when submitting a time-off request.
- Expects duplicate clicks or retried submissions not to create duplicate requests.
- Can trust `GET /balances` as the latest known local projection and use `lastSyncedAt` as the freshness signal.
- Can trigger `POST /balances/:employeeId/:locationId/refresh` for an HCM-backed refresh before making a decision, while approval still re-confirms with HCM.

### Manager

- Needs to approve or reject requests with confidence that approval will not overdraw balance.
- Needs deterministic outcomes when HCM rejects or is temporarily unavailable.

### Reviewer / Evaluator

- Needs a clear explanation of the consistency model.
- Needs to see explicit tradeoffs, not hand-wavy eventual consistency claims.
- Needs test evidence that concurrency, idempotency, and drift correction were designed intentionally.

## 5. Requirements

### Functional requirements

1. Read the latest known local balance by `employeeId + locationId`.
2. Refresh a local balance projection from HCM in real time.
3. Create a time-off request in `PENDING` state.
4. Reject invalid request payloads locally.
5. Reject a create request immediately when the known local projection is already insufficient.
6. Approve only `PENDING` requests.
7. Re-confirm balance with HCM before approving.
8. Deduct time off in HCM before committing `APPROVED` locally.
9. Reject or fail safely when HCM rejects the request.
10. Reject a request without calling HCM when a manager rejects it.
11. Ingest authoritative batch snapshots from HCM.
12. Reject or ignore stale reconciliation batches according to one deterministic rule.
13. Support idempotent create and approval retry behavior.
14. Provide consistent error responses with stable error codes.

### Quality requirements

1. Controllers stay thin.
2. Workflow and business rules live in services, while repositories own persistence mapping and storage-level guards.
3. Database bootstrap, migrations, and Prisma lifecycle remain infrastructure-owned and are not exposed globally across feature modules.
4. Prisma-backed SQLite transactions remain short and deterministic.
5. No raw database, Prisma, or HCM errors leak to clients or normal telemetry.
6. Boundary telemetry remains low-cardinality and is produced from allow-listed call sites, with the current implementation focused on HTTP, database bootstrap, and repository mutation edges rather than centralized payload redaction across every boundary.
7. The test suite covers concurrency, retries, stale data, batch correction, safe error behavior, and telemetry behavior for the currently instrumented boundaries.

## 6. Assumptions and Constraints

1. The take-home stack is TypeScript, NestJS, Prisma ORM, SQLite, Jest, and Supertest.
2. Balances are scoped strictly by `employeeId + locationId`.
3. `requestedDays` is an integer number of days in the first version.
4. HCM provides a real-time balance API, a deduction API, and batch snapshot data.
5. HCM provides `effectiveAt` and `sourceVersion` on batch data.
6. The initial implementation is single-instance and correctness-focused.
7. Authentication is out of scope; manager actions are modeled as API commands only.
8. The repository includes an in-repo mock-backed HCM adapter used by the app in this take-home, with a separate `MockHcmHttpModule` mounted only in tests for upstream contract coverage.
9. Prisma manages the SQLite schema and connection lifecycle, while repositories remain the application persistence boundary.

## 7. System Architecture

### High-level components

1. API layer
   - `BalancesController`

- `TimeOffRequestsController`
- `ReconciliationController`
- `HealthController`

2. Application services layer

- `BalanceService`
- `TimeOffRequestService`
- `ReconciliationService`
- `ApprovalConcurrencyGate`

3. Persistence layer
   - `BalanceRepository`
   - `TimeOffRequestRepository`

- `TimeOffRequestLifecycleRepository`
- `HcmTransactionAuditRepository`
- `ReconciliationRunRepository`
- `ReconciliationLifecycleRepository`

4. Infrastructure layer

- `DatabaseModule`
- `DatabaseService`
- `TelemetryService`
- `HttpTelemetryInterceptor`

5. Integration layer

- `HcmBalanceClient`
- `HcmTimeOffClient`
- `MockHcmService`
- `MockHcmHttpModule`

6. Shared layer
   - Validation helpers
   - Error mapping and exception filters
   - Consistent API error envelope

The implementation keeps controllers thin and business rules out of controllers, but it does not introduce a separate domain-port layer for every dependency. Services depend on concrete repositories and HCM adapters to keep the take-home small and reviewable.

### Dependency direction

- Controllers depend on DTOs and services.
- Root-owned app wiring owns global validation and request telemetry.
- Services depend on concrete repositories and HCM adapters.
- Feature modules wire the repositories they use directly; persistence infrastructure is shared, but repository ownership stays feature-local rather than funneled through a single central registry.
- Repositories depend on Prisma-backed SQLite infrastructure and repository-local contracts.
- Only infrastructure concerns such as health checks or bootstrap lifecycle use the raw database service directly.
- Database and telemetry infrastructure are imported explicitly by the modules that need them rather than being exposed as global shortcuts.
- The mock HCM HTTP surface is mounted only through a dedicated test-only module rather than the public `AppModule`, but the take-home app still uses mock-backed HCM client implementations for deterministic runtime behavior.

### Persistence implementation notes

- Repositories keep stable application-facing record shapes and translate Prisma failures into repository-level persistence errors.
- Repository record and input types remain persistence-local contracts; they are not promoted to domain entities unless they acquire domain behavior that differs from storage shape.
- SQLite remains the storage engine, with Prisma transactions used for approval, reconciliation, and other multi-write invariants.
- Repository write methods should return the deterministic saved row or compare-and-set result for the mutation they performed rather than depending on a second read for correctness when that extra read is unnecessary.
- Database constraints that protect idempotency, foreign keys, and workflow integrity remain enforced at the database layer.
- Telemetry is emitted at infrastructure and repository boundaries using sanitized metadata only, after persistence failures have been classified into stable categories.

## 8. Data Model

### Balance

Represents the latest known local projection of authoritative HCM balance.

Fields:

- `id`
- `employeeId`
- `locationId`
- `availableDays`
- `sourceVersion`
- `lastSyncedAt`
- `createdAt`
- `updatedAt`

Constraints:

- unique on `employeeId + locationId`
- `availableDays >= 0` in local projection

### TimeOffRequest

Represents a requested leave operation within ReadyOn.

Fields:

- `id`
- `employeeId`
- `locationId`
- `requestedDays`
- `status`
- `idempotencyKey`
- `idempotencyPayloadHash`
- `hcmTransactionId`
- `failureCode`
- `failureReason`
- `createdAt`
- `updatedAt`
- `approvedAt`
- `rejectedAt`

Statuses:

- `PENDING`
- `APPROVED`
- `REJECTED`
- `FAILED` reserved for future request-level terminal failure handling; not emitted by the current request lifecycle
- `CANCELLED` reserved for future work only; not used in the first implementation

Status semantics:

- `PENDING`: request created, not yet finally resolved
- `APPROVED`: HCM accepted the deduction and local projection was updated
- `REJECTED`: final business denial, such as manager rejection, invalid dimensions, or insufficient balance
- `FAILED`: reserved; the current implementation records non-business terminal failure detail on the HCM audit row and keeps the request retry-safe `PENDING` until it reaches `APPROVED` or `REJECTED`

### HcmTransactionAudit

Represents the outbound HCM approval submission history for recovery and audit.

Fields:

- `id`
- `timeOffRequestId`
- `externalRequestId`
- `hcmTransactionId`
- `operation`
- `status`
- `attemptedAt`
- `completedAt`
- `errorCode`
- `errorMessage`

Constraints:

- unique on `externalRequestId`

### ReconciliationRun

Represents one processed batch reconciliation attempt.

Fields:

- `id`
- `sourceVersion`
- `effectiveAt`
- `receivedCount`
- `insertedCount`
- `updatedCount`
- `ignoredCount`
- `rejectedCount`
- `errorCount`
- `status`
- `startedAt`
- `completedAt`

## 9. API Design

### Public ReadyOn API

#### GET `/balances/:employeeId/:locationId`

Purpose:

- Return the latest known local balance projection.

Success response:

```json
{
  "employeeId": "emp_123",
  "locationId": "loc_001",
  "availableDays": 10,
  "lastSyncedAt": "2026-01-01T00:00:00.000Z"
}
```

Status codes:

- `200` if a local projection exists
- `404` with `BALANCE_NOT_FOUND` if no local projection exists yet

#### POST `/balances/:employeeId/:locationId/refresh`

Purpose:

- Fetch the latest real-time balance from HCM and upsert the local projection.

Status codes:

- `200` on refresh success
- `404` with `INVALID_EMPLOYEE_LOCATION` when HCM says the pair is invalid
- `503` with `HCM_UNAVAILABLE` when HCM cannot be reached or the response is not safely usable

#### POST `/time-off-requests`

Request body:

```json
{
  "employeeId": "emp_123",
  "locationId": "loc_001",
  "requestedDays": 2,
  "idempotencyKey": "optional-client-generated-key"
}
```

Semantics:

1. Validate payload.
2. If a known local projection exists and is already insufficient, reject immediately.
3. Otherwise create a `PENDING` request.
4. Do not deduct HCM balance during create.

Status codes:

- `201` on first successful create
- `200` on idempotent replay with the same payload
- `400` with `VALIDATION_ERROR` for malformed requests
- `409` with `INSUFFICIENT_BALANCE` for clearly insufficient local balance
- `409` with `IDEMPOTENCY_KEY_CONFLICT` when the same key is reused with a different payload

#### GET `/time-off-requests/:id`

Purpose:

- Read a single request resource for retry-safe status lookup and debugging.

Status codes:

- `200` on success
- `404` with `TIME_OFF_REQUEST_NOT_FOUND`

#### POST `/time-off-requests/:id/approve`

Semantics:

1. Load the request.
2. If the request is already `APPROVED`, return the approved resource idempotently.
3. Otherwise ensure the request is `PENDING`.
4. Acquire per-employee/location approval serialization.
5. Re-check the request state inside the serialized section.
6. Fetch or verify authoritative balance with HCM.
7. Submit deduction to HCM using a stable `externalRequestId` derived from the ReadyOn request id.
8. If HCM accepts, persist `APPROVED`, store the HCM transaction id, and update the local projection in one short local transaction.
9. If HCM rejects for business reasons, persist `REJECTED` and refresh or correct the local projection from authoritative HCM data when available.
10. If HCM is unavailable or the outcome is unknown, keep the request non-approved and allow retry-safe recovery.

Status codes:

- `200` on successful approval or replay of a previously approved request
- `404` with `TIME_OFF_REQUEST_NOT_FOUND`
- `409` with `INVALID_REQUEST_STATE` for non-pending states other than a prior successful approval replay
- `409` with `INSUFFICIENT_BALANCE`
- `409` with `INVALID_EMPLOYEE_LOCATION`
- `503` with `HCM_UNAVAILABLE` if the outcome cannot be confirmed safely

#### POST `/time-off-requests/:id/reject`

Semantics:

1. Load the request.
2. Ensure the request is `PENDING`.
3. Persist `REJECTED`.
4. Do not call HCM.

Status codes:

- `200` on success
- `404` with `TIME_OFF_REQUEST_NOT_FOUND`
- `409` with `INVALID_REQUEST_STATE`

#### POST `/hcm/balances/batch`

Purpose:

- Ingest authoritative batch balance snapshots.

Request body:

```json
{
  "sourceVersion": "batch_2026_001",
  "effectiveAt": "2026-01-01T00:00:00.000Z",
  "balances": [
    {
      "employeeId": "emp_123",
      "locationId": "loc_001",
      "availableDays": 12
    }
  ]
}
```

Response body:

```json
{
  "sourceVersion": "batch_2026_001",
  "received": 1,
  "inserted": 0,
  "updated": 1,
  "ignored": 0,
  "rejected": 0
}
```

Status codes:

- `200` on successful processing or idempotent replay
- `400` with `VALIDATION_ERROR` or `DUPLICATE_RECONCILIATION_ROW`
- `409` with `STALE_SOURCE_VERSION`

### Mock HCM API

The mock HCM HTTP surface is test-only and is not part of the public ReadyOn API contract.
It is mounted through a dedicated `MockHcmHttpModule` for focused contract tests rather than the public `AppModule`.
The take-home app still uses mock-backed HCM client implementations internally, so reviewers should treat `/mock-hcm/*` as upstream contract-test routes rather than a second public API.

## 10. HCM Integration Design

### HCM responsibilities

HCM remains authoritative for:

- current balance truth;
- validation of employee/location dimensions; and
- final deduction acceptance.

ReadyOn uses HCM for:

1. real-time balance refresh;
2. approval-time deduction submission; and
3. batch snapshot ingestion.

In this take-home, both runtime HCM clients are backed by the in-repo mock service for deterministic behavior. The separate mock HCM HTTP routes exist only for contract testing of upstream semantics.

### Outbound approval contract

ReadyOn sends:

- `employeeId`
- `locationId`
- `days`
- `externalRequestId`

Decision:

- `externalRequestId` is the ReadyOn request id.
- This makes approval retries safe even when the caller did not provide a create idempotency key.

### Mock HCM requirements

The Phase 5 mock HCM must simulate:

1. valid balances;
2. invalid dimensions;
3. insufficient balance;
4. external balance increases and decreases;
5. transient upstream failure;
6. idempotent duplicate external request ids; and
7. full-batch snapshot output.

## 11. Request Lifecycle

### Create

1. Validate request payload.
2. If a local balance projection exists and is clearly insufficient, reject with `INSUFFICIENT_BALANCE`.
3. Persist a `PENDING` request.
4. Return the created request.

### Approve

1. Acquire serialization for `employeeId + locationId`.
2. Return the existing resource immediately if it was already approved.
3. Otherwise verify the request is still `PENDING`.
4. Query HCM for latest balance or use a safe verification call.
5. If balance is insufficient, persist `REJECTED` and correct the local projection from authoritative data.
6. Submit deduction to HCM using the stable external request id.
7. On HCM success, persist `APPROVED` and the updated local projection atomically.
8. On business rejection, persist `REJECTED` with a stable failure code and authoritative balance data when available.
9. On transient or ambiguous upstream failure, do not approve locally; return a retry-safe error and preserve enough audit state for convergence.

### Reject

1. Verify request is `PENDING`.
2. Persist `REJECTED`.
3. Do not call HCM.

## 12. Balance Integrity Strategy

1. HCM is the only source of truth for entitlement and deduction.
2. ReadyOn keeps a local projection strictly for reads, UX, and resilience.
3. Local projections may block obviously impossible creates but cannot authorize final approval.
4. Approval requires authoritative HCM confirmation before local commit.
5. Projection updates happen only after authoritative HCM confirmation, including business-denial correction paths, or reconciliation.
6. Failed or rejected requests must never silently decrement local balance.

### Employee trust model

- `GET /balances/:employeeId/:locationId` returns ReadyOn's latest known local projection, not a guarantee that no HCM-side change has happened since the last sync.
- `lastSyncedAt` is the freshness signal that tells the employee when that projection was last synchronized.
- `POST /balances/:employeeId/:locationId/refresh` fetches the current authoritative HCM balance and overwrites stale local data.
- Approval never trusts the cached balance alone; ReadyOn re-checks HCM before approving and corrects the local projection if HCM rejects for insufficient balance or invalid dimensions.
- Batch reconciliation repairs any remaining drift caused by independent HCM changes or partial failures.

## 13. Batch Reconciliation Strategy

### Chosen policy

- `effectiveAt` is the primary freshness signal.
- `sourceVersion` is the unique batch identity and replay key.
- An exact replay of an already processed `sourceVersion` is an idempotent no-op.
- A batch with older `effectiveAt` than the current authoritative projection is stale and rejected.
- A batch with the same `effectiveAt` but a different unseen `sourceVersion` is rejected as conflicting.
- Duplicate `employeeId + locationId` rows in the same batch are rejected as invalid input.

### Why this policy

It provides deterministic stale-batch behavior without relying on lexical sorting of opaque version strings and avoids silent overwrites when the upstream batch contract is inconsistent.

## 14. Idempotency Strategy

### Create-time idempotency

- The create endpoint accepts an optional client `idempotencyKey`.
- When present, ReadyOn stores both the key and a canonical payload hash.
- Same key + same payload returns the existing request.
- Same key + different payload returns `IDEMPOTENCY_KEY_CONFLICT`.

### Approval-time idempotency

- Approval reuses the ReadyOn request id as `externalRequestId` for HCM.
- Duplicate approval calls for the same request must not create multiple HCM deductions.
- If HCM accepted but the local commit failed, a retry converges by reusing the same external request id and reading the confirmed outcome.

### Reconciliation idempotency

- Exact replay of a previously processed batch is a no-op.
- Older or conflicting batches are rejected rather than partially applied.

## 15. Error Handling Strategy

### Public error envelope

```json
{
  "error": {
    "code": "INSUFFICIENT_BALANCE",
    "message": "Available balance is insufficient for the requested time off.",
    "details": {
      "employeeId": "emp_123",
      "locationId": "loc_001",
      "requestedDays": 5,
      "availableDays": 3,
      "source": "HCM"
    }
  }
}
```

### Standard public error codes

- `VALIDATION_ERROR`
- `BALANCE_NOT_FOUND`
- `TIME_OFF_REQUEST_NOT_FOUND`
- `INVALID_REQUEST_STATE`
- `INSUFFICIENT_BALANCE`
- `INVALID_EMPLOYEE_LOCATION`
- `HCM_UNAVAILABLE`
- `STALE_SOURCE_VERSION`
- `IDEMPOTENCY_KEY_CONFLICT`
- `DUPLICATE_RECONCILIATION_ROW`

### Error-handling rules

1. Never return raw SQLite errors.
2. Never return raw HCM payloads or stack traces.
3. Map malformed input to `VALIDATION_ERROR`.
4. Map HCM invalid dimension responses to `INVALID_EMPLOYEE_LOCATION`.
5. Map HCM insufficient balance to `INSUFFICIENT_BALANCE`.
6. Map transient or unknown upstream failures to `HCM_UNAVAILABLE`.
7. Use `INVALID_REQUEST_STATE` for non-pending approval or rejection attempts, except for approval replay after prior success, which returns `200` with the existing approved resource.

## 16. Race Condition Strategy

### Chosen approach

Use application-level keyed serialization per `employeeId + locationId` for approvals, combined with short SQLite transactions and idempotent HCM submission.

### Why this approach

1. SQLite has coarse write locking and is a poor fit for long-running transactions that include network calls.
2. Application-level keyed serialization keeps the critical section deterministic for the take-home stack.
3. HCM idempotency via `externalRequestId` prevents double deduction after retry or crash recovery.
4. Short local transactions still protect local state changes and audit writes.

### Known limitation

This strategy is safe for a single service instance. A multi-instance deployment would need a distributed lock, a queue-per-key model, or a database with stronger row-level concurrency controls.

## 17. Observability and Logging Strategy

1. Use structured logs with request correlation ids for each incoming HTTP request and selected downstream infrastructure boundaries.
2. The current implementation emits telemetry for HTTP request completion, database bootstrap and ping outcomes, repository mutation outcomes, and reconciliation summaries. Dedicated HCM-client-edge telemetry is future work.
3. Exclude raw HCM bodies, raw SQL, secrets, stack traces, request payloads, idempotency keys, external request identifiers, HCM transaction identifiers, filesystem paths, and raw driver errors from normal logs and client-facing responses.
4. Emit low-cardinality metadata only:

- request id
- component
- operation
- route label when relevant
- outcome category
- duration
- status code or transition kind
- count summaries for reconciliation or batch processing
- idempotency-key presence only when operationally useful

5. Telemetry safety currently relies on allow-listed event payloads and focused tests rather than a centralized redaction layer.
6. Persistence failures must be logged only after they have been mapped into stable product-level categories such as conflict, constraint, unavailable, or unexpected.
7. Keep observability minimal but sufficient for reviewer confidence.

## 18. Alternatives Considered

### A. ReadyOn as source of truth vs HCM as source of truth

- Rejected: ReadyOn as source of truth
- Chosen: HCM as source of truth with a ReadyOn local projection

Reason:

ReadyOn cannot safely out-authorize the canonical HCM balance when external changes can happen independently.

### B. Synchronous HCM confirmation vs asynchronous approval

- Rejected: asynchronous approval with later deduction
- Chosen: synchronous approval-time HCM confirmation

Reason:

The take-home is evaluated on balance integrity. Synchronous confirmation is easier to defend and easier to test rigorously.

### C. Realtime-only sync vs batch reconciliation

- Rejected: realtime-only sync
- Chosen: realtime refresh plus batch reconciliation

Reason:

Real-time calls alone do not repair drift caused by independent HCM updates or partial outages.

### D. Local cached balances vs always querying HCM

- Rejected: always querying HCM for every balance read
- Chosen: local projection for reads, HCM confirmation for approval

Reason:

This preserves good UX and resilience without weakening approval correctness.

### E. Optimistic concurrency vs serialized approval

- Rejected: optimistic-only concurrency for phase one
- Chosen: keyed serialized approval per employee/location

Reason:

SQLite and a single-instance service make keyed serialization easier to implement and easier to explain than optimistic conflict retries across upstream network calls.

### F. REST vs alternative API styles

- Chosen: REST
- Rejected: alternative API styles for this take-home

Reason:

The prompt explicitly allows REST and the required operations map naturally to clear, testable HTTP endpoints.

## 19. Testing Strategy

The implemented test suite uses:

1. unit tests for validation, state transitions, stale-batch policies, and idempotency rules;
2. integration tests for services, repositories, and SQLite-backed invariants;
3. Supertest end-to-end tests for the public API contract;
4. mock HCM contract tests for real-time lookup, deduction, adjustments, and duplicate submissions;
5. reconciliation tests for stale, duplicate, replay, and corrective-batch behavior;
6. race-condition tests for concurrent approvals; and
7. coverage proof with targets of 80% statements, 75% branches, 80% functions, and 80% lines.

The companion `TEST_PLAN.md` is the authoritative scenario matrix.

## 20. Known Limitations and Future Work

1. The first implementation assumes a single service instance for approval serialization.
2. Authentication and authorization are out of scope.
3. The first version handles whole days only.
4. The mock HCM is not a substitute for a real vendor contract test suite.
5. Recovery from a confirmed HCM success plus local persistence crash relies on retry convergence and reconciliation, not a distributed transaction.
6. SQLite is sufficient for the take-home but not the intended long-term scale choice.
7. Telemetry safety relies on allow-listed event payloads and focused tests; dedicated HCM-client-edge telemetry is not implemented separately.

Future work:

1. Replace in-process keyed serialization with a distributed-safe approach.
2. Add production-grade migrations, health checks, and operational dashboards.
3. Add authentication and manager identity enforcement.
4. Support cancellation and fractional-day leave if the product requires them.
5. Add real HCM vendor contract testing.
