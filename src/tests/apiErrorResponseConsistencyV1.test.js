const request = require("supertest");
const app = require("../app");
const restrictAccess = require("../middleware/restrictAccess");
const ErrorHandler = require("../utils/ErrorHandler");
const {
  normalizeErrorMessage,
  normalizeErrorStatus,
  sendErrorResponse,
} = require("../utils/apiResponse");

const mockResponse = () => {
  const res = {
    statusCode: null,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
  };

  return res;
};

describe("api error response consistency v1", () => {
  test.each([400, 401, 403, 404, 409, 422, 500])(
    "sends canonical wrapper for status %i",
    (statusCode) => {
      const res = mockResponse();

      sendErrorResponse(res, {
        statusCode,
        message: `status ${statusCode} error`,
      });

      expect(res.statusCode).toBe(statusCode);
      expect(res.body).toEqual({
        success: false,
        message: `status ${statusCode} error`,
      });
    }
  );

  test("normalizes invalid status codes to 500", () => {
    expect(normalizeErrorStatus(undefined)).toBe(500);
    expect(normalizeErrorStatus(200)).toBe(500);
    expect(normalizeErrorStatus("not-a-status")).toBe(500);
  });

  test("normalizes missing messages without dropping the wrapper", () => {
    expect(normalizeErrorMessage(undefined, 400)).toBe("Request failed");
    expect(normalizeErrorMessage(undefined, 500)).toBe("Internal Server Error");
  });

  test("keeps legacy ErrorHandler response shape canonical", () => {
    const res = mockResponse();
    const req = { method: "GET", url: "/test" };

    ErrorHandler("Legacy failure", 422, req, res);

    expect(res.statusCode).toBe(422);
    expect(res.body).toEqual({
      success: false,
      message: "Legacy failure",
    });
  });

  test("keeps unknown route errors canonical", async () => {
    const res = await request(app).get("/definitely-not-a-real-route");

    expect(res.status).toBe(404);
    expect(res.body).toMatchObject({
      success: false,
      message: "Not found",
    });
  });

  test("keeps validation errors canonical before controller execution", async () => {
    const res = await request(app).get("/services?businessId=not-an-object-id");

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toMatch(/^Invalid request:/);
  });

  test("keeps auth errors canonical", async () => {
    const res = await request(app).get("/auth/me");

    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({
      success: false,
      message: "Not logged in",
    });
  });

  test("keeps restrictAccess errors canonical", async () => {
    const res = mockResponse();
    const req = { method: "GET", url: "/protected", user: null };
    const next = jest.fn();

    await restrictAccess(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(401);
    expect(res.body).toEqual({
      success: false,
      message: "Not Authenticated",
    });
  });
});

