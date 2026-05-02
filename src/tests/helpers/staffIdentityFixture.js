const User = require("../../models/User/user");
const Business = require("../../models/User/business");
const Staff = require("../../models/staff");

const createBarberUser = (overrides = {}) =>
  User.create({
    name: overrides.name || "Staff Identity User",
    email: overrides.email || "staff-identity-user@example.com",
    password: "password123",
    role: "barber",
    isActive: true,
  });

const createOwnedBusiness = async (overrides = {}) => {
  const owner =
    overrides.owner ||
    (await createBarberUser({
      name: overrides.ownerName || "Staff Identity Owner",
      email: overrides.ownerEmail || "staff-identity-owner@example.com",
    }));

  const business = await Business.create({
    owner: owner._id,
    name: overrides.businessName || "Staff Identity Shop",
    contactInfo: { phone: overrides.phone || "+34000000000" },
  });

  return { owner, business };
};

const createStaffForBusiness = (business, overrides = {}) =>
  Staff.create({
    business: business._id,
    firstName: overrides.firstName || "Staff",
    lastName: overrides.lastName || "Identity",
    email: overrides.email || "staff-identity@example.com",
    user: overrides.userId,
  });

const linkStaffToUser = async (staff, user) => {
  staff.user = user._id;
  await staff.save();
  return staff;
};

module.exports = {
  createBarberUser,
  createOwnedBusiness,
  createStaffForBusiness,
  linkStaffToUser,
};
