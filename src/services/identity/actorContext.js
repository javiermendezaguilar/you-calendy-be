const Business = require("../../models/User/business");
const Staff = require("../../models/staff");

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
  email: staff.email || null,
  displayName: [staff.firstName, staff.lastName].filter(Boolean).join(" ").trim(),
});

const resolveActorContext = async ({ user, client } = {}) => {
  if (client || user?.type === "client" || user?.role === "client") {
    const clientDoc = client || null;
    const businessId = toIdString(clientDoc?.business || user?.businessId);
    const staffId = toIdString(clientDoc?.staff);

    return {
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
    };
  }

  if (!user) {
    return {
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
    };
  }

  const userId = toIdString(user._id || user.id);
  const role = user.role || "barber";
  const isPlatformAdmin = role === "admin" || role === "sub-admin";

  if (isPlatformAdmin) {
    return {
      actorType: role === "admin" ? "admin" : "sub-admin",
      authSubjectType: "user",
      userId,
      clientId: null,
      businessId: null,
      staffId: null,
      role,
      permissions: user.permissions ? [user.permissions] : [],
      isBusinessOwner: false,
      isPlatformAdmin: true,
      isClient: false,
      staffMemberships: [],
      legacyResolution: null,
    };
  }

  const ownedBusiness = await Business.findOne({ owner: userId }).select("_id");
  if (ownedBusiness) {
    return {
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
    };
  }

  const email = normalizeEmail(user.email);
  const staffMemberships = email
    ? await Staff.find({ email }).select("_id business firstName lastName email")
    : [];
  const mappedStaffMemberships = staffMemberships.map(mapStaffMembership);
  const primaryStaff = mappedStaffMemberships[0] || null;

  if (primaryStaff) {
    return {
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
        type: "staff_email_match",
        field: "email",
      },
    };
  }

  return {
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
  };
};

module.exports = {
  resolveActorContext,
};
