const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

const normalizeOrigin = (value) => {
  if (!value || typeof value !== "string") {
    return null;
  }

  try {
    return new URL(value).origin;
  } catch (error) {
    return null;
  }
};

const extractRequestOrigin = (req) => {
  const originHeader = normalizeOrigin(req.headers.origin);
  if (originHeader) {
    return originHeader;
  }

  return normalizeOrigin(req.headers.referer);
};

const hasAuthCookies = (req) =>
  Boolean(
    req.cookies?.adminToken || req.cookies?.userToken || req.cookies?.clientToken
  );

const createCsrfProtection = ({ allowedOrigins = [] } = {}) => {
  const trustedOrigins = new Set(
    allowedOrigins.map((origin) => normalizeOrigin(origin)).filter(Boolean)
  );

  return (req, res, next) => {
    if (!UNSAFE_METHODS.has(req.method)) {
      return next();
    }

    if (!hasAuthCookies(req)) {
      return next();
    }

    const requestOrigin = extractRequestOrigin(req);

    if (!requestOrigin || !trustedOrigins.has(requestOrigin)) {
      return res.status(403).json({
        success: false,
        message: "Blocked by CSRF protection",
      });
    }

    return next();
  };
};

module.exports = createCsrfProtection;
