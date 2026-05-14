import type {
  TerminalTimeOffRequestStatus,
  TimeOffRequestStatus,
} from "../../time-off/shapes/time-off-request-status";

export interface TimeOffRequestRecord {
  id: string;
  employeeId: string;
  locationId: string;
  requestedDays: number;
  status: TimeOffRequestStatus;
  idempotencyKey: string | null;
  idempotencyPayloadHash: string | null;
  hcmTransactionId: string | null;
  failureCode: string | null;
  failureReason: string | null;
  createdAt: string;
  updatedAt: string;
  approvedAt: string | null;
  rejectedAt: string | null;
}

export interface CreatePendingTimeOffRequestInput {
  id?: string;
  employeeId: string;
  locationId: string;
  requestedDays: number;
  idempotencyKey?: string | null;
  idempotencyPayloadHash?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export interface UpdateTimeOffRequestStatusInput {
  id: string;
  status: TerminalTimeOffRequestStatus;
  updatedAt?: string;
  approvedAt?: string | null;
  rejectedAt?: string | null;
  hcmTransactionId?: string | null;
  failureCode?: string | null;
  failureReason?: string | null;
}
