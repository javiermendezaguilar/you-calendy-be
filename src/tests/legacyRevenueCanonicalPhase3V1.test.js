const request = require("supertest");
const app = require("../app");
const Promotion = require("../models/promotion");
const FlashSale = require("../models/flashSale");
const BarberLink = require("../models/barberLink");
const Appointment = require("../models/appointment");
const { setupCommerceTestSuite } = require("./helpers/commerceTestSuite");
const { createCommerceFixture } = require("./helpers/commerceFixture");
const {
  seedCanonicalRevenueScenario,
} = require("./helpers/revenueProjectionFixture");

setupCommerceTestSuite();

describe("Legacy revenue canonical phase 3", () => {
  let fixture;

  const getSortedAppointmentIds = async () => {
    const appointments = await Appointment.find({ business: fixture.business._id })
      .sort({ date: 1, startTime: 1 })
      .select("_id");

    return appointments.map((appointment) => appointment._id);
  };

  const markAppointmentsForCampaign = async ({
    field,
    idField,
    ids,
    entityId,
    discountAmount,
    discountPercentage,
  }) => {
    await Appointment.updateMany(
      { _id: { $in: ids } },
      {
        $set: {
          [`${field}.applied`]: true,
          [`${field}.${idField}`]: entityId,
          [`${field}.originalPrice`]: 999,
          [`${field}.discountAmount`]: discountAmount,
          [`${field}.discountPercentage`]: discountPercentage,
        },
      }
    );
  };

  const expectStatsResponse = (res, expectedRevenue) => {
    expect(res.status).toBe(200);
    expect(res.body.data.totalBookings).toBe(2);
    expect(res.body.data.totalRevenue).toBe(expectedRevenue);
  };

  beforeEach(async () => {
    fixture = await createCommerceFixture({
      appointmentStatus: "Completed",
      bookingStatus: "confirmed",
      visitStatus: "completed",
      paymentStatus: "Pending",
    });

    await seedCanonicalRevenueScenario(fixture, {
      includeCanceled: true,
      includeNoShow: true,
    });
  });

  test("uses canonical payment revenue in public barber profile stats", async () => {
    await BarberLink.create({
      business: fixture.business._id,
      linkToken: "barber-link-canonical-phase3",
      isActive: true,
      createdBy: fixture.owner._id,
    });

    const res = await request(app).get(
      "/barber/profile/barber-link-canonical-phase3"
    );

    expect(res.status).toBe(200);
    expect(res.body.data.semanticScope).toEqual({
      entity: "owner_business_legacy",
      revenue: "business",
      activity: "business",
    });
    expect(res.body.data.stats.totalRevenue).toBe(80);
    expect(res.body.data.stats.totalAppointments).toBe(6);
    expect(res.body.data.stats.completedAppointments).toBe(4);
  });

  test("uses canonical payment revenue in promotion stats", async () => {
    const promotion = await Promotion.create({
      business: fixture.business._id,
      name: "Promo Canonica",
      dayOfWeek: "saturday",
      startTime: "09:00",
      endTime: "18:00",
      discountPercentage: 20,
      services: [fixture.service._id],
      isActive: true,
    });

    const appointmentIds = await getSortedAppointmentIds();
    await markAppointmentsForCampaign({
      field: "promotion",
      idField: "promotionId",
      ids: [appointmentIds[0], appointmentIds[1]],
      entityId: promotion._id,
      discountAmount: 10,
      discountPercentage: 20,
    });

    const res = await request(app)
      .get("/promotions/stats")
      .set("Authorization", `Bearer ${fixture.token}`);

    expectStatsResponse(res, 80);
  });

  test("uses canonical payment revenue in flash sale stats", async () => {
    const flashSale = await FlashSale.create({
      business: fixture.business._id,
      name: "Flash Canonica",
      startDate: new Date("2026-04-19T00:00:00.000Z"),
      endDate: new Date("2026-04-20T23:59:59.999Z"),
      discountPercentage: 15,
      isActive: true,
    });

    const appointmentIds = await getSortedAppointmentIds();
    await markAppointmentsForCampaign({
      field: "flashSale",
      idField: "flashSaleId",
      ids: [appointmentIds[0], appointmentIds[2]],
      entityId: flashSale._id,
      discountAmount: 5,
      discountPercentage: 15,
    });

    const res = await request(app)
      .get("/flash-sales/stats")
      .set("Authorization", `Bearer ${fixture.token}`);

    expectStatsResponse(res, 40);
  });
});
