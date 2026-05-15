import { createApiErrorResponse } from "../../src/http/api-error";

describe("createApiErrorResponse", () => {
  it("omits details when they are not provided", () => {
    expect(
      createApiErrorResponse({
        code: "NOT_FOUND",
        message: "Resource was not found.",
      }),
    ).toEqual({
      error: {
        code: "NOT_FOUND",
        message: "Resource was not found.",
      },
    });
  });

  it("includes details when they are provided", () => {
    expect(
      createApiErrorResponse({
        code: "VALIDATION_ERROR",
        message: "Request validation failed.",
        details: {
          violations: ["employeeId must be a string"],
        },
      }),
    ).toEqual({
      error: {
        code: "VALIDATION_ERROR",
        message: "Request validation failed.",
        details: {
          violations: ["employeeId must be a string"],
        },
      },
    });
  });
});
