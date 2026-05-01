const {
  CONFIRMATION_PHRASE,
  assertSafeTarget,
  looksProductionLike,
  parseArgs,
  usage,
} = require("../../scripts/restore-drill-staging");

describe("restore drill safety", () => {
  test("parses dry-run, target and confirmation arguments", () => {
    expect(
      parseArgs([
        "--dry-run",
        "--json",
        "--target",
        "staging",
        "--confirm",
        CONFIRMATION_PHRASE,
      ])
    ).toEqual({
      confirm: CONFIRMATION_PHRASE,
      dryRun: true,
      help: false,
      json: true,
      target: "staging",
    });
  });

  test("allows dry-run only when staging is proven", () => {
    expect(() =>
      assertSafeTarget({
        dryRun: true,
        mongoUri: "mongodb+srv://cluster/You-Calendy-Be-Staging",
        railwayEnvironmentName: "staging",
        target: "staging",
      })
    ).not.toThrow();
  });

  test("requires strong confirmation for mutating drill", () => {
    expect(() =>
      assertSafeTarget({
        dryRun: false,
        mongoUri: "mongodb+srv://cluster/You-Calendy-Be-Staging",
        railwayEnvironmentName: "staging",
        target: "staging",
      })
    ).toThrow(`--confirm ${CONFIRMATION_PHRASE}`);
  });

  test("rejects non-staging targets", () => {
    expect(() =>
      assertSafeTarget({
        confirm: CONFIRMATION_PHRASE,
        dryRun: false,
        mongoUri: "mongodb+srv://cluster/You-Calendy-Be-Staging",
        railwayEnvironmentName: "staging",
        target: "production",
      })
    ).toThrow("target must be exactly staging");
  });

  test("rejects production-like environment names and database URIs", () => {
    expect(looksProductionLike("production")).toBe(true);

    expect(() =>
      assertSafeTarget({
        confirm: CONFIRMATION_PHRASE,
        dryRun: false,
        mongoUri: "mongodb+srv://cluster/You-Calendy-Be-Production",
        railwayEnvironmentName: "production",
        target: "staging",
      })
    ).toThrow("production-like");
  });

  test("rejects target when staging cannot be proven", () => {
    expect(() =>
      assertSafeTarget({
        confirm: CONFIRMATION_PHRASE,
        dryRun: false,
        mongoUri: "mongodb+srv://cluster/groomnest",
        railwayEnvironmentName: "",
        target: "staging",
      })
    ).toThrow("staging could not be proven");
  });

  test("prints usage with safe commands", () => {
    expect(usage()).toContain("--dry-run --target staging");
    expect(usage()).toContain(`--confirm ${CONFIRMATION_PHRASE}`);
  });
});
