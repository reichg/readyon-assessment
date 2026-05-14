export const TIME_OFF_REQUEST_STATUSES = [
  "PENDING",
  "APPROVED",
  "REJECTED",
  "FAILED",
] as const;

export const TERMINAL_TIME_OFF_REQUEST_STATUSES = [
  "APPROVED",
  "REJECTED",
  "FAILED",
] as const;

export type TimeOffRequestStatus = (typeof TIME_OFF_REQUEST_STATUSES)[number];

export type TerminalTimeOffRequestStatus =
  (typeof TERMINAL_TIME_OFF_REQUEST_STATUSES)[number];
