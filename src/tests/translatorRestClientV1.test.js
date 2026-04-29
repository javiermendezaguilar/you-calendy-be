const ORIGINAL_ENV = { ...process.env };
const ORIGINAL_FETCH = global.fetch;

function mockCacheMiss(TranslationCache) {
  TranslationCache.findOne.mockReturnValue({
    lean: jest.fn().mockResolvedValue(null),
  });
}

describe("Google Translation REST client", () => {
  let TranslationCache;
  let getGoogleAccessToken;

  beforeEach(() => {
    jest.resetModules();
    jest.spyOn(console, "log").mockImplementation(() => {});
    jest.spyOn(console, "error").mockImplementation(() => {});
    process.env = {
      ...ORIGINAL_ENV,
      GCLOUD_PROJECT_ID: "groomnest-test",
      GCLOUD_TRANSLATE_SERVICE_ACCOUNT_JSON: JSON.stringify({
        client_email: "translator@groomnest-test.iam.gserviceaccount.com",
        private_key: "test-private-key",
      }),
    };
    delete process.env.GCLOUD_TRANSLATE_SERVICE_ACCOUNT_BASE64;
    delete process.env.GCLOUD_TRANSLATE_KEYFILE;

    getGoogleAccessToken = jest.fn().mockResolvedValue("access-token-123");
    TranslationCache = {
      findOne: jest.fn(),
      updateOne: jest.fn(),
      create: jest.fn().mockResolvedValue({}),
    };

    jest.doMock("../utils/googleServiceAccountAuth", () => ({
      getGoogleAccessToken,
    }));
    jest.doMock("../models/translationCache", () => TranslationCache);
    global.fetch = jest.fn();
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    global.fetch = ORIGINAL_FETCH;
    jest.restoreAllMocks();
  });

  it("translates uncached texts through Google Translation REST v3", async () => {
    mockCacheMiss(TranslationCache);
    global.fetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: jest.fn().mockResolvedValue({
        translations: [
          { translatedText: "Hola", detectedLanguageCode: "en" },
          { translatedText: "Adios", detectedLanguageCode: "en" },
        ],
      }),
    });

    const { translateBatch } = require("../utils/translator");

    const result = await translateBatch(["Hello", "Bye"], "es");

    expect(result).toEqual(["Hola", "Adios"]);
    expect(getGoogleAccessToken).toHaveBeenCalledWith(
      expect.objectContaining({
        credentials: expect.objectContaining({
          client_email: "translator@groomnest-test.iam.gserviceaccount.com",
        }),
        scopes: ["https://www.googleapis.com/auth/cloud-translation"],
      })
    );
    expect(global.fetch).toHaveBeenCalledTimes(1);

    const [url, options] = global.fetch.mock.calls[0];
    expect(url).toBe(
      "https://translation.googleapis.com/v3/projects/groomnest-test/locations/global:translateText"
    );
    expect(options.method).toBe("POST");
    expect(options.headers.Authorization).toBe("Bearer access-token-123");
    expect(JSON.parse(options.body)).toEqual({
      contents: ["Hello", "Bye"],
      mimeType: "text/plain",
      targetLanguageCode: "es",
    });
    expect(TranslationCache.create).toHaveBeenCalledTimes(2);
  });

  it("returns original text when translation is disabled", async () => {
    process.env.GCLOUD_PROJECT_ID = "";
    delete process.env.GCLOUD_TRANSLATE_SERVICE_ACCOUNT_JSON;
    delete process.env.GCLOUD_TRANSLATE_SERVICE_ACCOUNT_BASE64;
    delete process.env.GCLOUD_TRANSLATE_KEYFILE;

    const { translateText } = require("../utils/translator");

    await expect(translateText("Hello", "es")).resolves.toBe("Hello");
    expect(global.fetch).not.toHaveBeenCalled();
  });
});
