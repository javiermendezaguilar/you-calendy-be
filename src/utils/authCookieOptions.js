const DEFAULT_AUTH_COOKIE_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const DEPLOYED_RUNTIME_ENV_KEYS = [
  "RAILWAY_ENVIRONMENT_NAME",
  "RAILWAY_ENVIRONMENT",
  "VERCEL_ENV",
];

const normalize = (value) =>
  String(value || "")
    .trim()
    .toLowerCase();

const isTruthy = (value) => ["1", "true", "yes"].includes(normalize(value));

const isDeployedRuntime = (env = process.env) => {
  if (normalize(env.NODE_ENV) === "production") return true;
  if (isTruthy(env.VERCEL)) return true;

  return DEPLOYED_RUNTIME_ENV_KEYS.some((key) => Boolean(normalize(env[key])));
};

const normalizeSameSite = (value) => {
  const sameSite = normalize(value);
  if (["strict", "lax", "none"].includes(sameSite)) {
    return sameSite;
  }

  return null;
};

const shouldUseSecureCookies = ({ env, sameSite, secureOverride }) => {
  if (secureOverride !== undefined) return Boolean(secureOverride);
  if (sameSite === "none") return true;
  if (isTruthy(env.AUTH_COOKIE_SECURE)) return true;
  return isDeployedRuntime(env);
};

const buildAuthCookieOptions = (env = process.env, overrides = {}) => {
  const configuredSameSite = normalizeSameSite(env.AUTH_COOKIE_SAME_SITE);
  const sameSite =
    normalizeSameSite(overrides.sameSite) ||
    configuredSameSite ||
    (isDeployedRuntime(env) ? "none" : "lax");

  const cookieOptions = {
    httpOnly: overrides.httpOnly ?? true,
    secure: shouldUseSecureCookies({
      env,
      sameSite,
      secureOverride: overrides.secure,
    }),
    sameSite,
    maxAge: overrides.maxAge ?? DEFAULT_AUTH_COOKIE_MAX_AGE_MS,
    path: overrides.path || "/",
  };

  if (cookieOptions.sameSite === "none" && !cookieOptions.secure) {
    cookieOptions.secure = true;
  }

  return cookieOptions;
};

const buildClearAuthCookieOptions = (env = process.env, overrides = {}) => {
  const { maxAge, ...cookieOptions } = buildAuthCookieOptions(env, overrides);
  return cookieOptions;
};

module.exports = {
  DEFAULT_AUTH_COOKIE_MAX_AGE_MS,
  buildAuthCookieOptions,
  buildClearAuthCookieOptions,
  isDeployedRuntime,
};
