const request = require("supertest");
const app = require("../app");
const Appointment = require("../models/appointment");
const Business = require("../models/User/business");
const Checkout = require("../models/checkout");
const Client = require("../models/client");
const Service = require("../models/service");
const Staff = require("../models/staff");
const User = require("../models/User/user");
const {
  createOperationalCommerceFixture,
} = require("./helpers/commerceFixture");
const { setupCommerceTestSuite } = require("./helpers/commerceTestSuite");

setupCommerceTestSuite();

const createVisitForFixture = async (fixture, overrides = {}) => {
  return Appointment.create({
    client: overrides.client || fixture.client._id,
    business: overrides.business || fixture.business._id,
    service: overrides.service || fixture.service._id,
    staff: overrides.staff === undefined ? fixture.staff._id : overrides.staff,
    date: overrides.date || new Date("2026-04-18T10:00:00.000Z"),
    startTime: overrides.startTime || "10:00",
    endTime: overrides.endTime || "10:45",
    duration: overrides.duration ?? 45,
    status: overrides.status || "Confirmed",
    bookingStatus: overrides.bookingStatus || "confirmed",
    visitStatus: overrides.visitStatus || "checked_in",
    visitType: overrides.visitType || "appointment",
    paymentStatus: overrides.paymentStatus || "Pending",
    price: overrides.price ?? 35,
    policySnapshot:
      overrides.policySnapshot ||
      Appointment.buildPolicySnapshot(fixture.business),
    operationalTimestamps: overrides.operationalTimestamps || {
      checkedInAt: new Date("2026-04-18T09:55:00.000Z"),
      checkedInBy: fixture.owner._id,
      serviceStartedAt: null,
      serviceStartedBy: null,
    },
  });
};

const createOtherBusinessVisit = async () => {
  const owner = await User.create({
    name: "Other Visit Owner",
    email: "other-visit-owner@example.com",
    password: "password123",
    role: "barber",
    isActive: true,
  });
  const business = await Business.create({
    owner: owner._id,
    name: "Other Visit Shop",
    contactInfo: { phone: "+34222222222" },
  });
  const service = await Service.create({
    business: business._id,
    name: "Other Cut",
    price: 25,
    currency: "EUR",
    duration: 30,
  });
  const staff = await Staff.create({
    business: business._id,
    firstName: "Other",
    lastName: "Staff",
    email: "other.staff@example.com",
  });
  const client = await Client.create({
    business: business._id,
    firstName: "Other",
    lastName: "Client",
    phone: "+34777777777",
  });

  return Appointment.create({
    client: client._id,
    business: business._id,
    service: service._id,
    staff: staff._id,
    date: new Date("2026-04-18T10:00:00.000Z"),
    startTime: "10:00",
    endTime: "10:30",
    duration: 30,
    status: "Confirmed",
    bookingStatus: "confirmed",
    visitStatus: "checked_in",
    visitType: "appointment",
    paymentStatus: "Pending",
    price: 25,
    policySnapshot: Appointment.buildPolicySnapshot(business),
  });
};

const createCheckoutForVisit = async (fixture, appointment, status = "paid") => {
  return Checkout.create({
    appointment: appointment._id,
    business: fixture.business._id,
    client: fixture.client._id,
    staff: fixture.staff._id,
    status,
    currency: "EUR",
    subtotal: 35,
    discountTotal: 0,
    tip: 0,
    total: 35,
    sourcePrice: 35,
    snapshot: {
      appointmentStatus: appointment.status,
      bookingStatus: appointment.bookingStatus,
      visitStatus: appointment.visitStatus,
      service: {
        id: fixture.service._id,
        name: fixture.service.name,
      },
      client: {
        id: fixture.client._id,
        firstName: fixture.client.firstName,
        lastName: fixture.client.lastName,
        phone: fixture.client.phone,
      },
      staff: {
        id: fixture.staff._id,
        firstName: fixture.staff.firstName,
        lastName: fixture.staff.lastName,
      },
    },
  });
};

const getVisits = (token, query = "") =>
  request(app)
    .get(`/business/visits${query}`)
    .set("Authorization", `Bearer ${token}`);

describe("Visit semantic layer v1", () => {
  test("requires authentication", async () => {
    const res = await request(app).get("/business/visits");

    expect(res.status).toBe(401);
  });

  test("returns only visits owned by the authenticated business owner", async () => {
    const fixture = await createOperationalCommerceFixture({
      ownerEmail: "visit-owner@example.com",
      businessName: "Visit Owner Shop",
    });
    const ownedVisit = await createVisitForFixture(fixture, {
      startTime: "11:00",
      endTime: "11:45",
    });
    await createOtherBusinessVisit();

    const res = await getVisits(fixture.token);

    expect(res.status).toBe(200);
    expect(res.body.data.source).toBe("appointment_semantic_layer");
    expect(res.body.data.count).toBe(1);
    expect(res.body.data.visits[0].sourceAppointmentId).toBe(
      ownedVisit._id.toString()
    );
    expect(res.body.data.visits[0].businessId).toBe(
      fixture.business._id.toString()
    );
  });

  test("excludes planned bookings by default and returns real visit states", async () => {
    const fixture = await createOperationalCommerceFixture({
      ownerEmail: "visit-default-owner@example.com",
      businessName: "Visit Default Shop",
    });

    await Promise.all([
      createVisitForFixture(fixture, {
        startTime: "10:00",
        endTime: "10:45",
        visitStatus: "checked_in",
      }),
      createVisitForFixture(fixture, {
        startTime: "11:00",
        endTime: "11:45",
        visitStatus: "in_service",
        operationalTimestamps: {
          checkedInAt: new Date("2026-04-18T10:55:00.000Z"),
          checkedInBy: fixture.owner._id,
          serviceStartedAt: new Date("2026-04-18T11:00:00.000Z"),
          serviceStartedBy: fixture.owner._id,
        },
      }),
      createVisitForFixture(fixture, {
        startTime: "12:00",
        endTime: "12:45",
        status: "Completed",
        visitStatus: "completed",
      }),
      createVisitForFixture(fixture, {
        startTime: "13:00",
        endTime: "13:45",
        status: "No-Show",
        visitStatus: "no_show",
      }),
      createVisitForFixture(fixture, {
        startTime: "14:00",
        endTime: "14:45",
        status: "Canceled",
        bookingStatus: "cancelled",
        visitStatus: "cancelled",
      }),
    ]);

    const res = await getVisits(fixture.token);

    expect(res.status).toBe(200);
    expect(res.body.data.count).toBe(5);
    expect(res.body.data.visits.map((visit) => visit.visitStatus)).toEqual([
      "checked_in",
      "in_service",
      "completed",
      "no_show",
      "cancelled",
    ]);
    expect(
      res.body.data.visits.some((visit) => visit.visitStatus === "not_started")
    ).toBe(false);
  });

  test("can include planned bookings explicitly for mixed agenda screens", async () => {
    const fixture = await createOperationalCommerceFixture({
      ownerEmail: "visit-planned-owner@example.com",
      businessName: "Visit Planned Shop",
    });
    await createVisitForFixture(fixture, {
      startTime: "11:00",
      endTime: "11:45",
      visitStatus: "checked_in",
    });

    const res = await getVisits(fixture.token, "?includePlanned=true");

    expect(res.status).toBe(200);
    expect(res.body.data.count).toBe(2);

    const plannedVisit = res.body.data.visits.find(
      (visit) => visit.sourceAppointmentId === fixture.appointment._id.toString()
    );
    expect(plannedVisit.visitStatus).toBe("not_started");
    expect(plannedVisit.isVisitStarted).toBe(false);
  });

  test("exposes checkout readiness only for a truly completed visit", async () => {
    const fixture = await createOperationalCommerceFixture({
      ownerEmail: "visit-checkout-owner@example.com",
      businessName: "Visit Checkout Shop",
    });
    const ready = await createVisitForFixture(fixture, {
      startTime: "10:00",
      endTime: "10:45",
      status: "Completed",
      visitStatus: "completed",
    });
    const legacyOnly = await createVisitForFixture(fixture, {
      startTime: "11:00",
      endTime: "11:45",
      status: "Completed",
      visitStatus: "in_service",
    });
    const semanticOnly = await createVisitForFixture(fixture, {
      startTime: "12:00",
      endTime: "12:45",
      status: "Confirmed",
      visitStatus: "completed",
    });
    const alreadyCheckedOut = await createVisitForFixture(fixture, {
      startTime: "13:00",
      endTime: "13:45",
      status: "Completed",
      visitStatus: "completed",
    });
    await createCheckoutForVisit(fixture, alreadyCheckedOut, "paid");

    const res = await getVisits(fixture.token);

    expect(res.status).toBe(200);
    const readinessById = new Map(
      res.body.data.visits.map((visit) => [
        visit.sourceAppointmentId,
        visit.checkoutReadiness.canOpenCheckout,
      ])
    );
    expect(readinessById.get(ready._id.toString())).toBe(true);
    expect(readinessById.get(legacyOnly._id.toString())).toBe(false);
    expect(readinessById.get(semanticOnly._id.toString())).toBe(false);
    expect(readinessById.get(alreadyCheckedOut._id.toString())).toBe(false);

    const blockedVisit = res.body.data.visits.find(
      (visit) => visit.sourceAppointmentId === alreadyCheckedOut._id.toString()
    );
    expect(blockedVisit.checkoutReadiness.reason).toBe(
      "terminal_checkout_exists"
    );
    expect(blockedVisit.checkoutReadiness.existingCheckout.status).toBe("paid");
  });

  test("filters visits by status and business day", async () => {
    const fixture = await createOperationalCommerceFixture({
      ownerEmail: "visit-filter-owner@example.com",
      businessName: "Visit Filter Shop",
    });
    await createVisitForFixture(fixture, {
      date: new Date("2026-04-19T10:00:00.000Z"),
      startTime: "10:00",
      endTime: "10:45",
      visitStatus: "checked_in",
    });
    const completedVisit = await createVisitForFixture(fixture, {
      date: new Date("2026-04-20T10:00:00.000Z"),
      startTime: "10:00",
      endTime: "10:45",
      status: "Completed",
      visitStatus: "completed",
    });

    const res = await getVisits(
      fixture.token,
      "?date=2026-04-20&visitStatus=completed"
    );

    expect(res.status).toBe(200);
    expect(res.body.data.count).toBe(1);
    expect(res.body.data.filters.date).toBe("2026-04-20");
    expect(res.body.data.visits[0].sourceAppointmentId).toBe(
      completedVisit._id.toString()
    );
    expect(res.body.data.visits[0].scheduled.date).toBe("2026-04-20");
  });

  test("rejects invalid filters instead of returning ambiguous visit data", async () => {
    const fixture = await createOperationalCommerceFixture({
      ownerEmail: "visit-invalid-owner@example.com",
      businessName: "Visit Invalid Shop",
    });

    const invalidStatusRes = await getVisits(
      fixture.token,
      "?visitStatus=serving"
    );
    expect(invalidStatusRes.status).toBe(400);
    expect(invalidStatusRes.body.message).toMatch(/invalid visitStatus/i);

    const invalidDateRes = await getVisits(fixture.token, "?date=20-04-2026");
    expect(invalidDateRes.status).toBe(400);
    expect(invalidDateRes.body.message).toMatch(/YYYY-MM-DD/);
  });
});
