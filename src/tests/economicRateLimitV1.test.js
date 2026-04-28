const express = require("express");
const request = require("supertest");
const {
  createEconomicRateLimiter,
} = require("../middleware/economicRateLimit");

describe("Economic rate limiting v1", () => {
  test("limits repeated economic write attempts", async () => {
    const app = express();

    app.use(
      createEconomicRateLimiter({
        windowMs: 60 * 1000,
        max: 1,
        message: "Economic writes are limited",
      })
    );
    app.post("/economic-write", (req, res) => {
      res.status(200).json({ success: true });
    });

    const firstAttempt = await request(app).post("/economic-write");
    expect(firstAttempt.status).toBe(200);

    const secondAttempt = await request(app).post("/economic-write");
    expect(secondAttempt.status).toBe(429);
    expect(secondAttempt.body.message).toBe("Economic writes are limited");
  });
});
