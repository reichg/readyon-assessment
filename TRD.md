# Technical Requirements Document

## Table of Contents

- Context and scope
  - [1. Problem Statement](#1-problem-statement)
  - [2. Goals](#2-goals)
  - [3. Non-Goals](#3-non-goals)
  - [4. User Personas](#4-user-personas)
  - [5. Requirements](#5-requirements)
  - [6. Assumptions and Constraints](#6-assumptions-and-constraints)
- Architecture and interfaces
  - [7. System Architecture](#7-system-architecture)
    - [High-level components](#high-level-components)
    - [Dependency direction](#dependency-direction)
    - [Persistence implementation notes](#persistence-implementation-notes)
  - [8. Data Model](#8-data-model)
  - [9. API Design](#9-api-design)
    - [Public ReadyOn API](#public-readyon-api)
    - [Mock HCM API](#mock-hcm-api)
  - [10. HCM Integration Design](#10-hcm-integration-design)
    - [HCM responsibilities](#hcm-responsibilities)
    - [Outbound approval contract](#outbound-approval-contract)
    - [Mock HCM requirements](#mock-hcm-requirements)
- Runtime behavior and safety
  - [11. Request Lifecycle](#11-request-lifecycle)
    - [Create](#create)
    - [Approve](#approve)
    - [Reject](#reject)
  - [12. Balance Integrity Strategy](#12-balance-integrity-strategy)
  - [13. Batch Reconciliation Strategy](#13-batch-reconciliation-strategy)
  - [14. Idempotency Strategy](#14-idempotency-strategy)
  - [15. Error Handling Strategy](#15-error-handling-strategy)
  - [16. Race Condition Strategy](#16-race-condition-strategy)
  - [17. Observability and Logging Strategy](#17-observability-and-logging-strategy)
- Evaluation and follow-up
  - [18. Alternatives Considered](#18-alternatives-considered)
    - [A. ReadyOn as source of truth vs HCM as source of truth](#a-readyon-as-source-of-truth-vs-hcm-as-source-of-truth)
    - [B. Synchronous HCM confirmation vs asynchronous approval](#b-synchronous-hcm-confirmation-vs-asynchronous-approval)
    - [C. Local projection reads vs always querying HCM](#c-local-projection-reads-vs-always-querying-hcm)
    - [D. Realtime-only sync vs realtime plus batch reconciliation](#d-realtime-only-sync-vs-realtime-plus-batch-reconciliation)
    - [E. Last-write-wins batch updates vs deterministic replay and stale-batch rejection](#e-last-write-wins-batch-updates-vs-deterministic-replay-and-stale-batch-rejection)
    - [F. Create-time reservation or HCM authorization vs lightweight `PENDING` creation](#f-create-time-reservation-or-hcm-authorization-vs-lightweight-pending-creation)
    - [G. Single idempotency mechanism or distributed exactly-once semantics vs split retry-safety strategy](#g-single-idempotency-mechanism-or-distributed-exactly-once-semantics-vs-split-retry-safety-strategy)
    - [H. Optimistic-only concurrency vs keyed serialized approval](#h-optimistic-only-concurrency-vs-keyed-serialized-approval)
    - [I. REST vs GraphQL or RPC-style command APIs](#i-rest-vs-graphql-or-rpc-style-command-apis)
    - [J. Broad ports-and-adapters abstraction vs direct repository and HCM adapter dependencies](#j-broad-ports-and-adapters-abstraction-vs-direct-repository-and-hcm-adapter-dependencies)
    - [K. External standalone mock HCM for all runtime calls vs in-repo mock-backed clients plus dedicated HTTP contract coverage](#k-external-standalone-mock-hcm-for-all-runtime-calls-vs-in-repo-mock-backed-clients-plus-dedicated-http-contract-coverage)
  - [19. Testing Strategy](#19-testing-strategy)
  - [20. Known Limitations and Future Work](#20-known-limitations-and-future-work)

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

- Rejected: ReadyOn as the authoritative balance ledger
- Chosen: HCM as source of truth with ReadyOn storing a local projection

Tradeoff:

Making ReadyOn authoritative would simplify some reads and approvals, but it would also require ReadyOn to absorb independent HCM events such as annual refreshes, work anniversary grants, manual corrections, and delayed upstream adjustments without drifting or accidentally over-authorizing leave. In practice that would move the hardest reconciliation burden into ReadyOn and still require reverse synchronization back into HCM.

The chosen design keeps HCM authoritative for entitlement, dimension validity, and final deduction acceptance, while ReadyOn keeps a local projection for fast reads and responsive request creation. ReadyOn still validates inputs and can fail fast when the known local projection is clearly insufficient, but it does not treat the local database as the final approval authority.

### B. Synchronous HCM confirmation vs asynchronous approval

- Rejected: asynchronous approval with later HCM deduction, outbox processing, or eventual correction
- Chosen: synchronous approval-time HCM confirmation with retry-safe recovery

Tradeoff:

An asynchronous model can improve throughput and reduce user-facing dependency on HCM latency, but it creates a harder consistency story: ReadyOn could show an approved request before HCM has actually accepted the deduction, which then requires compensating transitions, reconciliation-first repair, or a more complex saga/outbox design.

The chosen flow keeps approval semantics conservative: a request is approved only after HCM confirms the deduction. This is easier to reason about for a take-home, easier to validate under test, and better aligned with the requirement to protect balance integrity. The tradeoff is that approval depends on HCM availability, so ambiguous upstream outcomes fail closed and remain retry-safe rather than being guessed into a final state.

### C. Local projection reads vs always querying HCM

- Rejected: live HCM reads for every balance lookup
- Chosen: local projection for reads plus an explicit HCM-backed refresh path

Tradeoff:

Always reading from HCM would maximize freshness, but it would also make routine balance reads dependent on upstream latency and availability and would weaken the user experience when HCM is slow or temporarily unavailable. It would also remove a local view that can be corrected and inspected during reconciliation scenarios.

The chosen design treats `GET /balances` as the latest known local projection, exposes freshness through `lastSyncedAt`, and provides `POST /balances/:employeeId/:locationId/refresh` when the caller wants an authoritative refresh before a decision. Approval still re-confirms with HCM, so local reads optimize UX without becoming the final authorization boundary.

### D. Realtime-only sync vs realtime plus batch reconciliation

- Rejected: realtime-only refresh and deduction calls
- Chosen: realtime HCM interactions plus authoritative batch reconciliation

Tradeoff:

Realtime calls are necessary for refresh and approval, but they are not sufficient to repair drift. Independent HCM-side changes, missed refreshes, partial outages, or local failures after an upstream success can still leave ReadyOn's projection stale.

The chosen design uses realtime calls for interactive correctness and batch reconciliation for drift repair. This combination gives the service both a responsive path for day-to-day usage and a deterministic correction path when HCM changes outside ReadyOn or when prior operations leave uncertainty.

### E. Last-write-wins batch updates vs deterministic replay and stale-batch rejection

- Rejected: unconditional batch overwrite or simple last-write-wins reconciliation
- Chosen: deterministic reconciliation with replay-safe no-op handling and stale-batch rejection

Tradeoff:

Applying every arriving batch would be simple, but it risks overwriting fresher projections with older data and makes correctness depend on delivery order rather than explicit freshness rules. That is especially risky when realtime refresh has already corrected a balance more recently than an older batch snapshot.

The chosen policy treats exact replay of the same batch as a safe no-op and rejects stale or older batches instead of guessing. This keeps reconciliation deterministic, avoids clobbering fresher local projections, and gives reviewers a clearer integrity model than a permissive merge policy would.

### F. Create-time reservation or HCM authorization vs lightweight `PENDING` creation

- Rejected: reserving or deducting balance at create time
- Chosen: create-time local screening plus `PENDING` request creation, with HCM confirmation at approval

Tradeoff:

Reserving balance during request creation could reduce later approval failures, but it would introduce a more complicated lifecycle around expired reservations, manager rejection, cancellation, and compensation. It would also push HCM dependency into create flows that are otherwise allowed to remain lightweight.

The chosen approach lets ReadyOn reject obviously impossible requests when the known local projection is already insufficient, but otherwise creates a `PENDING` request and defers final entitlement confirmation to approval time. This keeps request creation responsive and idempotent while avoiding false claims that a created request has already secured leave.

### G. Single idempotency mechanism or distributed exactly-once semantics vs split retry-safety strategy

- Rejected: one universal idempotency mechanism or a distributed exactly-once transaction across ReadyOn and HCM
- Chosen: split retry safety with ReadyOn-owned create idempotency and approval-time HCM replay protection

Tradeoff:

Exactly-once semantics across a local database and an external HCM system would require a heavier distributed coordination model than this take-home needs. A single idempotency mechanism also hides an important distinction: create and approve have different failure modes and different sources of truth.

The chosen design uses client-visible idempotency keys for request creation and a stable external request identity plus audit history for approval retries. That does not eliminate every ambiguous failure mode automatically, but it does make retries converge safely without double deduction and without overstating the guarantee as a distributed transaction.

### H. Optimistic-only concurrency vs keyed serialized approval

- Rejected: optimistic-only retries around approval or long-lived database locking across upstream calls
- Chosen: keyed serialized approval per `employeeId + locationId` in the single-instance service

Tradeoff:

Optimistic-only concurrency is appealing when the database can cheaply arbitrate conflicts, but this flow includes upstream HCM network calls and approval-side side effects. Holding database transactions open across those calls is undesirable, and optimistic retry logic becomes harder to explain when two approvals are racing against a limited authoritative balance.

The chosen keyed gate keeps the critical approval path simple for SQLite and the single-instance take-home. Approvals that touch the same employee and location are serialized before final HCM confirmation, which is easier to reason about and easier to test than optimistic conflict retries in phase one. The limitation is explicit: this is a single-instance strategy, not a distributed coordination model.

### I. REST vs GraphQL or RPC-style command APIs

- Rejected: GraphQL or custom RPC-style command APIs for phase one
- Chosen: REST

Tradeoff:

GraphQL could reduce endpoint count and support flexible reads, while RPC-style commands can model workflows like approve and reject directly. Neither is inherently wrong, but this service already has a small, explicit surface made up of resource reads plus command-like transitions.

REST fits the exercise well because balances, requests, refresh, approval, rejection, and reconciliation ingest all map naturally to clear HTTP endpoints with deterministic status codes and easy Supertest coverage. The prompt explicitly permits REST, so choosing it avoided introducing extra transport complexity that would not improve balance integrity.

### J. Broad ports-and-adapters abstraction vs direct repository and HCM adapter dependencies

- Rejected: introducing a separate abstract port for every persistence and HCM interaction in phase one
- Chosen: keep controllers thin, keep workflow in services, and let services depend on concrete repositories and HCM adapters

Tradeoff:

A broader ports-and-adapters design can make dependency inversion more formal and can help when multiple implementations must be swapped frequently. For this take-home, that extra layer would add indirection without materially improving the core consistency story.

The chosen design keeps module ownership and dependency direction clear without over-abstracting: controllers remain transport-only, services own orchestration, repositories own persistence mapping, and HCM clients own upstream I/O. This keeps the code reviewable while still preserving clean boundaries.

### K. External standalone mock HCM for all runtime calls vs in-repo mock-backed clients plus dedicated HTTP contract coverage

- Rejected: depending on an always-running external mock server for normal app behavior in the take-home
- Chosen: mock-backed HCM clients in the app plus a dedicated mock HCM HTTP module for contract-style tests

Tradeoff:

An external mock server can look more realistic, but it also adds more moving parts to local setup, makes tests less deterministic, and shifts reviewer effort into environment orchestration rather than design evaluation.

The chosen approach keeps the application deterministic and easy to run while still satisfying the requirement to provide mock HCM endpoints in the automated test suite. The dedicated HTTP mock surface proves the upstream contract behavior, and the in-app mock-backed clients keep the service itself simple to evaluate.

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
