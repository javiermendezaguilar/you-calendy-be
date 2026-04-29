const MATRIX_VERSION = "be-p1-27.v1";

const PERMISSION_DEFINITIONS = Object.freeze({
  "tenant.business.read": {
    area: "business",
    sensitivity: "normal",
    description: "Read tenant business profile and settings.",
  },
  "tenant.business.manage": {
    area: "business",
    sensitivity: "sensitive",
    description: "Manage tenant profile, settings and operational configuration.",
  },
  "tenant.staff.read": {
    area: "staff",
    sensitivity: "normal",
    description: "Read staff roster and availability.",
  },
  "tenant.staff.manage": {
    area: "staff",
    sensitivity: "sensitive",
    description: "Create, update or deactivate staff and schedules.",
  },
  "tenant.services.manage": {
    area: "services",
    sensitivity: "normal",
    description: "Manage service catalog used by booking and checkout.",
  },
  "tenant.clients.read": {
    area: "clients",
    sensitivity: "normal",
    description: "Read tenant client records.",
  },
  "tenant.clients.manage": {
    area: "clients",
    sensitivity: "sensitive",
    description: "Create, update or deactivate tenant client records.",
  },
  "tenant.appointments.manage": {
    area: "appointments",
    sensitivity: "sensitive",
    description: "Create, move, cancel and manage appointments for the tenant.",
  },
  "tenant.appointments.own.operate": {
    area: "appointments",
    sensitivity: "normal",
    description: "Operate own assigned appointments: check-in, start and complete.",
  },
  "tenant.policy.waive": {
    area: "policy",
    sensitivity: "critical",
    description: "Waive no-show or late-cancel outcomes.",
  },
  "tenant.checkout.manage": {
    area: "checkout",
    sensitivity: "sensitive",
    description: "Open, edit and close operational checkout.",
  },
  "tenant.payment.capture": {
    area: "payment",
    sensitivity: "critical",
    description: "Capture operational payment.",
  },
  "tenant.payment.refund": {
    area: "payment",
    sensitivity: "critical",
    description: "Create operational refund.",
  },
  "tenant.payment.void": {
    area: "payment",
    sensitivity: "critical",
    description: "Void operational payment.",
  },
  "tenant.cash.open": {
    area: "cash",
    sensitivity: "critical",
    description: "Open cash session.",
  },
  "tenant.cash.close": {
    area: "cash",
    sensitivity: "critical",
    description: "Close cash session and freeze drawer summary.",
  },
  "tenant.reporting.read": {
    area: "reporting",
    sensitivity: "sensitive",
    description: "Read operational and financial reporting.",
  },
  "tenant.reconciliation.read": {
    area: "reconciliation",
    sensitivity: "sensitive",
    description: "Read internal financial reconciliation issues.",
  },
  "tenant.billing.manage": {
    area: "billing",
    sensitivity: "critical",
    description: "Manage SaaS subscription, plan and billing access.",
  },
  "tenant.entitlements.read": {
    area: "billing",
    sensitivity: "sensitive",
    description: "Read product access, feature flags and plan limits.",
  },
  "client.appointments.own.manage": {
    area: "client",
    sensitivity: "normal",
    description: "Manage own client appointments where business policy allows.",
  },
  "client.profile.own.manage": {
    area: "client",
    sensitivity: "normal",
    description: "Manage own client profile.",
  },
  "client.policy_charge.deposit.create": {
    area: "policy",
    sensitivity: "critical",
    description: "Create own deposit payment attempt when required by policy.",
  },
  "platform.stats.read": {
    area: "platform",
    sensitivity: "sensitive",
    description: "Read platform-wide operational statistics.",
  },
  "platform.users.manage": {
    area: "platform",
    sensitivity: "critical",
    description: "Manage platform users and account status.",
  },
  "platform.plans.manage": {
    area: "platform",
    sensitivity: "critical",
    description: "Manage SaaS plans and public package definitions.",
  },
  "platform.support.read": {
    area: "platform",
    sensitivity: "sensitive",
    description: "Read platform support surfaces.",
  },
});

const role = ({
  label,
  scope,
  identityStatus,
  permissionKeys,
  deniedByDefault = [],
  notes = [],
}) =>
  Object.freeze({
    label,
    scope,
    identityStatus,
    permissionKeys: Object.freeze(permissionKeys),
    deniedByDefault: Object.freeze(deniedByDefault),
    notes: Object.freeze(notes),
  });

const ROLE_MATRIX = Object.freeze({
  owner: role({
    label: "Owner",
    scope: "tenant",
    identityStatus: "implemented",
    permissionKeys: [
      "tenant.business.read",
      "tenant.business.manage",
      "tenant.staff.read",
      "tenant.staff.manage",
      "tenant.services.manage",
      "tenant.clients.read",
      "tenant.clients.manage",
      "tenant.appointments.manage",
      "tenant.appointments.own.operate",
      "tenant.policy.waive",
      "tenant.checkout.manage",
      "tenant.payment.capture",
      "tenant.payment.refund",
      "tenant.payment.void",
      "tenant.cash.open",
      "tenant.cash.close",
      "tenant.reporting.read",
      "tenant.reconciliation.read",
      "tenant.billing.manage",
      "tenant.entitlements.read",
    ],
  }),
  manager: role({
    label: "Manager",
    scope: "tenant",
    identityStatus: "planned_identity",
    permissionKeys: [
      "tenant.business.read",
      "tenant.staff.read",
      "tenant.services.manage",
      "tenant.clients.read",
      "tenant.clients.manage",
      "tenant.appointments.manage",
      "tenant.checkout.manage",
      "tenant.payment.capture",
      "tenant.cash.open",
      "tenant.cash.close",
      "tenant.reporting.read",
      "tenant.reconciliation.read",
      "tenant.entitlements.read",
    ],
    deniedByDefault: [
      "tenant.billing.manage",
      "tenant.payment.refund",
      "tenant.payment.void",
      "tenant.policy.waive",
      "tenant.staff.manage",
    ],
    notes: [
      "Manager is defined for FE and future identity provisioning; no canonical manager login exists yet.",
    ],
  }),
  reception: role({
    label: "Reception",
    scope: "tenant",
    identityStatus: "planned_identity",
    permissionKeys: [
      "tenant.business.read",
      "tenant.staff.read",
      "tenant.clients.read",
      "tenant.clients.manage",
      "tenant.appointments.manage",
      "tenant.checkout.manage",
    ],
    deniedByDefault: [
      "tenant.billing.manage",
      "tenant.payment.capture",
      "tenant.payment.refund",
      "tenant.payment.void",
      "tenant.policy.waive",
      "tenant.cash.open",
      "tenant.cash.close",
      "tenant.reporting.read",
      "tenant.reconciliation.read",
      "tenant.staff.manage",
    ],
    notes: [
      "Reception is defined for FE and future identity provisioning; no canonical reception login exists yet.",
    ],
  }),
  barber: role({
    label: "Barber",
    scope: "tenant_staff",
    identityStatus: "legacy_staff_email_match",
    permissionKeys: [
      "tenant.business.read",
      "tenant.staff.read",
      "tenant.clients.read",
      "tenant.appointments.own.operate",
      "tenant.checkout.manage",
    ],
    deniedByDefault: [
      "tenant.billing.manage",
      "tenant.staff.manage",
      "tenant.payment.capture",
      "tenant.payment.refund",
      "tenant.payment.void",
      "tenant.policy.waive",
      "tenant.cash.open",
      "tenant.cash.close",
      "tenant.reporting.read",
      "tenant.reconciliation.read",
    ],
    notes: [
      "Current barber identity is resolved by matching User.email to Staff.email.",
    ],
  }),
  client: role({
    label: "Client",
    scope: "client_self",
    identityStatus: "implemented",
    permissionKeys: [
      "client.appointments.own.manage",
      "client.profile.own.manage",
      "client.policy_charge.deposit.create",
    ],
    deniedByDefault: [
      "tenant.business.manage",
      "tenant.clients.read",
      "tenant.payment.capture",
      "tenant.payment.refund",
      "tenant.payment.void",
      "tenant.cash.open",
      "tenant.cash.close",
      "tenant.reporting.read",
      "tenant.reconciliation.read",
      "tenant.billing.manage",
    ],
  }),
  admin: role({
    label: "Internal Admin",
    scope: "platform",
    identityStatus: "implemented",
    permissionKeys: [
      "platform.stats.read",
      "platform.users.manage",
      "platform.plans.manage",
      "platform.support.read",
    ],
    deniedByDefault: [
      "tenant.business.manage",
      "tenant.payment.capture",
      "tenant.payment.refund",
      "tenant.payment.void",
      "tenant.cash.open",
      "tenant.cash.close",
      "tenant.billing.manage",
    ],
    notes: [
      "Platform admin is not tenant owner by default, even if a legacy Business.owner points to the same User.",
    ],
  }),
  "sub-admin": role({
    label: "Internal Sub-Admin",
    scope: "platform",
    identityStatus: "implemented",
    permissionKeys: ["platform.support.read"],
    deniedByDefault: [
      "platform.users.manage",
      "platform.plans.manage",
      "tenant.business.manage",
      "tenant.payment.refund",
      "tenant.cash.close",
      "tenant.billing.manage",
    ],
    notes: [
      "Sub-admin keeps legacy permission level as an overlay until admin permissions are consolidated.",
    ],
  }),
  unassigned: role({
    label: "Unassigned User",
    scope: "none",
    identityStatus: "implemented",
    permissionKeys: [],
    deniedByDefault: [
      "tenant.business.read",
      "tenant.appointments.manage",
      "tenant.payment.capture",
      "tenant.payment.refund",
      "tenant.cash.close",
      "platform.support.read",
    ],
  }),
});

const HYBRID_ADMIN_OWNER_POLICY = Object.freeze({
  id: "platform_admin_takes_precedence",
  decision:
    "If a User is platform admin or sub-admin and also appears as Business.owner, resolve as platform actor, not tenant owner.",
  reason:
    "Platform support identity must not silently receive tenant money, cash or billing permissions.",
});

const EFFECTIVE_ROLE_BY_ACTOR_TYPE = Object.freeze({
  owner: "owner",
  staff: "barber",
  client: "client",
  admin: "admin",
  "sub-admin": "sub-admin",
});

const legacyPermissionsToArray = (permissions) => {
  if (!permissions) return [];
  if (Array.isArray(permissions)) return permissions.filter(Boolean);
  return [permissions].filter(Boolean);
};

const unique = (values) => Array.from(new Set(values));

const getSensitivePermissionKeys = (permissionKeys) =>
  permissionKeys.filter((permissionKey) => {
    const definition = PERMISSION_DEFINITIONS[permissionKey];
    return definition?.sensitivity === "sensitive" || definition?.sensitivity === "critical";
  });

const getEffectiveRole = (actorContext = {}) => {
  return EFFECTIVE_ROLE_BY_ACTOR_TYPE[actorContext.actorType] || "unassigned";
};

const getSubAdminPermissionKeys = (legacyPermissions) => {
  const normalized = legacyPermissionsToArray(legacyPermissions);
  if (normalized.includes("complete access")) {
    return ROLE_MATRIX.admin.permissionKeys;
  }
  if (normalized.includes("management access")) {
    return ["platform.stats.read", "platform.support.read"];
  }
  return ROLE_MATRIX["sub-admin"].permissionKeys;
};

const resolveCapabilitiesForActor = (actorContext = {}) => {
  const effectiveRole = getEffectiveRole(actorContext);
  const roleConfig = ROLE_MATRIX[effectiveRole] || ROLE_MATRIX.unassigned;
  const legacyPermissions = legacyPermissionsToArray(actorContext.permissions);
  const permissionKeys =
    effectiveRole === "sub-admin"
      ? getSubAdminPermissionKeys(legacyPermissions)
      : roleConfig.permissionKeys;

  return {
    matrixVersion: MATRIX_VERSION,
    effectiveRole,
    roleLabel: roleConfig.label,
    scope: roleConfig.scope,
    identityStatus: roleConfig.identityStatus,
    businessId: actorContext.businessId || null,
    staffId: actorContext.staffId || null,
    clientId: actorContext.clientId || null,
    permissionKeys: unique(permissionKeys),
    sensitivePermissionKeys: getSensitivePermissionKeys(permissionKeys),
    deniedByDefault: roleConfig.deniedByDefault,
    notes: roleConfig.notes,
    legacyPermissions,
    hybridAdminOwnerPolicy:
      actorContext.legacyResolution?.type === "platform_admin_owner_hybrid"
        ? HYBRID_ADMIN_OWNER_POLICY
        : null,
  };
};

const buildRolePermissionMatrix = () => ({
  matrixVersion: MATRIX_VERSION,
  roles: ROLE_MATRIX,
  permissionDefinitions: PERMISSION_DEFINITIONS,
  sensitivePermissionKeys: getSensitivePermissionKeys(
    Object.keys(PERMISSION_DEFINITIONS)
  ),
  hybridAdminOwnerPolicy: HYBRID_ADMIN_OWNER_POLICY,
  identityMapping: {
    owner: "User.role=barber with Business.owner=User._id",
    barber: "Legacy User.email matched to Staff.email",
    client: "Client document authenticated with client token",
    admin: "User.role=admin, platform scope",
    "sub-admin": "User.role=sub-admin, platform scope plus legacy permission level",
    manager: "Defined in matrix; identity provisioning pending",
    reception: "Defined in matrix; identity provisioning pending",
  },
});

module.exports = {
  MATRIX_VERSION,
  ROLE_MATRIX,
  PERMISSION_DEFINITIONS,
  HYBRID_ADMIN_OWNER_POLICY,
  buildRolePermissionMatrix,
  resolveCapabilitiesForActor,
};
