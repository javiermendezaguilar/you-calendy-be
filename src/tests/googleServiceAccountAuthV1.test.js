const crypto = require("crypto");
const jwt = require("jsonwebtoken");

const ORIGINAL_FETCH = global.fetch;

function createServiceAccountCredentials() {
  const { privateKey } = crypto.generateKeyPairSync("rsa", {
    modulusLength: 2048,
  });

  return {
    client_email: "service-account@groomnest-test.iam.gserviceaccount.com",
    private_key_id: "test-key-id",
    private_key: privateKey.export({ type: "pkcs8", format: "pem" }),
  };
}

function mockSuccessfulTokenExchange(accessToken = "access-token-1") {
  global.fetch.mockResolvedValue({
    ok: true,
    status: 200,
    json: jest.fn().mockResolvedValue({
      access_token: accessToken,
      expires_in: 3600,
    }),
  });
}

describe("google service account OAuth helper", () => {
  beforeEach(() => {
    jest.resetModules();
    global.fetch = jest.fn();
  });

  afterEach(() => {
    global.fetch = ORIGINAL_FETCH;
    jest.restoreAllMocks();
  });

  it("exchanges a signed service-account assertion for an access token", async () => {
    const credentials = createServiceAccountCredentials();
    mockSuccessfulTokenExchange();

    const {
      getGoogleAccessToken,
      GOOGLE_OAUTH_TOKEN_URL,
      JWT_BEARER_GRANT_TYPE,
    } = require("../utils/googleServiceAccountAuth");

    const token = await getGoogleAccessToken({
      credentials,
      scopes: ["https://www.googleapis.com/auth/cloud-platform"],
    });

    expect(token).toBe("access-token-1");
    expect(global.fetch).toHaveBeenCalledTimes(1);

    const [url, options] = global.fetch.mock.calls[0];
    expect(url).toBe(GOOGLE_OAUTH_TOKEN_URL);
    expect(options.method).toBe("POST");
    expect(options.headers["Content-Type"]).toBe(
      "application/x-www-form-urlencoded"
    );
    expect(options.body.get("grant_type")).toBe(JWT_BEARER_GRANT_TYPE);

    const assertion = options.body.get("assertion");
    const decoded = jwt.decode(assertion, { complete: true });
    expect(decoded.header.kid).toBe("test-key-id");
    expect(decoded.payload).toMatchObject({
      iss: "service-account@groomnest-test.iam.gserviceaccount.com",
      scope: "https://www.googleapis.com/auth/cloud-platform",
      aud: GOOGLE_OAUTH_TOKEN_URL,
    });
  });

  it("reuses cached tokens while they are valid", async () => {
    const credentials = createServiceAccountCredentials();
    mockSuccessfulTokenExchange();

    const {
      getGoogleAccessToken,
      clearGoogleAccessTokenCache,
    } = require("../utils/googleServiceAccountAuth");

    clearGoogleAccessTokenCache();
    const first = await getGoogleAccessToken({
      credentials,
      scopes: ["scope-a"],
    });
    const second = await getGoogleAccessToken({
      credentials,
      scopes: ["scope-a"],
    });

    expect(first).toBe("access-token-1");
    expect(second).toBe("access-token-1");
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});
