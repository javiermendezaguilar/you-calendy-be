const request = require("supertest");
const app = require("../app");
const Appointment = require("../models/appointment");
const DomainEvent = require("../models/domainEvent");
const Service = require("../models/service");
const Staff = require("../models/staff");
const {
  createOperationalCommerceFixture,
  assignPrimaryServiceToStaff,
} = require("./helpers/commerceFixture");
const { setupCommerceTestSuite } = require("./helpers/commerceTestSuite");

setupCommerceTestSuite();

describe("Walk-ins queue v2", () => {
  let business;
  let client;
  let service;
  let secondService;
  let staff;
  let secondStaff;
  let token;

  beforeEach(async () => {
    const fixture = await createOperationalCommerceFixture({
      ownerName: "Queue Owner",
      ownerEmail: "queue-owner@example.com",
      businessName: "Queue Shop",
    }, {
      staffTimeInterval: 30,
    });

    business = fixture.business;
    client = fixture.client;
    service = fixture.service;
    staff = fixture.staff;
    token = fixture.token;

    secondService = await Service.create({
      business: business._id,
      name: "Beard Sculpt",
      price: 30,
      currency: "EUR",
      duration: 45,
    });
    secondStaff = await Staff.create({
      business: business._id,
      firstName: "Sam",
      lastName: "Clipper",
    });

    await assignPrimaryServiceToStaff(staff, service, 30);
    secondStaff.services = [{ service: secondService._id, timeInterval: 45 }];
    await secondStaff.save();

    await Appointment.deleteMany({});
  });

  const createWalkIn = (payload = {}) =>
    request(app)
      .post("/business/walk-ins")
      .set("Authorization", `Bearer ${token}`)
      .send({
        clientId: client._id,
        serviceId: service._id,
        staffId: staff._id,
        date: "2026-05-12",
        startTime: "10:00",
        ...payload,
      });

  test("persists queue metadata when creating walk-ins", async () => {
    const firstRes = await createWalkIn();

    expect(firstRes.status).toBe(201);
    expect(firstRes.body.data.queuePosition).toBe(1);
    expect(firstRes.body.data.estimatedWaitMinutes).toBe(0);
    expect(firstRes.body.data.queueStatus).toBe("waiting");
    expect(firstRes.body.data.queueEnteredAt).toBeTruthy();

    const secondRes = await createWalkIn({ startTime: "10:30" });

    expect(secondRes.status).toBe(201);
    expect(secondRes.body.data.queuePosition).toBe(2);
    expect(secondRes.body.data.estimatedWaitMinutes).toBe(30);
    expect(secondRes.body.data.queueStatus).toBe("waiting");
  });

  test("returns an ordered live queue with per-staff wait estimates", async () => {
    await createWalkIn();
    await createWalkIn({
        serviceId: secondService._id,
        staffId: secondStaff._id,
    });
    await createWalkIn({ startTime: "10:30" });

    const queueRes = await request(app)
      .get("/business/walk-ins/queue")
      .set("Authorization", `Bearer ${token}`);

    expect(queueRes.status).toBe(200);
    expect(queueRes.body.data).toHaveLength(3);
    expect(queueRes.body.data.map((item) => item.queuePosition)).toEqual([1, 2, 3]);
    expect(queueRes.body.data.map((item) => item.estimatedWaitMinutes)).toEqual([0, 0, 30]);
  });

  test("recalculates queue after an earlier walk-in is completed", async () => {
    const firstRes = await createWalkIn();
    await createWalkIn({ startTime: "10:30" });

    await Appointment.findByIdAndUpdate(firstRes.body.data._id, {
      status: "Completed",
      visitStatus: "completed",
    });

    const queueRes = await request(app)
      .get("/business/walk-ins/queue")
      .set("Authorization", `Bearer ${token}`);

    expect(queueRes.status).toBe(200);
    expect(queueRes.body.data).toHaveLength(1);
    expect(queueRes.body.data[0].queuePosition).toBe(1);
    expect(queueRes.body.data[0].estimatedWaitMinutes).toBe(0);

    const stored = await Appointment.findById(queueRes.body.data[0]._id).lean();
    expect(stored.queuePosition).toBe(1);
    expect(stored.estimatedWaitMinutes).toBe(0);
  });

  test("removes a walk-in from the live queue when service starts", async () => {
    const firstRes = await createWalkIn();
    const secondRes = await createWalkIn({ startTime: "10:30" });

    const startRes = await request(app)
      .post(`/appointments/${firstRes.body.data._id}/start-service`)
      .set("Authorization", `Bearer ${token}`);

    expect(startRes.status).toBe(200);
    expect(startRes.body.data.visitStatus).toBe("in_service");
    expect(startRes.body.data.queueStatus).toBe("in_service");
    expect(startRes.body.data.queueLeftAt).toBeTruthy();

    const queueRes = await request(app)
      .get("/business/walk-ins/queue")
      .set("Authorization", `Bearer ${token}`);

    expect(queueRes.status).toBe(200);
    expect(queueRes.body.data).toHaveLength(1);
    expect(queueRes.body.data[0]._id).toBe(secondRes.body.data._id);
    expect(queueRes.body.data[0].queuePosition).toBe(1);
    expect(queueRes.body.data[0].estimatedWaitMinutes).toBe(0);

    const event = await DomainEvent.findOne({
      type: "walkin_converted",
      correlationId: firstRes.body.data._id.toString(),
    }).lean();
    expect(event).not.toBeNull();
  });

  test("marks abandoned walk-ins as lost without no-show side effects", async () => {
    const firstRes = await createWalkIn();
    const secondRes = await createWalkIn({ startTime: "10:30" });

    const abandonRes = await request(app)
      .post(`/business/walk-ins/${firstRes.body.data._id}/abandon`)
      .set("Authorization", `Bearer ${token}`)
      .send({
        reason: "left_without_service",
        note: "Wait was too long",
      });

    expect(abandonRes.status).toBe(200);
    expect(abandonRes.body.data.status).toBe("Canceled");
    expect(abandonRes.body.data.visitStatus).toBe("cancelled");
    expect(abandonRes.body.data.queueStatus).toBe("abandoned");
    expect(abandonRes.body.data.queueOutcomeReason).toBe("left_without_service");
    expect(abandonRes.body.data.queueOutcomeNote).toBe("Wait was too long");

    const queueRes = await request(app)
      .get("/business/walk-ins/queue")
      .set("Authorization", `Bearer ${token}`);

    expect(queueRes.status).toBe(200);
    expect(queueRes.body.data).toHaveLength(1);
    expect(queueRes.body.data[0]._id).toBe(secondRes.body.data._id);
    expect(queueRes.body.data[0].queuePosition).toBe(1);
    expect(queueRes.body.data[0].estimatedWaitMinutes).toBe(0);

    const lostEvent = await DomainEvent.findOne({
      type: "walkin_lost",
      correlationId: firstRes.body.data._id.toString(),
    }).lean();
    const noShowEvent = await DomainEvent.findOne({
      type: "no_show_marked",
      correlationId: firstRes.body.data._id.toString(),
    }).lean();
    expect(lostEvent).not.toBeNull();
    expect(noShowEvent).toBeNull();

    const replacementRes = await createWalkIn({ startTime: "10:00" });
    expect(replacementRes.status).toBe(201);
  });

  test("rejects abandoning a walk-in that is already in service", async () => {
    const walkInRes = await createWalkIn();

    await request(app)
      .post(`/appointments/${walkInRes.body.data._id}/start-service`)
      .set("Authorization", `Bearer ${token}`);

    const abandonRes = await request(app)
      .post(`/business/walk-ins/${walkInRes.body.data._id}/abandon`)
      .set("Authorization", `Bearer ${token}`);

    expect(abandonRes.status).toBe(409);
    expect(abandonRes.body.message).toMatch(/already started service/i);
  });

  test("rejects marking a walk-in as no-show or missed", async () => {
    const walkInRes = await createWalkIn();

    const noShowRes = await request(app)
      .put(`/appointments/${walkInRes.body.data._id}/status`)
      .set("Authorization", `Bearer ${token}`)
      .send({ status: "No-Show" });

    expect(noShowRes.status).toBe(409);
    expect(noShowRes.body.message).toMatch(/walk-ins must be abandoned/i);
  });
});
