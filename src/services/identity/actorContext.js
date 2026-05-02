const Business = require("../../models/User/business");
const Staff = require("../../models/staff");
const {
  resolveCapabilitiesForActor,
} = require("./rolePermissionMatrix");

const toIdString = (value) => {
  if (!value) return null;
  if (typeof value === "string") return value;
  if (typeof value.toHexString === "function") return value.toHexString();
  if (value._id && value._id !== value) return toIdString(value._id);
  return value.toString();
};

const normalizeEmail = (email) => String(email || "").trim().toLowerCase();

const mapStaffMembership = (staff) => ({
  staffId: toIdString(staff._id),
  businessId: toIdString(staff.business),
  userId: toIdString(staff.user),
  email: staff.email || null,
  displayName: [staff.firstName, staff.lastName].filter(Boolean).join(" ").trim(),
});

const withCapabilities = (actorContext) => ({
  ...actorContext,
  capabilities: resolveCapabilitiesForActor(actorContext),
});

const resolveActorContext = async ({ user, client } = {}) => {
  if (client || user?.type === "client" || user?.role === "client") {
    const clientDoc = client || null;
    const businessId = toIdString(clientDoc?.business || user?.businessId);
    const staffId = toIdString(clientDoc?.staff);

    return withCapabilities({
      actorType: "client",
      authSubjectType: "client",
      userId: null,
      clientId: toIdString(clientDoc?._id || user?._id || user?.id),
      businessId,
      staffId,
      role: "client",
      permissions: [],
      isBusinessOwner: false,
      isPlatformAdmin: false,
      isClient: true,
      staffMemberships: [],
      legacyResolution: null,
    });
  }

  if (!user) {
    return withCapabilities({
      actorType: "anonymous",
      authSubjectType: "none",
      userId: null,
      clientId: null,
      businessId: null,
      staffId: null,
      role: null,
      permissions: [],
      isBusinessOwner: false,
      isPlatformAdmin: false,
      isClient: false,
      staffMemberships: [],
      legacyResolution: null,
    });
  }

  const userId = toIdString(user._id || user.id);
  const role = user.role || "barber";
  const isPlatformAdmin = role === "admin" || role === "sub-admin";

  if (isPlatformAdmin) {
    const ownedBusiness = await Business.findOne({ owner: userId }).select("_id");

    return withCapabilities({
      actorType: role === "admin" ? "admin" : "sub-admin",
      authSubjectType: "user",
      userId,
      clientId: null,
      businessId: null,
      staffId: null,
      role,
      permissions: user.permissions || [],
      isBusinessOwner: false,
      isPlatformAdmin: true,
      isClient: false,
      staffMemberships: [],
      legacyResolution: ownedBusiness
        ? {
            type: "platform_admin_owner_hybrid",
            decision: "platform_admin_takes_precedence",
            businessId: toIdString(ownedBusiness._id),
          }
        : null,
    });
  }

  const ownedBusiness = await Business.findOne({ owner: userId }).select("_id");
  if (ownedBusiness) {
    return withCapabilities({
      actorType: "owner",
      authSubjectType: "user",
      userId,
      clientId: null,
      businessId: toIdString(ownedBusiness._id),
      staffId: null,
      role,
      permissions: [],
      isBusinessOwner: true,
      isPlatformAdmin: false,
      isClient: false,
      staffMemberships: [],
      legacyResolution: null,
    });
  }

  const explicitStaffMemberships = await Staff.find({ user: userId }).select(
    "_id business user firstName lastName email"
  );
  const email = normalizeEmail(user.email);
  let staffMemberships = explicitStaffMemberships;
  if (staffMemberships.length === 0 && email) {
    staffMemberships = await Staff.find({ email }).select(
      "_id business user firstName lastName email"
    );
  }
  const mappedStaffMemberships = staffMemberships.map(mapStaffMembership);
  const primaryStaff = mappedStaffMemberships[0] || null;

  if (primaryStaff) {
    const resolvedByExplicitUser = explicitStaffMemberships.length > 0;

    return withCapabilities({
      actorType: "staff",
      authSubjectType: "user",
      userId,
      clientId: null,
      businessId:
        mappedStaffMemberships.length === 1 ? primaryStaff.businessId : null,
      staffId: mappedStaffMemberships.length === 1 ? primaryStaff.staffId : null,
      role,
      permissions: [],
      isBusinessOwner: false,
      isPlatformAdmin: false,
      isClient: false,
      staffMemberships: mappedStaffMemberships,
      legacyResolution: {
        type: resolvedByExplicitUser ? "staff_user_link" : "staff_email_match",
        field: resolvedByExplicitUser ? "user" : "email",
      },
    });
  }

  return withCapabilities({
    actorType: "user",
    authSubjectType: "user",
    userId,
    clientId: null,
    businessId: null,
    staffId: null,
    role,
    permissions: [],
    isBusinessOwner: false,
    isPlatformAdmin: false,
    isClient: false,
    staffMemberships: [],
    legacyResolution: null,
  });
};

module.exports = {
  resolveActorContext,
};
