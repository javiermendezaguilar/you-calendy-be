const request = require("supertest");
const mongoose = require("mongoose");
const app = require("../app");

describe("health endpoints", () => {
  test("GET /healthz returns liveness without depending on Mongo", async () => {
    const res = await request(app).get("/healthz");

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      success: true,
      status: "ok",
      service: "groomnest-backend",
    });
    expect(typeof res.body.timestamp).toBe("string");
  });

  test("GET /readyz returns readiness from mongoose state", async () => {
    const originalReadyState = mongoose.connection._readyState;

    mongoose.connection._readyState = 1;
    const readyRes = await request(app).get("/readyz");

    expect(readyRes.status).toBe(200);
    expect(readyRes.body).toMatchObject({
      success: true,
      status: "ready",
      checks: {
        database: "connected",
      },
    });

    mongoose.connection._readyState = 0;
    const notReadyRes = await request(app).get("/readyz");

    expect(notReadyRes.status).toBe(503);
    expect(notReadyRes.body).toMatchObject({
      success: false,
      status: "not_ready",
      checks: {
        database: "disconnected",
      },
    });
    mongoose.connection._readyState = originalReadyState;
  });
});
