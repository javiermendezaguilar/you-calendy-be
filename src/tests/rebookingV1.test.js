const request = require("supertest");
const app = require("../app");
const moment = require("moment");
const Appointment = require("../models/appointment");
const Checkout = require("../models/checkout");
const Payment = require("../models/payment");
const Service = require("../models/service");
const Staff = require("../models/staff");
const DomainEvent = require("../models/domainEvent");
const {
  connectCommerceTestDatabase,
  disconnectCommerceTestDatabase,
  createCommerceFixture,
} = require("./helpers/commerceFixture");

beforeAll(async () => {
  await connectCommerceTestDatabase();
});

afterAll(async () => {
  await disconnectCommerceTestDatabase();
});

describe("Rebooking v1", () => {
  const defaultRebookingPayload = {
    date: "2026-05-02",
    startTime: "11:30",
  };

  let owner;
  let business;
  let client;
  let service;
  let staff;
  let altService;
  let altStaff;
  let appointment;
  let token;
  let paidCheckout;

  const sendRebookingRequest = (payload = defaultRebookingPayload) =>
    request(app)
      .post(`/checkout/${paidCheckout._id}/rebook`)
      .set("Authorization", `Bearer ${token}`)
      .send(payload);

  const sendRebookingOutcomeRequest = (payload) =>
    request(app)
      .post(`/checkout/${paidCheckout._id}/rebooking-outcome`)
      .set("Authorization", `Bearer ${token}`)
      .send(payload);

  beforeEach(async () => {
    const fixture = await createCommerceFixture({
      ownerName: "Rebooking Owner",
      ownerEmail: "rebooking-owner@example.com",
      businessName: "Rebooking Shop",
      appointmentStatus: "Completed",
      paymentStatus: "Paid",
      promotion: {
        applied: false,
        discountAmount: 0,
        discountPercentage: 0,
        originalPrice: 0,
      },
      flashSale: {
        applied: false,
        discountAmount: 0,
        discountPercentage: 0,
        originalPrice: 0,
      },
    });

    owner = fixture.owner;
    business = fixture.business;
    client = fixture.client;
    service = fixture.service;
    staff = fixture.staff;
    appointment = fixture.appointment;
    token = fixture.token;

    staff.services = [{ service: service._id, timeInterval: 45 }];
    await staff.save();

    altService = await Service.create({
      business: business._id,
      name: "Premium Beard",
      price: 25,
      currency: "EUR",
      duration: 30,
      isActive: true,
    });

    altStaff = await Staff.create({
      business: business._id,
      firstName: "Robin",
      lastName: "Blade",
      services: [{ service: altService._id, timeInterval: 30 }],
    });

    paidCheckout = await Checkout.create({
      appointment: appointment._id,
      business: business._id,
      client: client._id,
      staff: staff._id,
      status: "paid",
      currency: "EUR",
      subtotal: 35,
      discountTotal: 0,
      tip: 4,
      total: 39,
      sourcePrice: 35,
      snapshot: {
        appointmentStatus: "Completed",
        bookingStatus: "confirmed",
        visitStatus: "completed",
        service: {
          id: service._id,
          name: service.name,
        },
        client: {
          id: client._id,
          firstName: client.firstName,
          lastName: client.lastName,
          phone: client.phone,
        },
        staff: {
          id: staff._id,
          firstName: staff.firstName,
          lastName: staff.lastName,
        },
        discounts: {
          promotion: { applied: false, id: null, amount: 0 },
          flashSale: { applied: false, id: null, amount: 0 },
        },
      },
      closedAt: new Date(),
      closedBy: owner._id,
    });

    await Payment.create({
      checkout: paidCheckout._id,
      appointment: appointment._id,
      business: business._id,
      client: client._id,
      staff: staff._id,
      status: "captured",
      method: "cash",
      currency: "EUR",
      amount: 39,
      tip: 4,
      reference: "rebooking-test-payment",
      capturedAt: new Date(),
      capturedBy: owner._id,
      snapshot: {
        subtotal: 35,
        discountTotal: 0,
        total: 39,
        sourcePrice: 35,
        service: {
          id: service._id,
          name: service.name,
        },
        client: {
          id: client._id,
          firstName: client.firstName,
          lastName: client.lastName,
        },
        discounts: {
          promotionAmount: 0,
          flashSaleAmount: 0,
        },
      },
    });
  });

  test("creates a rebooking from a paid checkout and persists traceability", async () => {
    const rebookRes = await sendRebookingRequest();

    expect(rebookRes.status).toBe(201);
    expect(rebookRes.body.data.status).toBe("Confirmed");
    expect(rebookRes.body.data.bookingStatus).toBe("booked");
    expect(rebookRes.body.data.visitStatus).toBe("not_started");
    expect(rebookRes.body.data.paymentStatus).toBe("Pending");
    expect(rebookRes.body.data.price).toBe(50);

    const storedCheckout = await Checkout.findById(paidCheckout._id).lean();
    expect(storedCheckout.rebooking.status).toBe("booked");
    expect(storedCheckout.rebooking.appointment).not.toBeNull();
    expect(storedCheckout.rebooking.source).toBe("checkout");

    const rebookedAppointment = await Appointment.findById(
      storedCheckout.rebooking.appointment
    ).lean();
    expect(rebookedAppointment).not.toBeNull();
    expect(rebookedAppointment.rebookingOrigin.checkout.toString()).toBe(
      paidCheckout._id.toString()
    );
    expect(rebookedAppointment.rebookingOrigin.appointment.toString()).toBe(
      appointment._id.toString()
    );
    expect(rebookedAppointment.rebookingOrigin.source).toBe("checkout");
  });

  test("captures current business policy snapshot on rebooking", async () => {
    const sourceSnapshot = appointment.policySnapshot;

    await business.updateOne({
      $set: {
        bookingBuffer: 90,
        "penaltySettings.noShowPenalty": true,
        "penaltySettings.noShowPenaltyAmount": 70,
        "policySettings.cancellationWindowMinutes": 240,
        "policySettings.noShowGracePeriodMinutes": 15,
        "policySettings.depositRequired": true,
        "policySettings.depositAmount": 30,
      },
    });

    const rebookRes = await sendRebookingRequest({
      date: "2026-05-03",
      startTime: "11:30",
    });

    expect(rebookRes.status).toBe(201);

    const rebookedAppointment = await Appointment.findById(
      rebookRes.body.data._id
    ).lean();

    expect(rebookedAppointment.policySnapshot.version).toBe(3);
    expect(rebookedAppointment.policySnapshot.bookingBufferMinutes).toBe(90);
    expect(rebookedAppointment.policySnapshot.noShowPenaltyEnabled).toBe(true);
    expect(rebookedAppointment.policySnapshot.noShowPenaltyAmount).toBe(70);
    expect(rebookedAppointment.policySnapshot.cancellationWindowMinutes).toBe(240);
    expect(rebookedAppointment.policySnapshot.noShowGracePeriodMinutes).toBe(15);
    expect(rebookedAppointment.policySnapshot.depositRequired).toBe(true);
    expect(rebookedAppointment.policySnapshot.depositAmount).toBe(30);
    expect(rebookedAppointment.policySnapshot.noShowPenaltyAmount).not.toBe(
      sourceSnapshot.noShowPenaltyAmount
    );
  });

  test("allows overriding service and staff and persists richer checkout traceability", async () => {
    const rebookRes = await request(app)
      .post(`/checkout/${paidCheckout._id}/rebook`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        date: "2026-05-04",
        startTime: "12:30",
        serviceId: altService._id,
        staffId: altStaff._id,
        source: "post_checkout",
      });

    expect(rebookRes.status).toBe(201);
    expect(rebookRes.body.data.service._id.toString()).toBe(altService._id.toString());
    expect(rebookRes.body.data.staff._id.toString()).toBe(altStaff._id.toString());
    expect(rebookRes.body.data.price).toBe(25);
    expect(rebookRes.body.data.duration).toBe(30);

    const storedCheckout = await Checkout.findById(paidCheckout._id).lean();
    expect(storedCheckout.rebooking.service.toString()).toBe(altService._id.toString());
    expect(storedCheckout.rebooking.staff.toString()).toBe(altStaff._id.toString());
    expect(storedCheckout.rebooking.source).toBe("post_checkout");

    const rebookedAppointment = await Appointment.findById(
      storedCheckout.rebooking.appointment
    ).lean();
    expect(rebookedAppointment.service.toString()).toBe(altService._id.toString());
    expect(rebookedAppointment.staff.toString()).toBe(altStaff._id.toString());
    expect(rebookedAppointment.rebookingOrigin.source).toBe("post_checkout");
  });

  test("tracks follow-up outcome and later converts it into booked rebooking", async () => {
    const outcomeRes = await sendRebookingOutcomeRequest({
      status: "follow_up_needed",
      source: "checkout",
      note: "Client asked to decide tomorrow",
    });

    expect(outcomeRes.status).toBe(200);
    expect(outcomeRes.body.data.rebooking.status).toBe("follow_up_needed");
    expect(outcomeRes.body.data.rebooking.source).toBe("checkout");
    expect(outcomeRes.body.data.rebooking.note).toBe(
      "Client asked to decide tomorrow"
    );

    const event = await DomainEvent.findOne({
      shopId: business._id,
      type: "rebooking_follow_up_needed",
    }).lean();
    expect(event).not.toBeNull();
    expect(event.payload.status).toBe("follow_up_needed");

    const rebookRes = await request(app)
      .post(`/checkout/${paidCheckout._id}/rebook`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        date: "2026-05-07",
        startTime: "12:30",
        source: "manual_follow_up",
      });

    expect(rebookRes.status).toBe(201);

    const storedCheckout = await Checkout.findById(paidCheckout._id).lean();
    expect(storedCheckout.rebooking.status).toBe("booked");
    expect(storedCheckout.rebooking.source).toBe("manual_follow_up");
    expect(storedCheckout.rebooking.appointment).not.toBeNull();

    const rebookedAppointment = await Appointment.findById(
      storedCheckout.rebooking.appointment
    ).lean();
    expect(rebookedAppointment.rebookingOrigin.source).toBe("manual_follow_up");
  });

  test("rejects marking rebooking outcome after booked rebooking exists", async () => {
    const firstRebook = await sendRebookingRequest();

    expect(firstRebook.status).toBe(201);

    const outcomeRes = await sendRebookingOutcomeRequest({
      status: "declined",
      source: "checkout",
    });

    expect(outcomeRes.status).toBe(409);
    expect(outcomeRes.body.message).toMatch(/booked rebooking/i);
  });

  test("rejects rebooking outcome when the checkout has any refund applied", async () => {
    paidCheckout.refundSummary = {
      refundedTotal: 10,
      status: "partial",
    };
    await paidCheckout.save();

    const outcomeRes = await sendRebookingOutcomeRequest({
      status: "declined",
      source: "checkout",
    });

    expect(outcomeRes.status).toBe(409);
    expect(outcomeRes.body.message).toMatch(/refunded checkout/i);
  });

  test("rejects a duplicate rebooking for the same checkout", async () => {
    const firstRebook = await sendRebookingRequest();

    expect(firstRebook.status).toBe(201);

    const duplicateRebook = await request(app)
      .post(`/checkout/${paidCheckout._id}/rebook`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        date: "2026-05-03",
        startTime: "12:30",
      });

    expect(duplicateRebook.status).toBe(409);
    expect(duplicateRebook.body.message).toMatch(/rebooking already exists/i);
  });

  test("rejects staff conflicts for the selected rebooking slot", async () => {
    await Appointment.create({
      client: client._id,
      business: business._id,
      service: altService._id,
      staff: altStaff._id,
      date: moment("2026-05-06", "YYYY-MM-DD").startOf("day").toDate(),
      startTime: "13:00",
      endTime: "13:30",
      duration: 30,
      status: "Confirmed",
      bookingStatus: "confirmed",
      visitStatus: "not_started",
      visitType: "appointment",
      paymentStatus: "Pending",
      price: 25,
    });

    const rebookRes = await request(app)
      .post(`/checkout/${paidCheckout._id}/rebook`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        date: "2026-05-06",
        startTime: "13:15",
        serviceId: altService._id,
        staffId: altStaff._id,
      });

    expect(rebookRes.status).toBe(409);
    expect(rebookRes.body.message).toMatch(/not available/i);
  });

  test("rejects rebooking from a checkout that is not paid", async () => {
    paidCheckout.status = "closed";
    await paidCheckout.save();

    const rebookRes = await sendRebookingRequest();

    expect(rebookRes.status).toBe(409);
    expect(rebookRes.body.message).toMatch(/must be paid/i);
  });

  test("rejects rebooking when the source appointment is not completed", async () => {
    appointment.status = "Confirmed";
    appointment.bookingStatus = "confirmed";
    appointment.visitStatus = "in_service";
    await appointment.save();

    const rebookRes = await sendRebookingRequest();

    expect(rebookRes.status).toBe(409);
    expect(rebookRes.body.message).toMatch(/source appointment must be completed/i);
  });

  test("rejects rebooking when checkout has no captured commerce payment", async () => {
    await Payment.deleteMany({ checkout: paidCheckout._id });

    const rebookRes = await sendRebookingRequest();

    expect(rebookRes.status).toBe(409);
    expect(rebookRes.body.message).toMatch(/captured payment/i);
  });

  test("rejects rebooking when the checkout has any refund applied", async () => {
    paidCheckout.refundSummary = {
      refundedTotal: 10,
      status: "partial",
    };
    await paidCheckout.save();

    await Payment.updateOne(
      { checkout: paidCheckout._id, paymentScope: "commerce_checkout" },
      {
        $set: {
          status: "refunded_partial",
          refundedTotal: 10,
        },
      }
    );

    const rebookRes = await sendRebookingRequest();

    expect(rebookRes.status).toBe(409);
    expect(rebookRes.body.message).toMatch(/refunded checkout/i);
  });
});
