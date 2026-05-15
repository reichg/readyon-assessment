import type { TimeOffRequestResponse } from "../../src/time-off/shapes/time-off-request-response";
import type { TimeOffRequestService } from "../../src/time-off/time-off-request.service";
import { TimeOffRequestsController } from "../../src/time-off/time-off-requests.controller";

interface MockHttpStatusResponse {
  status: jest.Mock;
}

describe("TimeOffRequestsController", () => {
  const requestResponse: TimeOffRequestResponse = {
    id: "request_123",
    employeeId: "emp_123",
    locationId: "loc_001",
    requestedDays: 2,
    status: "PENDING",
    failureCode: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    approvedAt: null,
    rejectedAt: null,
  };

  function createController() {
    const service = {
      createRequest: jest.fn(),
      getRequest: jest.fn(),
      approveRequest: jest.fn(),
      rejectRequest: jest.fn(),
    } as unknown as jest.Mocked<TimeOffRequestService>;

    return {
      controller: new TimeOffRequestsController(service),
      service,
    };
  }

  function createResponse(): MockHttpStatusResponse {
    return {
      status: jest.fn(),
    };
  }

  it("returns 201 when create persists a new request", async () => {
    const { controller, service } = createController();
    const response = createResponse();

    service.createRequest.mockResolvedValue({
      request: requestResponse,
      wasReplay: false,
    });

    await expect(
      controller.createRequest(
        {
          employeeId: "emp_123",
          locationId: "loc_001",
          requestedDays: 2,
        },
        response,
      ),
    ).resolves.toEqual(requestResponse);
    expect(response.status).toHaveBeenCalledWith(201);
  });

  it("returns 200 when create replays an idempotent request", async () => {
    const { controller, service } = createController();
    const response = createResponse();

    service.createRequest.mockResolvedValue({
      request: requestResponse,
      wasReplay: true,
    });

    await expect(
      controller.createRequest(
        {
          employeeId: "emp_123",
          locationId: "loc_001",
          requestedDays: 2,
        },
        response,
      ),
    ).resolves.toEqual(requestResponse);
    expect(response.status).toHaveBeenCalledWith(200);
  });

  it("delegates get by id to the service", async () => {
    const { controller, service } = createController();

    service.getRequest.mockResolvedValue(requestResponse);

    await expect(controller.getRequest({ id: "request_123" })).resolves.toEqual(
      requestResponse,
    );
    expect(service.getRequest).toHaveBeenCalledWith("request_123");
  });

  it("delegates approve by id to the service", async () => {
    const { controller, service } = createController();
    const approvedResponse = {
      ...requestResponse,
      status: "APPROVED" as const,
      updatedAt: "2026-01-02T00:00:00.000Z",
      approvedAt: "2026-01-02T00:00:00.000Z",
    };

    service.approveRequest.mockResolvedValue(approvedResponse);

    await expect(
      controller.approveRequest({ id: "request_123" }),
    ).resolves.toEqual(approvedResponse);
    expect(service.approveRequest).toHaveBeenCalledWith("request_123");
  });

  it("delegates reject by id to the service", async () => {
    const { controller, service } = createController();
    const rejectedResponse = {
      ...requestResponse,
      status: "REJECTED" as const,
      updatedAt: "2026-01-02T00:00:00.000Z",
      rejectedAt: "2026-01-02T00:00:00.000Z",
    };

    service.rejectRequest.mockResolvedValue(rejectedResponse);

    await expect(
      controller.rejectRequest({ id: "request_123" }),
    ).resolves.toEqual(rejectedResponse);
    expect(service.rejectRequest).toHaveBeenCalledWith("request_123");
  });
});
