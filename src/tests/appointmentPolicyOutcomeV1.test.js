const request = require("supertest");
const jwt = require("jsonwebtoken");
const app = require("../app");
const Appointment = require("../models/appointment");
const Client = require("../models/client");
const DomainEvent = require("../models/domainEvent");
const {
  connectCommerceTestDatabase,
  disconnectCommerceTestDatabase,
  createCommerceFixture,
} = require("./helpers/commerceFixture");

const toDateOnly = (date) =>
  new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  );

const timeString = (date) => date.toISOString().slice(11, 16);

const noDiscountState = () => ({
  applied: false,
  discountAmount: 0,
  discountPercentage: 0,
  originalPrice: 0,
});

const setAppointmentRelativeStart = async (appointment, minutesFromNow) => {
  const start = new Date(Date.now() + minutesFromNow * 60 * 1000);
  const end = new Date(start.getTime() + 45 * 60 * 1000);

  await Appointment.findByIdAndUpdate(appointment._id, {
    date: toDateOnly(start),
    startTime: timeString(start),
    endTime: timeString(end),
  });

  return Appointment.findById(appointment._id);
};

const createClientToken = (client, businessId) =>
  jwt.sign(
    { id: client._id, role: "client", type: "client", businessId },
    process.env.JWT_SECRET
  );

const updateAppointmentStatus = (appointmentId, authToken, payload) =>
  request(app)
    .put(`/appointments/${appointmentId}/status`)
    .set("Authorization", `Bearer ${authToken}`)
    .send(payload);

const applyPenalty = (appointmentId, authToken, payload) =>
  request(app)
    .post(`/appointments/${appointmentId}/penalty`)
    .set("Authorization", `Bearer ${authToken}`)
    .send(payload);

const findPolicyEvent = (type, appointmentId) =>
  DomainEvent.findOne({
    type,
    "payload.appointmentId": appointmentId,
  }).lean();

beforeAll(async () => {
  await connectCommerceTestDatabase();
});

afterAll(async () => {
  await disconnectCommerceTestDatabase();
});

describe("Appointment policy outcome v1", () => {
  let fixture;
  let appointment;
  let token;
  let clientToken;

  beforeEach(async () => {
    fixture = await createCommerceFixture({
      ownerName: "Policy Outcome Owner",
      ownerEmail: "policy-outcome-owner@example.com",
      businessName: "Policy Outcome Shop",
      appointmentStatus: "Confirmed",
      bookingStatus: "confirmed",
      visitStatus: "not_started",
      paymentStatus: "Pending",
      bookingBuffer: 0,
      penaltySettings: {
        noShowPenalty: true,
        noShowPenaltyAmount: 25,
      },
      policySettings: {
        cancellationWindowMinutes: 180,
        noShowGracePeriodMinutes: 10,
        lateCancelFeeEnabled: true,
        lateCancelFeeAmount: 12,
        depositRequired: false,
        depositAmount: 0,
        blockOnNoShow: true,
        blockScope: "business",
      },
      promotion: noDiscountState(),
      flashSale: noDiscountState(),
    });

    appointment = fixture.appointment;
    token = fixture.token;
    clientToken = createClientToken(fixture.client, fixture.business._id);
  });

  test("rejects no-show before scheduled start plus grace period", async () => {
    const futureAppointment = await setAppointmentRelativeStart(appointment, 60);

    const res = await updateAppointmentStatus(futureAppointment._id, token, {
      status: "No-Show",
    });

    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/grace period/i);

    const stored = await Appointment.findById(appointment._id).lean();
    expect(stored.status).toBe("Confirmed");
    expect(stored.policyOutcome.type).toBe("none");
  });

  test("rejects no-show for checked-in appointments", async () => {
    await setAppointmentRelativeStart(appointment, -60);
    await Appointment.findByIdAndUpdate(appointment._id, {
      visitStatus: "checked_in",
    });

    const res = await updateAppointmentStatus(appointment._id, token, {
      status: "No-Show",
    });

    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/checked-in/i);
  });

  test("allows owner to waive a no-show fee with a reason", async () => {
    await setAppointmentRelativeStart(appointment, -60);

    const res = await updateAppointmentStatus(appointment._id, token, {
      status: "No-Show",
      waiveFee: true,
      waiverReason: "Client emergency confirmed by phone",
      blockClient: true,
    });

    expect(res.status).toBe(200);

    const stored = await Appointment.findById(appointment._id).lean();
    expect(stored.policyOutcome.type).toBe("no_show");
    expect(stored.policyOutcome.waived).toBe(true);
    expect(stored.policyOutcome.feeApplied).toBe(false);
    expect(stored.policyOutcome.blockApplied).toBe(false);
    expect(stored.penalty.applied).toBe(false);
    expect(stored.penalty.waived).toBe(true);

    const client = await Client.findById(fixture.client._id).lean();
    expect(client.appBookingBlocked).toBe(false);
  });

  test("applies no-show fee and block only when frozen policy allows it", async () => {
    await setAppointmentRelativeStart(appointment, -60);

    const res = await updateAppointmentStatus(appointment._id, token, {
      status: "No-Show",
      blockClient: true,
    });

    expect(res.status).toBe(200);

    const stored = await Appointment.findById(appointment._id).lean();
    expect(stored.policyOutcome.type).toBe("no_show");
    expect(stored.policyOutcome.feeApplied).toBe(true);
    expect(stored.policyOutcome.feeAmount).toBe(25);
    expect(stored.policyOutcome.blockApplied).toBe(true);
    expect(stored.penalty.applied).toBe(true);
    expect(stored.penalty.amount).toBe(25);

    const client = await Client.findById(fixture.client._id).lean();
    expect(client.appBookingBlocked).toBe(true);

    const blockEvent = await findPolicyEvent(
      "customer_blocked",
      appointment._id
    );
    expect(blockEvent).not.toBeNull();
  });

  test("marks client cancellation inside frozen window as late-cancel", async () => {
    const lateAppointment = await setAppointmentRelativeStart(appointment, 60);

    const res = await updateAppointmentStatus(lateAppointment._id, clientToken, {
      status: "Canceled",
    });

    expect(res.status).toBe(200);

    const stored = await Appointment.findById(appointment._id).lean();
    expect(stored.status).toBe("Canceled");
    expect(stored.bookingStatus).toBe("cancelled");
    expect(stored.visitStatus).toBe("cancelled");
    expect(stored.policyOutcome.type).toBe("late_cancel");
    expect(stored.policyOutcome.feeApplied).toBe(true);
    expect(stored.policyOutcome.feeAmount).toBe(12);
    expect(stored.penalty.type).toBe("late_cancel");
    expect(stored.penalty.amount).toBe(12);

    const lateCancelEvent = await findPolicyEvent(
      "late_cancel_marked",
      appointment._id
    );
    expect(lateCancelEvent).not.toBeNull();
  });

  test("rejects client waiver on late-cancel", async () => {
    const lateAppointment = await setAppointmentRelativeStart(appointment, 60);

    const res = await updateAppointmentStatus(lateAppointment._id, clientToken, {
      status: "Canceled",
      waiveFee: true,
      waiverReason: "client tried to waive own fee",
    });

    expect(res.status).toBe(403);

    const stored = await Appointment.findById(appointment._id).lean();
    expect(stored.status).toBe("Confirmed");
  });

  test("allows owner waiver on late-cancel only with a reason", async () => {
    const lateAppointment = await setAppointmentRelativeStart(appointment, 60);

    const missingReason = await updateAppointmentStatus(
      lateAppointment._id,
      token,
      {
        status: "Canceled",
        waiveFee: true,
      }
    );

    expect(missingReason.status).toBe(400);

    const res = await updateAppointmentStatus(lateAppointment._id, token, {
      status: "Canceled",
      waiveFee: true,
      waiverReason: "Owner accepted documented emergency",
    });

    expect(res.status).toBe(200);

    const stored = await Appointment.findById(appointment._id).lean();
    expect(stored.policyOutcome.type).toBe("late_cancel");
    expect(stored.policyOutcome.waived).toBe(true);
    expect(stored.policyOutcome.feeApplied).toBe(false);
    expect(stored.penalty.applied).toBe(false);
    expect(stored.penalty.waived).toBe(true);
  });

  test("rejects manual penalty amounts that do not match frozen policy", async () => {
    await Appointment.findByIdAndUpdate(appointment._id, {
      status: "No-Show",
      bookingStatus: "confirmed",
      visitStatus: "no_show",
      policyOutcome: {
        type: "no_show",
        feeApplied: false,
        feeAmount: 0,
      },
      penalty: {
        applied: false,
        amount: 0,
      },
    });

    const res = await applyPenalty(appointment._id, token, {
      type: "money",
      amount: 60,
    });

    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/frozen appointment policy/i);
  });
});
