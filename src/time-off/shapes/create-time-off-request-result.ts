import type { TimeOffRequestResponse } from "./time-off-request-response";

export interface CreateTimeOffRequestResult {
  request: TimeOffRequestResponse;
  wasReplay: boolean;
}
