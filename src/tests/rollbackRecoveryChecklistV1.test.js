const {
  COMMON_POSTCHECKS,
  ROLLBACK_PLANS,
  getPlan,
  listPlans,
  parseArgs,
  runCli,
} = require("../../scripts/rollback-recovery-checklist");

const captureConsole = (method, callback) => {
  const spy = jest.spyOn(console, method).mockImplementation(() => {});
  const result = callback(spy);
  spy.mockRestore();
  return result;
};

describe("rollback recovery checklist", () => {
  test("defines rollback plans for required operational surfaces", () => {
    expect(Object.keys(ROLLBACK_PLANS)).toEqual(
      expect.arrayContaining([
        "railway-deploy",
        "env-vars",
        "database",
        "webhooks",
        "domains",
      ])
    );
  });

  test("database rollback is critical and requires restore discipline", () => {
    const plan = getPlan("database");

    expect(plan.severity).toBe("critical");
    expect(plan.prechecks.join("\n")).toContain("backup or restore point");
    expect(plan.recovery.join("\n")).toContain("staging or scratch environment");
  });

  test("webhook rollback requires replay and idempotency evidence", () => {
    const plan = getPlan("webhooks");
    const planText = [...plan.prechecks, ...plan.recovery, ...plan.validation].join("\n");

    expect(planText).toContain("event ids");
    expect(planText).toContain("idempotent outcome");
  });

  test("all plans include common postchecks", () => {
    Object.keys(ROLLBACK_PLANS).forEach((name) => {
      const plan = getPlan(name);

      COMMON_POSTCHECKS.forEach((postcheck) => {
        expect(plan.validation).toContain(postcheck);
      });
    });
  });

  test("lists plans with severity metadata", () => {
    expect(listPlans()).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: "railway-deploy",
          severity: "high",
        }),
        expect.objectContaining({
          name: "database",
          severity: "critical",
        }),
      ])
    );
  });

  test("parses json, list and plan arguments", () => {
    expect(parseArgs(["--json", "--list", "database"])).toEqual({
      json: true,
      list: true,
      plan: "database",
    });
  });

  test("prints a plan successfully", () => {
    captureConsole("log", (logSpy) => {
      expect(runCli(["railway-deploy"])).toBe(0);
      expect(logSpy).toHaveBeenCalledWith(
        expect.stringContaining("railway-deploy")
      );
    });
  });

  test("rejects unknown plans", () => {
    captureConsole("error", (errorSpy) => {
      expect(runCli(["unknown"])).toBe(1);
      expect(errorSpy).toHaveBeenCalledWith(
        expect.stringContaining("Unknown rollback plan")
      );
    });
  });
});
