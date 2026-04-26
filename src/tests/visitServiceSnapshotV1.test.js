const request = require("supertest");
const app = require("../app");
const Business = require("../models/User/business");
const Checkout = require("../models/checkout");
const Payment = require("../models/payment");
const Service = require("../models/service");
const Staff = require("../models/staff");
const User = require("../models/User/user");
const { createCommerceFixture } = require("./helpers/commerceFixture");
const { setupCommerceTestSuite } = require("./helpers/commerceTestSuite");

setupCommerceTestSuite();

const noDiscount = () => ({
  applied: false,
  discountAmount: 0,
  discountPercentage: 0,
  originalPrice: 0,
});

const createCompletedFixture = (overrides = {}) =>
  createCommerceFixture({
    appointmentStatus: "Completed",
    bookingStatus: "confirmed",
    visitStatus: "completed",
    paymentStatus: "Pending",
    promotion: noDiscount(),
    flashSale: noDiscount(),
    ...overrides,
  });

const openCheckout = (fixture) =>
  request(app)
    .post(`/checkout/appointment/${fixture.appointment._id}/open`)
    .set("Authorization", `Bearer ${fixture.token}`);

const updateServiceLines = (fixture, checkoutId, serviceLines) =>
  request(app)
    .put(`/checkout/${checkoutId}/service-lines`)
    .set("Authorization", `Bearer ${fixture.token}`)
    .send({ serviceLines });

const createAdditionalService = (businessId, overrides = {}) =>
  Service.create({
    business: businessId,
    name: overrides.name || "Beard Trim",
    price: overrides.price ?? 22,
    currency: "EUR",
    duration: overrides.duration ?? 25,
    isActive: true,
  });

const createAdditionalStaff = (businessId, overrides = {}) =>
  Staff.create({
    business: businessId,
    firstName: overrides.firstName || "Marta",
    lastName: overrides.lastName || "Blade",
    email: overrides.email || "marta.blade@example.com",
  });

const createForeignResources = async () => {
  const owner = await User.create({
    name: "Foreign Service Owner",
    email: "foreign-service-owner@example.com",
    password: "password123",
    role: "barber",
    isActive: true,
  });
  const business = await Business.create({
    owner: owner._id,
    name: "Foreign Service Shop",
    contactInfo: { phone: "+34999999999" },
  });

  const [service, staff] = await Promise.all([
    Service.create({
      business: business._id,
      name: "Foreign Cut",
      price: 99,
      currency: "EUR",
      duration: 60,
      isActive: true,
    }),
    Staff.create({
      business: business._id,
      firstName: "Foreign",
      lastName: "Staff",
      email: "foreign.staff@example.com",
    }),
  ]);

  return { service, staff };
};

describe("Visit service snapshot v1", () => {
  test("opens checkout with a default performed service line from the completed visit", async () => {
    const fixture = await createCompletedFixture({
      ownerEmail: "visit-service-default-owner@example.com",
      businessName: "Visit Service Default Shop",
    });

    const openRes = await openCheckout(fixture);

    expect(openRes.status).toBe(201);
    expect(openRes.body.data.serviceLines).toHaveLength(1);
    expect(openRes.body.data.serviceLines[0].service.name).toBe(
      "Signature Cut"
    );
    expect(openRes.body.data.serviceLines[0].staff.firstName).toBe("Alex");
    expect(openRes.body.data.serviceLines[0].unitPrice).toBe(35);
    expect(openRes.body.data.serviceLines[0].durationMinutes).toBe(45);
    expect(openRes.body.data.serviceLines[0].lineTotal).toBe(35);
    expect(openRes.body.data.serviceLines[0].source).toBe(
      "reserved_service_default"
    );

    const storedCheckout = await Checkout.findById(openRes.body.data._id).lean();
    expect(storedCheckout.serviceLines[0].lineTotal).toBe(35);
  });

  test("updates actual service lines on open checkout and carries them to visits and payment snapshot", async () => {
    const fixture = await createCompletedFixture({
      ownerEmail: "visit-service-update-owner@example.com",
      businessName: "Visit Service Update Shop",
    });
    const [service, staff] = await Promise.all([
      createAdditionalService(fixture.business._id),
      createAdditionalStaff(fixture.business._id),
    ]);

    const openRes = await openCheckout(fixture);
    const checkoutId = openRes.body.data._id;

    const updateRes = await updateServiceLines(fixture, checkoutId, [
      {
        serviceId: service._id,
        staffId: staff._id,
        quantity: 2,
        unitPrice: 22,
        durationMinutes: 25,
        adjustmentAmount: -4,
        note: "Actual service changed at chair",
      },
    ]);

    expect(updateRes.status).toBe(200);
    expect(updateRes.body.data.subtotal).toBe(40);
    expect(updateRes.body.data.total).toBe(40);
    expect(updateRes.body.data.serviceLines[0].service.name).toBe(
      "Beard Trim"
    );
    expect(updateRes.body.data.serviceLines[0].staff.firstName).toBe("Marta");
    expect(updateRes.body.data.serviceLines[0].lineTotal).toBe(40);
    expect(updateRes.body.data.serviceLines[0].source).toBe("manual_adjustment");

    const closeRes = await request(app)
      .post(`/checkout/${checkoutId}/close`)
      .set("Authorization", `Bearer ${fixture.token}`)
      .send({ tip: 3 });

    expect(closeRes.status).toBe(200);
    expect(closeRes.body.data.total).toBe(43);

    const captureRes = await request(app)
      .post(`/payment/checkout/${checkoutId}/capture`)
      .set("Authorization", `Bearer ${fixture.token}`)
      .send({ method: "card_manual", amount: 43 });

    expect(captureRes.status).toBe(201);

    const payment = await Payment.findById(captureRes.body.data._id).lean();
    expect(payment.snapshot.serviceLines).toHaveLength(1);
    expect(payment.snapshot.serviceLines[0].service.name).toBe("Beard Trim");
    expect(payment.snapshot.serviceLines[0].lineTotal).toBe(40);

    const visitsRes = await request(app)
      .get("/business/visits?visitStatus=completed")
      .set("Authorization", `Bearer ${fixture.token}`);

    expect(visitsRes.status).toBe(200);
    expect(visitsRes.body.data.visits[0].performedServiceSource).toBe(
      "checkout_service_lines"
    );
    expect(visitsRes.body.data.visits[0].performedServices[0].service.name).toBe(
      "Beard Trim"
    );
  });

  test("rejects service line mutation after checkout is closed", async () => {
    const fixture = await createCompletedFixture({
      ownerEmail: "visit-service-closed-owner@example.com",
      businessName: "Visit Service Closed Shop",
    });

    const openRes = await openCheckout(fixture);
    const checkoutId = openRes.body.data._id;

    const closeRes = await request(app)
      .post(`/checkout/${checkoutId}/close`)
      .set("Authorization", `Bearer ${fixture.token}`)
      .send({ tip: 0 });

    expect(closeRes.status).toBe(200);

    const updateRes = await updateServiceLines(fixture, checkoutId, [
      {
        serviceId: fixture.service._id,
        staffId: fixture.staff._id,
        quantity: 1,
        unitPrice: 20,
      },
    ]);

    expect(updateRes.status).toBe(409);
    expect(updateRes.body.message).toMatch(/checkout is open/i);
  });

  test("rejects service lines from another business", async () => {
    const fixture = await createCompletedFixture({
      ownerEmail: "visit-service-ownership-owner@example.com",
      businessName: "Visit Service Ownership Shop",
    });
    const foreign = await createForeignResources();
    const openRes = await openCheckout(fixture);
    const checkoutId = openRes.body.data._id;

    const foreignServiceRes = await updateServiceLines(fixture, checkoutId, [
      {
        serviceId: foreign.service._id,
        staffId: fixture.staff._id,
        quantity: 1,
        unitPrice: 20,
      },
    ]);

    expect(foreignServiceRes.status).toBe(404);
    expect(foreignServiceRes.body.message).toMatch(/service not found/i);

    const foreignStaffRes = await updateServiceLines(fixture, checkoutId, [
      {
        serviceId: fixture.service._id,
        staffId: foreign.staff._id,
        quantity: 1,
        unitPrice: 20,
      },
    ]);

    expect(foreignStaffRes.status).toBe(404);
    expect(foreignStaffRes.body.message).toMatch(/staff not found/i);
  });

  test("rejects invalid service lines that would create negative totals", async () => {
    const fixture = await createCompletedFixture({
      ownerEmail: "visit-service-invalid-owner@example.com",
      businessName: "Visit Service Invalid Shop",
    });
    const openRes = await openCheckout(fixture);

    const updateRes = await updateServiceLines(fixture, openRes.body.data._id, [
      {
        serviceId: fixture.service._id,
        staffId: fixture.staff._id,
        quantity: 1,
        unitPrice: 10,
        adjustmentAmount: -20,
      },
    ]);

    expect(updateRes.status).toBe(400);
    expect(updateRes.body.message).toMatch(/line total/i);
  });
});
