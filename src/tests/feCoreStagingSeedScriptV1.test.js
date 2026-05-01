const {
  CONFIRMATION_PHRASE,
  assertSeedTargetCanWrite,
  buildSeedPlan,
  buildSeedTargetContext,
  inferDatabaseName,
  parseArgs,
  runSeed,
} = require("../../scripts/fe-core-staging-seed");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const User = require("../models/User/user");
const Business = require("../models/User/business");
const Client = require("../models/client");
const Service = require("../models/service");
const Staff = require("../models/staff");
const Appointment = require("../models/appointment");
const Checkout = require("../models/checkout");
const Payment = require("../models/payment");
const Refund = require("../models/refund");
const CashSession = require("../models/cashSession");
const DomainEvent = require("../models/domainEvent");

jest.setTimeout(30000);

describe("FE core staging seed script contract", () => {
  test("parses CLI flags used by the runbook", () => {
    const args = parseArgs([
      "--dry-run",
      "--confirm",
      CONFIRMATION_PHRASE,
      "--mongo-uri=mongodb://localhost:27017/groomnest-local",
    ]);

    expect(args).toMatchObject({
      dryRun: true,
      confirm: CONFIRMATION_PHRASE,
      mongoUri: "mongodb://localhost:27017/groomnest-local",
    });
  });

  test("infers Atlas database name from Mongo URI", () => {
    expect(
      inferDatabaseName(
        "mongodb+srv://user:pass@cluster.mongodb.net/You-Calendy-Be-Staging?retryWrites=true&w=majority"
      )
    ).toBe("You-Calendy-Be-Staging");
  });

  test("rejects production environments before any write", () => {
    const context = buildSeedTargetContext(
      {
        MONGO_URI: "mongodb+srv://user:pass@cluster.mongodb.net/You-Calendy-Be",
        RAILWAY_ENVIRONMENT_NAME: "production",
        NODE_ENV: "production",
      },
      { confirm: CONFIRMATION_PHRASE }
    );

    expect(() => assertSeedTargetCanWrite(context)).toThrow(/production/i);
  });

  test("requires explicit confirmation before staging writes", () => {
    const context = buildSeedTargetContext(
      {
        MONGO_URI:
          "mongodb+srv://user:pass@cluster.mongodb.net/You-Calendy-Be-Staging",
        RAILWAY_ENVIRONMENT_NAME: "staging",
      },
      {}
    );

    expect(() => assertSeedTargetCanWrite(context)).toThrow(
      /FE_CORE_SEED_CONFIRM/
    );
  });

  test("allows canonical staging only with explicit confirmation", () => {
    const context = buildSeedTargetContext(
      {
        MONGO_URI:
          "mongodb+srv://user:pass@cluster.mongodb.net/You-Calendy-Be-Staging",
        RAILWAY_ENVIRONMENT_NAME: "staging",
      },
      { confirm: CONFIRMATION_PHRASE }
    );

    const result = assertSeedTargetCanWrite(context);

    expect(result.allowed).toBe(true);
    expect(result.safeSignals).toEqual(
      expect.arrayContaining([
        "canonical staging database",
        "Railway staging environment",
      ])
    );
  });

  test("dry-run does not require Mongo URI or confirmation", async () => {
    const result = await runSeed({
      env: {},
      args: { dryRun: true },
      referenceDate: new Date("2026-05-01T09:00:00.000Z"),
    });

    expect(result).toMatchObject({
      success: true,
      dryRun: true,
      plan: {
        smoke: {
          SMOKE_DATE: "2026-05-02",
        },
      },
    });
  });

  test("seed plan exposes deterministic smoke date and coverage counts", () => {
    const plan = buildSeedPlan(new Date("2026-05-01T09:00:00.000Z"));

    expect(plan.smoke.SMOKE_DATE).toBe("2026-05-02");
    expect(plan.counts).toMatchObject({
      appointments: 6,
      checkouts: 2,
      payments: 2,
      refunds: 1,
      cashSessions: 1,
    });
  });

  test("writes the full seed idempotently in a safe test database", async () => {
    const replSet = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
    const uri = replSet.getUri("groomnest_seed_test");
    const seedOptions = {
      env: {
        MONGO_URI: uri,
        NODE_ENV: "test",
        JWT_SECRET: "seed-test-secret",
      },
      args: { confirm: CONFIRMATION_PHRASE },
      referenceDate: new Date("2026-05-01T09:00:00.000Z"),
    };

    try {
      await runSeed(seedOptions);
      await runSeed(seedOptions);

      mongoose.set("strictQuery", true);
      await mongoose.connect(uri);

      await expect(
        Promise.all([
          User.countDocuments({ email: "fe-core-owner@groomnest.dev" }),
          Business.countDocuments({ name: "Groomnest FE Core Seed" }),
          Service.countDocuments({
            name: { $in: ["Signature Cut", "Beard Trim", "Cut + Beard"] },
          }),
          Staff.countDocuments({ email: /@groomnest\.dev$/ }),
          Client.countDocuments({ email: /fe-core-/ }),
          Appointment.countDocuments({ notes: /\[FE-CORE-SEED\]/ }),
          Checkout.countDocuments({}),
          Payment.countDocuments({ idempotencyKey: /fe-core-staging-v1/ }),
          Refund.countDocuments({
            idempotencyKey: "fe-core-staging-v1:partial-refund",
          }),
          CashSession.countDocuments({ closingNote: /\[FE-CORE-SEED\]/ }),
          DomainEvent.countDocuments({ correlationId: "fe-core-staging-v1" }),
        ])
      ).resolves.toEqual([1, 1, 3, 2, 4, 6, 2, 2, 1, 1, 6]);
    } finally {
      await mongoose.disconnect().catch(() => {});
      await replSet.stop();
    }
  });
});
