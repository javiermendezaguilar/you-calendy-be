const express = require("express");
const request = require("supertest");
const {
  createEconomicRateLimiter,
  createOperationalRateLimiter,
} = require("../middleware/economicRateLimit");

const buildLimitedApp = (limiter) => {
  const app = express();

  app.use((req, res, next) => {
    if (req.headers["x-test-user-id"]) {
      req.user = {
        id: req.headers["x-test-user-id"],
        role: "barber",
      };
    }
    next();
  });
  app.use(limiter);
  app.post("/limited-write", (req, res) => {
    res.status(200).json({ success: true });
  });

  return app;
};

const postLimitedWrite = (app, userId = "default-user") =>
  request(app).post("/limited-write").set("x-test-user-id", userId);

const expectSecondAttemptLimited = async (app, expectedMessage, userId) => {
  const firstAttempt = await postLimitedWrite(app, userId);
  expect(firstAttempt.status).toBe(200);

  const secondAttempt = await postLimitedWrite(app, userId);
  expect(secondAttempt.status).toBe(429);
  expect(secondAttempt.body).toEqual({
    success: false,
    message: expectedMessage,
  });
};

const loadLimiterWithEnv = (envValues, exportName) => {
  const previousValues = {};

  Object.keys(envValues).forEach((key) => {
    previousValues[key] = process.env[key];
    process.env[key] = envValues[key];
  });

  try {
    jest.resetModules();
    return require("../middleware/economicRateLimit")[exportName];
  } finally {
    Object.keys(envValues).forEach((key) => {
      if (previousValues[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = previousValues[key];
      }
    });

    jest.resetModules();
  }
};

describe("Economic rate limiting v1", () => {
  test("limits repeated economic write attempts", async () => {
    const app = buildLimitedApp(
      createEconomicRateLimiter({
        windowMs: 60 * 1000,
        max: 1,
        message: "Economic writes are limited",
      })
    );

    await expectSecondAttemptLimited(app, "Economic writes are limited");
  });

  test("limits repeated operational write attempts", async () => {
    const app = buildLimitedApp(
      createOperationalRateLimiter({
        windowMs: 60 * 1000,
        max: 1,
        message: "Operational writes are limited",
      })
    );

    await expectSecondAttemptLimited(app, "Operational writes are limited");
  });

  test("supports env-configured credit checkout limiter", async () => {
    const creditCheckoutWriteLimiter = loadLimiterWithEnv(
      { CREDIT_CHECKOUT_RATE_LIMIT: "1" },
      "creditCheckoutWriteLimiter"
    );
    const app = buildLimitedApp(creditCheckoutWriteLimiter);

    await expectSecondAttemptLimited(
      app,
      "Too many credit checkout attempts, please try again later.",
      "credit-user-a"
    );
  });

  test("scopes authenticated operation limits by actor", async () => {
    const communicationWriteLimiter = loadLimiterWithEnv(
      { COMMUNICATION_WRITE_RATE_LIMIT: "1" },
      "communicationWriteLimiter"
    );
    const app = buildLimitedApp(communicationWriteLimiter);

    const firstActorAttempt = await postLimitedWrite(app, "actor-a");
    expect(firstActorAttempt.status).toBe(200);

    const otherActorAttempt = await postLimitedWrite(app, "actor-b");
    expect(otherActorAttempt.status).toBe(200);

    const repeatedActorAttempt = await postLimitedWrite(app, "actor-a");
    expect(repeatedActorAttempt.status).toBe(429);
    expect(repeatedActorAttempt.body.message).toBe(
      "Too many communication attempts, please try again later."
    );
  });
});
