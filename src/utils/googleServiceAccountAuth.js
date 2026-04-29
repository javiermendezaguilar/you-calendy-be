const fs = require("fs");
const jwt = require("jsonwebtoken");

const GOOGLE_OAUTH_TOKEN_URL = "https://oauth2.googleapis.com/token";
const JWT_BEARER_GRANT_TYPE = "urn:ietf:params:oauth:grant-type:jwt-bearer";
const TOKEN_CACHE_SAFETY_MS = 60 * 1000;

const tokenCache = new Map();

function normalizeScopes(scopes) {
  if (Array.isArray(scopes)) {
    return scopes.filter(Boolean).join(" ");
  }

  if (typeof scopes === "string" && scopes.trim()) {
    return scopes.trim();
  }

  throw new Error("Google OAuth scopes are required");
}

function normalizePrivateKey(privateKey) {
  return privateKey.replace(/\\n/g, "\n");
}

function readCredentials({ credentials, keyFilename, keyFile } = {}) {
  if (credentials) return credentials;

  const filePath = keyFilename || keyFile;
  if (!filePath) {
    throw new Error("Google service account credentials are not configured");
  }

  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

async function readJsonResponse(response) {
  try {
    return await response.json();
  } catch (error) {
    return {};
  }
}

function buildAssertion(credentials, scope) {
  if (!credentials.client_email || !credentials.private_key) {
    throw new Error("Google service account credentials are incomplete");
  }

  const now = Math.floor(Date.now() / 1000);
  const signOptions = { algorithm: "RS256" };
  if (credentials.private_key_id) {
    signOptions.keyid = credentials.private_key_id;
  }

  return jwt.sign(
    {
      iss: credentials.client_email,
      scope,
      aud: GOOGLE_OAUTH_TOKEN_URL,
      exp: now + 3600,
      iat: now,
    },
    normalizePrivateKey(credentials.private_key),
    signOptions
  );
}

async function getGoogleAccessToken(options = {}) {
  const credentials = readCredentials(options);
  const scope = normalizeScopes(options.scopes || options.scope);
  const cacheKey = [
    credentials.client_email,
    credentials.private_key_id || "no-key-id",
    scope,
  ].join(":");
  const cached = tokenCache.get(cacheKey);

  if (cached && cached.expiresAt > Date.now() + TOKEN_CACHE_SAFETY_MS) {
    return cached.accessToken;
  }

  const response = await fetch(GOOGLE_OAUTH_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      grant_type: JWT_BEARER_GRANT_TYPE,
      assertion: buildAssertion(credentials, scope),
    }),
  });
  const result = await readJsonResponse(response);

  if (!response.ok) {
    const error = new Error(
      result.error_description ||
        result.error ||
        `Google OAuth token request failed with status ${response.status}`
    );
    error.status = response.status;
    error.code = result.error;
    throw error;
  }

  if (!result.access_token) {
    throw new Error("Google OAuth token response did not include access_token");
  }

  const expiresIn = Number(result.expires_in || 3600);
  tokenCache.set(cacheKey, {
    accessToken: result.access_token,
    expiresAt: Date.now() + expiresIn * 1000,
  });

  return result.access_token;
}

function clearGoogleAccessTokenCache() {
  tokenCache.clear();
}

module.exports = {
  getGoogleAccessToken,
  clearGoogleAccessTokenCache,
  GOOGLE_OAUTH_TOKEN_URL,
  JWT_BEARER_GRANT_TYPE,
};
