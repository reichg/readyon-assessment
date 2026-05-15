import type { TimeOffRequestStatus } from "./time-off-request-status";

export interface TimeOffRequestResponse {
  id: string;
  employeeId: string;
  locationId: string;
  requestedDays: number;
  status: TimeOffRequestStatus;
  failureCode: string | null;
  createdAt: string;
  updatedAt: string;
  approvedAt: string | null;
  rejectedAt: string | null;
}
