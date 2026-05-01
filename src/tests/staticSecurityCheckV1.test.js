const {
  checkWorkflowControlsFromText,
  findForbiddenTrackedFiles,
  isIgnoredPath,
  isScannableFile,
  normalizePath,
  scanContentForSecrets,
} = require("../../scripts/static-security-check");

describe("static security check", () => {
  test("normalizes windows paths", () => {
    expect(normalizePath("src\\utils\\fcm.json")).toBe("src/utils/fcm.json");
  });

  test("blocks tracked credential-like files", () => {
    expect(
      findForbiddenTrackedFiles([
        "src/utils/fcm.json",
        "src/global-approach-469211-g4-d88a01b7357d.json",
      ])
    ).toHaveLength(2);
  });

  test("ignores test files for literal fixture secrets", () => {
    expect(isIgnoredPath("src/tests/noShowBlock.test.js")).toBe(true);
    expect(
      scanContentForSecrets(
        "src/tests/noShowBlock.test.js",
        'process.env.JWT_SECRET = "mysecretcalendy";'
      )
    ).toEqual([]);
  });

  test("scans runtime files with relevant extensions", () => {
    expect(isScannableFile("src/controllers/authController.js")).toBe(true);
    expect(isScannableFile("src/tests/authController.test.js")).toBe(false);
    expect(isScannableFile("README.md")).toBe(false);
  });

  test("detects high-confidence secrets in runtime code", () => {
    const fakeStripeToken = ["sk", "live", "1234567890abcdefghijklmn"].join("_");
    const findings = scanContentForSecrets(
      "src/config/example.js",
      `const STRIPE_SECRET = "${fakeStripeToken}";`
    );

    expect(findings).toEqual([
      expect.objectContaining({ id: "stripe-live-secret" }),
    ]);
  });

  test("detects Mongo URIs with inline password", () => {
    const findings = scanContentForSecrets(
      "scripts/example.js",
      'const uri = "mongodb+srv://user:password@example.mongodb.net/db";'
    );

    expect(findings).toEqual([
      expect.objectContaining({ id: "mongodb-uri-with-password" }),
    ]);
  });

  test("requires CodeQL, npm audit and static security in workflows", () => {
    const findings = checkWorkflowControlsFromText({
      codeqlText: [
        "schedule:",
        "  - cron: '0 4 * * 1'",
        "uses: github/codeql-action/analyze@v4",
      ].join("\n"),
      qualityText: [
        "run: npm audit --audit-level=high",
        "run: npm run security:static",
      ].join("\n"),
    });

    expect(findings).toEqual([]);
  });

  test("reports missing workflow controls", () => {
    const findings = checkWorkflowControlsFromText({
      codeqlText: "name: CodeQL",
      qualityText: "name: Backend Quality",
    });

    expect(findings.map((finding) => finding.id)).toEqual(
      expect.arrayContaining([
        "codeql-analyze-missing",
        "codeql-schedule-missing",
        "npm-audit-missing",
        "static-security-missing",
      ])
    );
  });
});
