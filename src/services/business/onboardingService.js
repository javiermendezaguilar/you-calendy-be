const BarberLink = require("../../models/barberLink");
const Service = require("../../models/service");
const Staff = require("../../models/staff");
const { buildServiceError, findOwnedBusinessOrThrow } = require("./coreService");

const DAYS = [
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
];

const hasText = (value) =>
  typeof value === "string" && value.trim().length > 0;

const toMinutes = (value) => {
  if (!/^\d{2}:\d{2}$/.test(String(value || ""))) {
    return null;
  }

  const [hours, minutes] = value.split(":").map(Number);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) {
    return null;
  }

  return hours * 60 + minutes;
};

const hasValidShift = (shift) => {
  const start = toMinutes(shift?.start);
  const end = toMinutes(shift?.end);
  return start !== null && end !== null && end > start;
};

const hasActiveHours = (hoursByDay = {}) =>
  DAYS.some((day) => {
    const dayConfig = hoursByDay?.[day];
    return (
      dayConfig?.enabled === true &&
      Array.isArray(dayConfig.shifts) &&
      dayConfig.shifts.some(hasValidShift)
    );
  });

const countActiveHourDays = (hoursByDay = {}) =>
  DAYS.filter((day) => {
    const dayConfig = hoursByDay?.[day];
    return (
      dayConfig?.enabled === true &&
      Array.isArray(dayConfig.shifts) &&
      dayConfig.shifts.some(hasValidShift)
    );
  }).length;

const buildSection = ({ complete, missing, action, details }) => ({
  complete,
  missing,
  action,
  details,
});

const getServiceId = (serviceAssignment) =>
  String(serviceAssignment?.service?._id || serviceAssignment?.service || "");

const hasAssignedActiveService = (staff, activeServiceIds) =>
  Array.isArray(staff.services) &&
  staff.services.some((serviceAssignment) =>
    activeServiceIds.has(getServiceId(serviceAssignment))
  );

const hasStaffHours = (staff) =>
  Array.isArray(staff.workingHours) &&
  staff.workingHours.some(
    (dayConfig) =>
      dayConfig?.enabled === true &&
      Array.isArray(dayConfig.shifts) &&
      dayConfig.shifts.some(hasValidShift)
  );

const buildBusinessProfileSection = (business) => {
  const missing = [];
  const hasContact =
    hasText(business.contactInfo?.phone) || hasText(business.contactInfo?.email);
  const hasAddress =
    hasText(business.location?.address) ||
    hasText(business.address?.city) ||
    hasText(business.address?.streetName);

  if (!hasText(business.name)) missing.push("business_name");
  if (!hasContact) missing.push("contact_phone_or_email");
  if (!hasAddress) missing.push("public_address_or_location");

  return buildSection({
    complete: missing.length === 0,
    missing,
    action: "complete_business_profile",
    details: {
      businessId: business._id,
      name: business.name || null,
      hasContact,
      hasAddress,
    },
  });
};

const buildBusinessHoursSection = (business) => {
  const activeDays = countActiveHourDays(business.businessHours);
  const complete = hasActiveHours(business.businessHours);

  return buildSection({
    complete,
    missing: complete ? [] : ["active_business_hours"],
    action: "set_business_hours",
    details: {
      activeDays,
      timeFormatPreference: business.timeFormatPreference || "12h",
    },
  });
};

const buildServicesSection = (services) => {
  const activeServices = services.filter(
    (service) =>
      service?.isActive !== false &&
      hasText(service.name) &&
      Number(service.duration || 0) > 0
  );
  const missing = [];

  if (activeServices.length === 0) {
    missing.push("active_service_with_duration");
  }

  return buildSection({
    complete: missing.length === 0,
    missing,
    action: "create_service",
    details: {
      totalServices: services.length,
      activeServices: activeServices.length,
    },
  });
};

const buildStaffSection = (staffMembers, activeServiceIds) => {
  const visibleStaff = staffMembers.filter(
    (staff) =>
      staff.availableForBooking !== false && staff.showInCalendar !== false
  );
  const readyStaff = visibleStaff.filter(
    (staff) =>
      hasStaffHours(staff) &&
      hasAssignedActiveService(staff, activeServiceIds)
  );
  const missing = [];

  if (visibleStaff.length === 0) missing.push("visible_staff");
  if (!visibleStaff.some(hasStaffHours)) missing.push("staff_working_hours");
  if (
    !visibleStaff.some((staff) =>
      hasAssignedActiveService(staff, activeServiceIds)
    )
  ) {
    missing.push("staff_service_assignment");
  }

  return buildSection({
    complete: missing.length === 0,
    missing,
    action: "configure_staff",
    details: {
      totalStaff: staffMembers.length,
      visibleStaff: visibleStaff.length,
      readyStaff: readyStaff.length,
    },
  });
};

const buildPolicySection = (business) => {
  const bookingBuffer = Number(business.bookingBuffer ?? 0);
  const hasReadablePolicy =
    Number.isFinite(bookingBuffer) &&
    bookingBuffer >= 0 &&
    business.policySettings !== undefined;

  return buildSection({
    complete: hasReadablePolicy,
    missing: hasReadablePolicy ? [] : ["base_policy"],
    action: "review_policy",
    details: {
      bookingBufferMinutes: hasReadablePolicy ? bookingBuffer : null,
      noShowPenaltyEnabled: business.penaltySettings?.noShowPenalty === true,
      lateCancelFeeEnabled:
        business.policySettings?.lateCancelFeeEnabled === true,
      depositRequired: business.policySettings?.depositRequired === true,
      blockOnNoShow: business.policySettings?.blockOnNoShow === true,
    },
  });
};

const buildPublicProfileSection = (business, activeBarberLink) => {
  const baseUrl = process.env.FRONTEND_URL || "http://localhost:5173";
  const publicUrl = activeBarberLink
    ? `${baseUrl}/barber/profile/${activeBarberLink.linkToken}`
    : business.contactInfo?.publicUrl || null;

  return buildSection({
    complete: Boolean(activeBarberLink),
    missing: activeBarberLink ? [] : ["active_public_profile_link"],
    action: "activate_public_profile",
    details: {
      publicUrl,
      linkToken: activeBarberLink?.linkToken || null,
      accessCount: activeBarberLink?.accessCount || 0,
    },
  });
};

const getOnboardingStatusForOwner = async (ownerId) => {
  if (!ownerId) {
    throw buildServiceError("Owner ID is required", 400);
  }

  const business = await findOwnedBusinessOrThrow(ownerId);
  const [canonicalServices, staffMembers, activeBarberLink] = await Promise.all([
    Service.find({ business: business._id }).sort({ createdAt: 1 }).lean(),
    Staff.find({ business: business._id }).lean(),
    BarberLink.findOne({ business: business._id, isActive: true }).lean(),
  ]);
  const services =
    canonicalServices.length > 0 ? canonicalServices : business.services || [];
  const activeServiceIds = new Set(
    services
      .filter(
        (service) =>
          service?.isActive !== false && Number(service.duration || 0) > 0
      )
      .map((service) => String(service._id))
  );

  const sections = {
    businessProfile: buildBusinessProfileSection(business),
    businessHours: buildBusinessHoursSection(business),
    services: buildServicesSection(services),
    staff: buildStaffSection(staffMembers, activeServiceIds),
    policy: buildPolicySection(business),
    publicProfile: buildPublicProfileSection(business, activeBarberLink),
  };
  const entries = Object.entries(sections);
  const firstIncomplete = entries.find(([, section]) => !section.complete);
  const completed = entries.filter(([, section]) => section.complete).length;

  return {
    businessId: business._id,
    readyForBooking: completed === entries.length,
    nextAction: firstIncomplete
      ? firstIncomplete[1].action
      : "ready_for_booking",
    summary: {
      completed,
      total: entries.length,
    },
    sections,
  };
};

module.exports = {
  getOnboardingStatusForOwner,
};
