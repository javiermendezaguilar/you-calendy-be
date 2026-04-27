const TranslationCache = require("../models/translationCache");
const {
  hasTranslationCacheTtl,
  parseArgs: parseReportArgs,
} = require("../../scripts/data-hygiene-report");
const {
  parseArgs: parseApplyArgs,
  validatePlan,
} = require("../../scripts/data-hygiene-apply");

describe("Data hygiene v1", () => {
  test("declares TTL index for translation cache retention", () => {
    const indexes = TranslationCache.schema.indexes();
    expect(indexes).toEqual(
      expect.arrayContaining([
        [
          { lastUsed: 1 },
          expect.objectContaining({
            expireAfterSeconds: 90 * 24 * 60 * 60,
            name: "translation_cache_lastUsed_ttl_v1",
          }),
        ],
      ])
    );
  });

  test("detects the canonical translation cache TTL index", () => {
    expect(
      hasTranslationCacheTtl([
        {
          name: "translation_cache_lastUsed_ttl_v1",
          key: { lastUsed: 1 },
          expireAfterSeconds: 90 * 24 * 60 * 60,
        },
      ])
    ).toBe(true);
    expect(
      hasTranslationCacheTtl([
        {
          name: "translation_cache_lastUsed_ttl_v1",
          key: { lastUsed: 1 },
          expireAfterSeconds: 30 * 24 * 60 * 60,
        },
      ])
    ).toBe(false);
  });

  test("validates report retention days", () => {
    expect(parseReportArgs(["--retention-days", "30"]).retentionDays).toBe(30);
    expect(() => parseReportArgs(["--retention-days", "0"])).toThrow(
      "--retention-days must be a positive integer"
    );
  });

  test("blocks sample_mflix deletion without explicit confirmation", () => {
    expect(() =>
      validatePlan(parseApplyArgs(["--drop-sample-mflix", "--apply"]))
    ).toThrow("--drop-sample-mflix requires --confirm sample_mflix");
  });

  test("requires explicit confirmation before applying invalid gallery deactivation", () => {
    expect(() =>
      validatePlan(
        parseApplyArgs(["--deactivate-invalid-haircut-galleries", "--apply"])
      )
    ).toThrow(
      "--deactivate-invalid-haircut-galleries with --apply requires --confirm haircutgalleries"
    );

    expect(
      validatePlan(
        parseApplyArgs([
          "--deactivate-invalid-haircut-galleries",
          "--apply",
          "--confirm",
          "haircutgalleries",
        ])
      ).actions
    ).toEqual([
      expect.objectContaining({
        type: "deactivate_invalid_haircut_galleries",
        collection: "haircutgalleries",
      }),
    ]);
  });

  test("keeps cleanup dry-run unless apply is explicitly provided", () => {
    const plan = validatePlan(
      parseApplyArgs(["--ensure-translation-cache-ttl"])
    );
    expect(plan.dryRun).toBe(true);
    expect(plan.actions).toEqual([
      expect.objectContaining({
        type: "ensure_translation_cache_ttl",
        collection: "translationcaches",
      }),
    ]);
  });
});
