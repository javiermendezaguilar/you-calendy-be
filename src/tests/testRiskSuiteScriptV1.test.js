const path = require("path");

const {
  RISK_TEST_GROUPS,
  buildJestArgs,
  getJestTestsForGroups,
  listGroups,
  parseArgs,
  runJestGroups,
  runCli,
} = require("../../scripts/test-risk-suite");

describe("test risk suite runner", () => {
  test("exposes the required risk groups", () => {
    expect(Object.keys(RISK_TEST_GROUPS)).toEqual(
      expect.arrayContaining([
        "contract",
        "auth-permissions",
        "appointments",
        "commerce",
        "billing",
        "integrations-jobs",
        "data-ops",
        "smoke",
      ])
    );
  });

  test("lists groups with counts and command hints", () => {
    expect(listGroups()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "contract",
          command: "jest",
          tests: expect.any(Number),
        }),
        expect.objectContaining({
          name: "smoke",
          command: "npm run smoke:fe-core",
          tests: 0,
        }),
      ])
    );
  });

  test("parses list, json, dry-run and groups", () => {
    expect(parseArgs(["--list", "--json", "--dry-run", "contract"])).toEqual({
      list: true,
      json: true,
      dryRun: true,
      groups: ["contract"],
    });
  });

  test("builds Jest args for one group", () => {
    const args = buildJestArgs(["contract"]);

    expect(args).toEqual(
      expect.arrayContaining([
        "src/tests/apiErrorResponseConsistencyV1.test.js",
        "src/tests/authCookieOptionsV1.test.js",
        "--setupFilesAfterEnv",
        "./src/tests/setup.js",
        "--runInBand",
      ])
    );
  });

  test("deduplicates tests across selected groups", () => {
    const tests = getJestTestsForGroups(["contract", "contract"]);
    expect(tests.length).toBe(new Set(tests).size);
  });

  test("rejects unknown groups", () => {
    expect(() => buildJestArgs(["unknown"])).toThrow(/Unknown test risk group/);
  });

  test("returns non-zero when no group is selected without list flag", () => {
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});

    try {
      expect(runCli([])).toBe(1);
    } finally {
      logSpy.mockRestore();
    }
  });

  test("prints the direct Jest command in dry-run mode", () => {
    const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});

    try {
      expect(runJestGroups(["contract"], { dryRun: true })).toBe(0);
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining(["node_modules", "jest", "bin", "jest.js"].join(path.sep))
      );
    } finally {
      logSpy.mockRestore();
    }
  });
});
