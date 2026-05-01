const {
  GOLDEN_PATHS,
  VALIDATION_PROFILES,
  getProfile,
  listProfiles,
  parseArgs,
  runCli,
} = require("../../scripts/staging-validation-checklist");

describe("staging validation checklist", () => {
  test("defines profiles for the expected risk classes", () => {
    expect(Object.keys(VALIDATION_PROFILES)).toEqual(
      expect.arrayContaining([
        "docs-tooling",
        "normal-backend",
        "sensitive-business",
        "data-migration",
        "external-integration",
        "deploy-runtime",
        "fe-contract",
      ])
    );
  });

  test("marks sensitive profiles as staging required", () => {
    expect(getProfile("sensitive-business")).toEqual(
      expect.objectContaining({
        stagingRequired: true,
      })
    );
    expect(getProfile("docs-tooling")).toEqual(
      expect.objectContaining({
        stagingRequired: false,
      })
    );
  });

  test("covers Groomnest golden paths", () => {
    const names = GOLDEN_PATHS.map((path) => path.name);

    expect(names).toEqual(
      expect.arrayContaining([
        "booking",
        "payment-refund",
        "rebooking",
        "cash-session",
        "permissions",
      ])
    );
  });

  test("sensitive business profile requires seed or smoke evidence", () => {
    const profile = getProfile("sensitive-business");

    expect(profile.staging.join("\n")).toContain("seed:fe-core-staging");
    expect(profile.staging.join("\n")).toContain("smoke:fe-core");
    expect(profile.evidence).toEqual(
      expect.arrayContaining(["business rule", "staging smoke summary"])
    );
  });

  test("lists profiles with staging requirement metadata", () => {
    expect(listProfiles()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "fe-contract",
          stagingRequired: true,
        }),
        expect.objectContaining({
          name: "normal-backend",
          stagingRequired: false,
        }),
      ])
    );
  });

  test("parses json, list and profile arguments", () => {
    expect(parseArgs(["--json", "--list", "sensitive-business"])).toEqual({
      json: true,
      list: true,
      profile: "sensitive-business",
    });
  });

  test("prints a profile successfully", () => {
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});

    try {
      expect(runCli(["sensitive-business"])).toBe(0);
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining("sensitive-business")
      );
    } finally {
      logSpy.mockRestore();
    }
  });

  test("rejects unknown profiles", () => {
    const errorSpy = jest.spyOn(console, "error").mockImplementation(() => {});

    try {
      expect(runCli(["unknown"])).toBe(1);
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining("Unknown staging validation profile")
      );
    } finally {
      errorSpy.mockRestore();
    }
  });
});
