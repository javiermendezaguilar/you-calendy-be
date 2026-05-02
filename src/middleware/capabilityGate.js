const Business = require("../models/User/business");
const { resolveActorContext } = require("../services/identity/actorContext");
const ErrorHandler = require("../utils/ErrorHandler");

const normalizeCapabilityList = (capabilities) =>
  Array.isArray(capabilities) ? capabilities.filter(Boolean) : [capabilities].filter(Boolean);

const hasAnyCapability = (actorContext, requiredCapabilities) => {
  const permissionKeys = actorContext?.capabilities?.permissionKeys || [];
  return normalizeCapabilityList(requiredCapabilities).some((capability) =>
    permissionKeys.includes(capability)
  );
};

const attachTenantBusiness = async (req, actorContext) => {
  const businessId = actorContext?.businessId;
  if (!businessId) {
    return null;
  }

  return Business.findById(businessId);
};

const getAuthenticatedClient = (req) =>
  req.authSession?.authSubjectType === "client" ? req.client : null;

const requireAnyTenantCapability = (requiredCapabilities) => async (req, res, next) => {
  try {
    const actorContext = await resolveActorContext({
      user: req.user,
      client: getAuthenticatedClient(req),
    });

    req.actorContext = actorContext;

    if (!hasAnyCapability(actorContext, requiredCapabilities)) {
      return ErrorHandler("Forbidden: missing required capability", 403, req, res);
    }

    const business = await attachTenantBusiness(req, actorContext);
    if (!business) {
      return ErrorHandler("Tenant context is required", 403, req, res);
    }

    req.business = business;
    return next();
  } catch (error) {
    return ErrorHandler(error.message, 500, req, res);
  }
};

const requireTenantCapability = (requiredCapability) =>
  requireAnyTenantCapability([requiredCapability]);

module.exports = {
  requireAnyTenantCapability,
  requireTenantCapability,
};
