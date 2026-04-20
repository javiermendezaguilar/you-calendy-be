const request = require("supertest");
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
    await request(app)
      .post("/business/walk-ins")
      .set("Authorization", `Bearer ${token}`)
      .send({
        clientId: client._id,
        serviceId: service._id,
        staffId: staff._id,
        date: "2026-05-14",
        startTime: "10:00",
      });

    await createWaitlistEntry({
      clientId: client._id,
      serviceId: service._id,
      staffId: staff._id,
      date: "2026-05-14",
      timeWindowStart: "10:30",
      timeWindowEnd: "12:00",
      notes: "Fits after queue",
    });

    await createWaitlistEntry({
      clientId: client._id,
      serviceId: service._id,
      staffId: staff._id,
      date: "2026-05-14",
      timeWindowStart: "08:00",
      timeWindowEnd: "09:30",
      notes: "Too early",
    });

    const res = await request(app)
      .get("/business/waitlist/fill-gaps")
      .set("Authorization", `Bearer ${token}`)
      .query({
        serviceId: service._id.toString(),
        staffId: staff._id.toString(),
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
});
