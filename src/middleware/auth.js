const jwt = require("jsonwebtoken");
const User = require("../models/User/user");
const Business = require("../models/User/business");
const Client = require("../models/client");
const dotenv = require("dotenv");

dotenv.config({ path: ".././src/config/config.env" });

const TOKEN_COOKIES = {
  admin: "adminToken",
  user: "userToken",
  client: "clientToken",
};

const SHARED_AUTH_ROUTES = new Set([
  "/auth/me",
  "/auth/profile-settings",
  "/auth/notification-settings",
]);

const toIdString = (value) => {
  if (!value) return null;
  if (value._id && value._id !== value) return toIdString(value._id);
  return value.toString();
};

const normalizeRequestPath = (req) => {
  const fullPath = req.originalUrl || req.url || req.path || "";
  const path = fullPath.split("?")[0] || "/";
  return path.replace(/^\/api/, "") || "/";
};

const getUserContextHint = (req) =>
  String(req.headers["x-user-context"] || "").trim().toLowerCase();

const classifyAuthRoute = (req) => {
  const path = normalizeRequestPath(req);
  const isAdminClientRoute =
    path === "/client/all" || /\/client\/[^/]+\/status$/.test(path);
  const isAdminRoute =
    path.includes("/admin") ||
    path.includes("/auth/subadmins") ||
    (path.includes("/auth/barbers") && path.includes("/status")) ||
    isAdminClientRoute;
  const isBusinessRoute = path.includes("/business");
  const isSharedAuthRoute = SHARED_AUTH_ROUTES.has(path);
  const isClientRoute =
    path.includes("/client") && !isAdminClientRoute && !isBusinessRoute;
  const isNotificationRoute = path.includes("/notifications");
  const isAppointmentRoute =
    path.includes("/appointments") &&
    !path.includes("/appointments/available") &&
    !path.includes("/appointments/public");

  let routeType = "fallback";
  if (isAdminRoute) routeType = "admin";
  else if (isSharedAuthRoute) routeType = "shared";
  else if (isBusinessRoute) routeType = "business";
  else if (isClientRoute) routeType = "client";
  else if (isNotificationRoute) routeType = "notification";
  else if (isAppointmentRoute) routeType = "appointment";

  return { path, routeType };
};

const cookieCandidate = (req, cookieKey) => {
  const cookieName = TOKEN_COOKIES[cookieKey];
  const token = req.cookies?.[cookieName];
  if (!token) return null;

  return {
    token,
    source: `cookie:${cookieName}`,
    cookieName,
  };
};

const bearerCandidate = (req) => {
  const authHeader = req.headers.authorization;
  if (!authHeader || typeof authHeader !== "string") return null;

  const token = authHeader.startsWith("Bearer ")
    ? authHeader.slice(7).trim()
    : authHeader.trim();

  if (!token) return null;

  return {
    token,
    source: "authorization",
    cookieName: null,
  };
};

const uniqueCandidates = (candidates) => {
  const seen = new Set();
  return candidates.filter((candidate) => {
    if (!candidate || !candidate.token || seen.has(candidate.source)) {
      return false;
    }
    seen.add(candidate.source);
    return true;
  });
};

const routeCookieOrder = (routeType, userContextHint) => {
  if (routeType === "admin") return ["admin"];
  if (routeType === "shared") return ["user", "admin", "client"];
  if (routeType === "business") return ["user"];
  if (routeType === "client") return ["client"];
  if (routeType === "notification") {
    return userContextHint === "client"
      ? ["client", "user", "admin"]
      : ["user", "admin", "client"];
  }
  if (routeType === "appointment") return ["user", "client"];
  if (routeType === "optional") return ["client", "user", "admin"];
  return ["user", "admin", "client"];
};

const hintedCookieOrder = (routeType, userContextHint) => {
  const allowedCookieKeys = new Set(routeCookieOrder(routeType, userContextHint));
  if (userContextHint === "admin" && allowedCookieKeys.has("admin")) {
    return ["admin"];
  }
  if (userContextHint === "client" && allowedCookieKeys.has("client")) {
    return ["client"];
  }
  if (
    (userContextHint === "barber" || userContextHint === "user") &&
    allowedCookieKeys.has("user")
  ) {
    return ["user"];
  }
  return [];
};

const verifyJwtToken = (token) => {
  try {
    return jwt.verify(token, process.env.JWT_SECRET);
  } catch (error) {
    return null;
  }
};

const resolveVerifiedToken = (req, options = {}) => {
  const route =
    options.routeType === "optional"
      ? { path: normalizeRequestPath(req), routeType: "optional" }
      : classifyAuthRoute(req);
  const userContextHint = getUserContextHint(req);
  const orderedCookieKeys = [
    ...hintedCookieOrder(route.routeType, userContextHint),
    ...routeCookieOrder(route.routeType, userContextHint),
  ];
  const candidates = uniqueCandidates([
    ...orderedCookieKeys.map((cookieKey) => cookieCandidate(req, cookieKey)),
    bearerCandidate(req),
  ]);

  for (const candidate of candidates) {
    const decoded = verifyJwtToken(candidate.token);
    if (!decoded) continue;

    const authSubjectType =
      decoded.role === "client" || decoded.type === "client"
        ? "client"
        : "user";

    return {
      token: candidate.token,
      decoded,
      session: {
        authenticated: true,
        source: candidate.source,
        cookieName: candidate.cookieName,
        routeType: route.routeType,
        path: route.path,
        userContextHint: userContextHint || null,
        authSubjectType,
      },
    };
  }

  return {
    token: null,
    decoded: null,
    session: {
      authenticated: false,
      source: null,
      cookieName: null,
      routeType: route.routeType,
      path: route.path,
      userContextHint: userContextHint || null,
      authSubjectType: null,
    },
  };
};

const hydrateAuthenticatedSubject = async (
  req,
  { decoded, session },
  options = {}
) => {
  const userId = decoded.id || decoded._id;
  const subjectId = toIdString(userId);

  if (!subjectId) {
    return { status: 401, message: "Invalid auth token" };
  }

  if (session.authSubjectType === "client") {
    const clientQuery = Client.findById(userId);
    const client = options.populateClient
      ? await clientQuery.populate("business").populate("staff")
      : await clientQuery;

    if (!client) {
      return { status: 404, message: "Client not found" };
    }

    req.client = client;
    req.user = {
      _id: userId,
      id: subjectId,
      role: "client",
      type: "client",
      businessId: decoded.businessId,
    };
  } else {
    const user = await User.findById(userId);
    if (!user) {
      return { status: 404, message: "User not found" };
    }

    req.user = user;
    req.user.id = toIdString(req.user._id);
    req.user.type = req.user.role;
  }

  req.authSession = {
    ...session,
    subjectId,
  };

  return null;
};

const isAuthenticated = async (req, res, next) => {
  try {
    const resolvedToken = resolveVerifiedToken(req);

    if (!resolvedToken.token || !resolvedToken.decoded) {
      req.authSession = resolvedToken.session;
      return res.status(401).json({ success: false, message: "Not logged in" });
    }

    const hydrationError = await hydrateAuthenticatedSubject(req, resolvedToken, {
      populateClient: true,
    });
    if (hydrationError) {
      return res
        .status(hydrationError.status)
        .json({ success: false, message: hydrationError.message });
    }

    return next();
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

const isBusinessOwner = async (req, res, next) => {
  try {
    const userId = req.user._id || req.user.id;
    const business = await Business.findOne({ owner: userId });
    if (!business) {
      return res.status(403).json({ success: false, message: "User is not a business owner" });
    }
    req.business = business;
    next();
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const isAdmin = (req, res, next) => {
  if (req.user.role !== "admin") {
    return res.status(403).json({ success: false, message: "Forbidden" });
  }
  next();
};

const tryAuthenticate = async (req, res, next) => {
  try {
    const resolvedToken = resolveVerifiedToken(req, { routeType: "optional" });
    req.authSession = resolvedToken.session;

    if (resolvedToken.decoded) {
      const hydrationError = await hydrateAuthenticatedSubject(
        req,
        resolvedToken,
        { populateClient: false }
      );

      if (hydrationError) {
        req.authSession = {
          ...resolvedToken.session,
          authenticated: false,
          hydrationError: hydrationError.message,
        };
      }
    }
  } catch (error) {
    req.authSession = {
      authenticated: false,
      source: null,
      routeType: "optional",
      path: normalizeRequestPath(req),
      userContextHint: getUserContextHint(req) || null,
      authSubjectType: null,
    };
  }

  next();
};

module.exports = {
  isAuthenticated,
  isAdmin,
  isBusinessOwner,
  tryAuthenticate,
};
