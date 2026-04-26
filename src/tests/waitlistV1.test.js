const request = require("supertest");
const moment = require("moment");
const app = require("../app");
const Appointment = require("../models/appointment");
const Client = require("../models/client");
const WaitlistEntry = require("../models/waitlistEntry");
const {
  createOperationalCommerceFixture,
} = require("./helpers/commerceFixture");
const { setupCommerceTestSuite } = require("./helpers/commerceTestSuite");

setupCommerceTestSuite();

describe("Waitlist v1", () => {
  let business;
  let client;
  let service;
  let staff;
  let token;

  beforeEach(async () => {
    const fixture = await createOperationalCommerceFixture({
      ownerName: "Waitlist Owner",
      ownerEmail: "waitlist-owner@example.com",
      businessName: "Waitlist Shop",
    }, {
      staffTimeInterval: 45,
    });

    business = fixture.business;
    client = fixture.client;
    service = fixture.service;
    staff = fixture.staff;
    token = fixture.token;
    await Appointment.deleteMany({});
    await WaitlistEntry.deleteMany({});
  });

  const createWaitlistEntry = (payload) =>
    request(app)
      .post("/business/waitlist")
      .set("Authorization", `Bearer ${token}`)
      .send(payload);

  const createStaffWaitlistEntry = ({
    date,
    timeWindowStart,
    timeWindowEnd,
    notes,
  }) =>
    createWaitlistEntry({
      clientId: client._id,
      serviceId: service._id,
      staffId: staff._id,
      date,
      timeWindowStart,
      timeWindowEnd,
      notes,
    });

  const createWalkIn = ({ date, startTime }) =>
    request(app)
      .post("/business/walk-ins")
      .set("Authorization", `Bearer ${token}`)
      .send({
        clientId: client._id,
        serviceId: service._id,
        staffId: staff._id,
        date,
        startTime,
      });

  const getFillGapCandidates = ({ date, fromTime }) =>
    request(app)
      .get("/business/waitlist/fill-gaps")
      .set("Authorization", `Bearer ${token}`)
      .query({
        serviceId: service._id.toString(),
        staffId: staff._id.toString(),
        date,
        fromTime,
      });

  const setAvailabilityWindow = async (
    date,
    {
      businessShifts,
      staffShifts,
    }
  ) => {
    const day = moment(date, "YYYY-MM-DD").format("dddd").toLowerCase();
    business.businessHours = {
      ...(business.businessHours?.toObject?.() || business.businessHours || {}),
      [day]: {
        enabled: true,
        shifts: businessShifts,
      },
    };
    business.bookingBuffer = 0;
    await business.save();

    staff.workingHours = [
      {
        day,
        enabled: true,
        shifts: staffShifts,
      },
    ];
    staff.bookingBuffer = 0;
    await staff.save();
  };

  const createBookedAppointment = ({
    date,
    startTime,
    endTime,
    duration = 45,
  }) =>
    Appointment.create({
      client: client._id,
      business: business._id,
      service: service._id,
      staff: staff._id,
      date: moment(date, "YYYY-MM-DD").toDate(),
      startTime,
      endTime,
      duration,
      status: "Confirmed",
      bookingStatus: "confirmed",
      visitStatus: "not_started",
      visitType: "appointment",
      paymentStatus: "Pending",
      price: service.price,
      policySnapshot: Appointment.buildPolicySnapshot(business),
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

  test("creates and lists a waitlist entry for an existing client", async () => {
    const createRes = await createWaitlistEntry({
      clientId: client._id,
      serviceId: service._id,
      staffId: staff._id,
      date: "2026-05-06",
      timeWindowStart: "10:00",
      timeWindowEnd: "12:00",
      notes: "Can come before lunch",
    });

    expect(createRes.status).toBe(201);
    expect(createRes.body.data.client._id).toBe(client._id.toString());
    expect(createRes.body.data.status).toBe("active");

    const listRes = await request(app)
      .get("/business/waitlist")
      .set("Authorization", `Bearer ${token}`)
      .query({ date: "2026-05-06" });

    expect(listRes.status).toBe(200);
    expect(listRes.body.data).toHaveLength(1);
    expect(listRes.body.data[0].notes).toBe("Can come before lunch");
  });

  test("creates or reuses an unregistered client by phone when clientId is omitted", async () => {
    const createRes = await createWaitlistEntry({
      firstName: "Phone",
      lastName: "Lead",
      phone: "+34922222222",
      serviceId: service._id,
      staffId: staff._id,
      date: "2026-05-06",
      timeWindowStart: "15:00",
      timeWindowEnd: "17:00",
    });

    expect(createRes.status).toBe(201);
    expect(createRes.body.data.client.registrationStatus).toBe("unregistered");

    const storedClient = await Client.findOne({
      business: business._id,
      phone: "34922222222",
    }).lean();

    expect(storedClient).not.toBeNull();
    expect(storedClient.registrationStatus).toBe("unregistered");
  });

  test("finds compatible waitlist entries for a free gap", async () => {
    await createWaitlistEntry({
      clientId: client._id,
      serviceId: service._id,
      staffId: staff._id,
      date: "2026-05-06",
      timeWindowStart: "09:00",
      timeWindowEnd: "11:30",
    });

    await createWaitlistEntry({
      clientId: client._id,
      serviceId: service._id,
      staffId: staff._id,
      date: "2026-05-06",
      timeWindowStart: "13:00",
      timeWindowEnd: "15:00",
    });

    const matchRes = await request(app)
      .post("/business/waitlist/find-match")
      .set("Authorization", `Bearer ${token}`)
      .send({
        serviceId: service._id,
        staffId: staff._id,
        date: "2026-05-06",
        startTime: "10:00",
        endTime: "10:45",
      });

    expect(matchRes.status).toBe(200);
    expect(matchRes.body.data).toHaveLength(1);
    expect(matchRes.body.data[0].timeWindowStart).toBe("09:00");
    expect(matchRes.body.data[0].timeWindowEnd).toBe("11:30");
  });

  test("returns fill-gap candidates based on the live queue", async () => {
    await setAvailabilityWindow("2026-05-14", {
      businessShifts: [{ start: "10:00", end: "12:00" }],
      staffShifts: [{ start: "10:00", end: "12:00", breaks: [] }],
    });

    await createWalkIn({
      date: "2026-05-14",
      startTime: "10:00",
    });

    await createStaffWaitlistEntry({
      date: "2026-05-14",
      timeWindowStart: "10:30",
      timeWindowEnd: "12:00",
      notes: "Fits after queue",
    });

    await createStaffWaitlistEntry({
      date: "2026-05-14",
      timeWindowStart: "08:00",
      timeWindowEnd: "09:30",
      notes: "Too early",
    });

    const res = await getFillGapCandidates({
      date: "2026-05-14",
      fromTime: "10:00",
    });

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].estimatedWaitMinutes).toBe(45);
    expect(res.body.data[0].slotStart).toBe("10:45");
    expect(res.body.data[0].slotEnd).toBe("11:30");
    expect(res.body.data[0].compatibleEntries).toHaveLength(1);
    expect(res.body.data[0].compatibleEntries[0].notes).toBe("Fits after queue");
  });

  test("does not return fill-gap candidates for sold slots, closed hours or breaks", async () => {
    await setAvailabilityWindow("2026-05-15", {
      businessShifts: [{ start: "10:00", end: "12:00" }],
      staffShifts: [
        {
          start: "09:00",
          end: "13:00",
          breaks: [{ start: "10:45", end: "11:30" }],
        },
      ],
    });

    await createBookedAppointment({
      date: "2026-05-15",
      startTime: "10:00",
      endTime: "10:45",
    });

    await createStaffWaitlistEntry({
      date: "2026-05-15",
      timeWindowStart: "09:00",
      timeWindowEnd: "09:45",
      notes: "Before business opens",
    });

    await createStaffWaitlistEntry({
      date: "2026-05-15",
      timeWindowStart: "10:00",
      timeWindowEnd: "10:45",
      notes: "Already sold",
    });

    await createStaffWaitlistEntry({
      date: "2026-05-15",
      timeWindowStart: "10:45",
      timeWindowEnd: "11:30",
      notes: "During break",
    });

    await createStaffWaitlistEntry({
      date: "2026-05-15",
      timeWindowStart: "11:30",
      timeWindowEnd: "12:15",
      notes: "Past business close",
    });

    const res = await getFillGapCandidates({
      date: "2026-05-15",
      fromTime: "09:00",
    });

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(0);
  });

  test("does not count abandoned walk-ins as queue wait for fill-gap candidates", async () => {
    await setAvailabilityWindow("2026-05-21", {
      businessShifts: [{ start: "10:00", end: "12:00" }],
      staffShifts: [{ start: "10:00", end: "12:00", breaks: [] }],
    });

    const walkInRes = await createWalkIn({
      date: "2026-05-21",
      startTime: "10:00",
    });
    expect(walkInRes.status).toBe(201);

    const abandonRes = await request(app)
      .post(`/business/walk-ins/${walkInRes.body.data._id}/abandon`)
      .set("Authorization", `Bearer ${token}`)
      .send({ reason: "left_without_service" });
    expect(abandonRes.status).toBe(200);

    await createStaffWaitlistEntry({
      date: "2026-05-21",
      timeWindowStart: "10:00",
      timeWindowEnd: "10:45",
      notes: "Can fill immediately",
    });

    const res = await getFillGapCandidates({
      date: "2026-05-21",
      fromTime: "10:00",
    });

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].estimatedWaitMinutes).toBe(0);
    expect(res.body.data[0].slotStart).toBe("10:00");
    expect(res.body.data[0].compatibleEntries[0].notes).toBe(
      "Can fill immediately"
    );
  });
});
