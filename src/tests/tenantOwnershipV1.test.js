const request = require("supertest");
const jwt = require("jsonwebtoken");
const app = require("../app");
const Appointment = require("../models/appointment");
const Business = require("../models/User/business");
const Client = require("../models/client");
const Service = require("../models/service");
const Staff = require("../models/staff");
const User = require("../models/User/user");
const {
  createCommerceFixture,
} = require("./helpers/commerceFixture");
const { setupCommerceTestSuite } = require("./helpers/commerceTestSuite");

setupCommerceTestSuite();

const authHeaderFor = (payload) =>
  `Bearer ${jwt.sign(payload, process.env.JWT_SECRET)}`;

const noDiscountState = () => ({
  applied: false,
  discountAmount: 0,
  discountPercentage: 0,
  originalPrice: 0,
});

const phoneForLabel = (label) => {
  const suffix = String(label)
    .split("")
    .reduce((sum, char) => sum + char.charCodeAt(0), 0)
    .toString()
    .padStart(6, "0")
    .slice(-6);
  return `+34666${suffix}`;
};

const createTenant = async (label, overrides = {}) => {
  const owner = await User.create({
    name: `${label} Owner`,
    email: `${label.toLowerCase()}-owner@example.com`,
    password: "password123",
    role: overrides.ownerRole || "barber",
    isActive: true,
  });

  const business = await Business.create({
    owner: owner._id,
    name: `${label} Shop`,
    contactInfo: { phone: "+34999999999" },
    bookingBuffer: 0,
  });

  const service = await Service.create({
    business: business._id,
    name: `${label} Cut`,
    price: overrides.servicePrice ?? 80,
    currency: "EUR",
    duration: 45,
  });

  const staff = await Staff.create({
    business: business._id,
    firstName: `${label} Staff`,
    lastName: "Member",
    email: `${label.toLowerCase()}-staff@example.com`,
    services: [{ service: service._id, timeInterval: 45 }],
  });

  const client = await Client.create({
    business: business._id,
    firstName: `${label} Client`,
    lastName: "One",
    phone: phoneForLabel(label),
  });

  return {
    owner,
    business,
    service,
    staff,
    client,
    token: jwt.sign(
      { id: owner._id, role: owner.role },
      process.env.JWT_SECRET
    ),
  };
};

const appointmentPayloadForTenant = (
  tenant,
  date = "2035-06-01",
  startTime = "10:00"
) => ({
  businessId: tenant.business._id,
  clientId: tenant.client._id,
  serviceId: tenant.service._id,
  staffId: tenant.staff._id,
  date,
  startTime,
});

describe("Tenant ownership v1", () => {
  test("rejects creating an appointment in another business", async () => {
    const actorTenant = await createCommerceFixture({
      ownerEmail: "tenant-owner-a@example.com",
      businessName: "Tenant A Shop",
    });
    const targetTenant = await createTenant("TenantB");

    const res = await request(app)
      .post("/appointments")
      .set("Authorization", `Bearer ${actorTenant.token}`)
      .send(appointmentPayloadForTenant(targetTenant));

    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/not authorized/i);
    await expect(
      Appointment.countDocuments({ business: targetTenant.business._id })
    ).resolves.toBe(0);
  });

  test("rejects changing an appointment to a service from another business", async () => {
    const actorTenant = await createCommerceFixture({
      ownerEmail: "tenant-update-owner@example.com",
      businessName: "Tenant Update Shop",
      appointmentStatus: "Confirmed",
      bookingStatus: "confirmed",
      visitStatus: "not_started",
      paymentStatus: "Pending",
      promotion: noDiscountState(),
      flashSale: noDiscountState(),
    });
    const targetTenant = await createTenant("TenantC", { servicePrice: 120 });

    const res = await request(app)
      .put(`/appointments/${actorTenant.appointment._id}`)
      .set("Authorization", `Bearer ${actorTenant.token}`)
      .send({
        serviceId: targetTenant.service._id,
        date: "2035-06-02",
        startTime: "11:00",
      });

    expect(res.status).toBe(404);
    expect(res.body.message).toMatch(/doesn't belong/i);

    const storedAppointment = await Appointment.findById(
      actorTenant.appointment._id
    ).lean();
    expect(storedAppointment.service.toString()).toBe(
      actorTenant.service._id.toString()
    );
    expect(storedAppointment.price).toBe(actorTenant.appointment.price);
  });

  test("does not treat platform admins as tenant owners by default", async () => {
    const adminTenant = await createTenant("AdminOwned", {
      ownerRole: "admin",
    });
    await Appointment.create({
      business: adminTenant.business._id,
      client: adminTenant.client._id,
      service: adminTenant.service._id,
      staff: adminTenant.staff._id,
      date: new Date("2035-05-01T00:00:00.000Z"),
      startTime: "09:00",
      endTime: "09:45",
      duration: 45,
      status: "Confirmed",
      bookingStatus: "confirmed",
      visitStatus: "not_started",
      price: adminTenant.service.price,
      policySnapshot: Appointment.buildPolicySnapshot(adminTenant.business),
    });

    const res = await request(app)
      .post("/appointments")
      .set(
        "Authorization",
        authHeaderFor({ id: adminTenant.owner._id, role: "admin" })
      )
      .send(appointmentPayloadForTenant(adminTenant));

    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/not authorized/i);
    await expect(
      Appointment.countDocuments({ business: adminTenant.business._id })
    ).resolves.toBe(1);

    const listRes = await request(app)
      .get("/appointments")
      .set(
        "Authorization",
        authHeaderFor({ id: adminTenant.owner._id, role: "admin" })
      );

    expect(listRes.status).toBe(403);
    expect(listRes.body.message).toMatch(/not authorized/i);
  });
});
