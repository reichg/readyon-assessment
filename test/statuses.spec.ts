import {
  RECONCILIATION_RUN_STATUSES,
  TERMINAL_RECONCILIATION_RUN_STATUSES,
} from "../src/reconciliation/shapes/reconciliation-run-status";
import {
  TERMINAL_TIME_OFF_REQUEST_STATUSES,
  TIME_OFF_REQUEST_STATUSES,
} from "../src/time-off/shapes/time-off-request-status";

describe("Feature status constants", () => {
  it("exposes all supported time-off request statuses and terminal statuses", () => {
    expect(TIME_OFF_REQUEST_STATUSES).toEqual([
      "PENDING",
      "APPROVED",
      "REJECTED",
      "FAILED",
    ]);
    expect(TERMINAL_TIME_OFF_REQUEST_STATUSES).toEqual([
      "APPROVED",
      "REJECTED",
      "FAILED",
    ]);
    expect(TERMINAL_TIME_OFF_REQUEST_STATUSES).not.toContain("PENDING");
  });

  it("exposes all supported reconciliation statuses and terminal statuses", () => {
    expect(RECONCILIATION_RUN_STATUSES).toEqual([
      "STARTED",
      "COMPLETED",
      "FAILED",
      "REJECTED",
    ]);
    expect(TERMINAL_RECONCILIATION_RUN_STATUSES).toEqual([
      "COMPLETED",
      "FAILED",
      "REJECTED",
    ]);
    expect(TERMINAL_RECONCILIATION_RUN_STATUSES).not.toContain("STARTED");
  });
});
