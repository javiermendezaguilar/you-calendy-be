const request = require("supertest");
const moment = require("moment");
const app = require("../app");
const Appointment = require("../models/appointment");
const Checkout = require("../models/checkout");
const Client = require("../models/client");
const Payment = require("../models/payment");
const {
  assignPrimaryServiceToStaff,
  createCommerceFixture,
  createOperationalCommerceFixture,
} = require("./helpers/commerceFixture");
const { setupCommerceTestSuite } = require("./helpers/commerceTestSuite");

jest.setTimeout(30000);

setupCommerceTestSuite();

const expectOneAcceptedAndOneConflict = (responses) => {
  const statuses = responses.map((res) => res.status).sort((a, b) => a - b);
  expect(statuses).toEqual([201, 409]);
};

const countAppointmentsInSlot = ({
  business,
  staff,
  date,
  startTime,
  endTime,
  extra = {},
}) => {
  const dayStart = moment(date, "YYYY-MM-DD").startOf("day").toDate();
  const dayEnd = moment(date, "YYYY-MM-DD").endOf("day").toDate();
  return Appointment.countDocuments({
    business,
    staff,
    date: { $gte: dayStart, $lte: dayEnd },
    status: { $nin: ["Canceled", "No-Show"] },
    startTime: { $lt: endTime },
    endTime: { $gt: startTime },
    ...extra,
  });
};

describe("Appointment capacity concurrency v1", () => {
  test("allows only one concurrent barber booking for the same staff slot", async () => {
    const fixture = await createOperationalCommerceFixture(
      {
        ownerName: "Capacity Booking Owner",
        ownerEmail: "capacity-booking-owner@example.com",
        businessName: "Capacity Booking Shop",
      },
      {
        staffTimeInterval: 45,
        syncBusinessServices: true,
      }
    );

    const sendBooking = () =>
      request(app)
        .post("/appointments/barber")
        .set("Authorization", `Bearer ${fixture.token}`)
        .send({
          clientId: fixture.client._id,
          serviceId: fixture.service._id,
          staffId: fixture.staff._id,
          date: "2026-06-01",
          startTime: "13:00",
          price: 35,
        });

    const responses = await Promise.all([sendBooking(), sendBooking()]);

    expectOneAcceptedAndOneConflict(responses);
    await expect(
      countAppointmentsInSlot({
        business: fixture.business._id,
        staff: fixture.staff._id,
        date: "2026-06-01",
        startTime: "13:00",
        endTime: "13:45",
      })
    ).resolves.toBe(1);
  });

  test("allows only one concurrent walk-in for the same staff slot", async () => {
    const fixture = await createOperationalCommerceFixture(
      {
        ownerName: "Capacity Walkin Owner",
        ownerEmail: "capacity-walkin-owner@example.com",
        businessName: "Capacity Walkin Shop",
      },
      {
        staffTimeInterval: 30,
      }
    );

    const sendWalkIn = () =>
      request(app)
        .post("/business/walk-ins")
        .set("Authorization", `Bearer ${fixture.token}`)
        .send({
          clientId: fixture.client._id,
          serviceId: fixture.service._id,
          staffId: fixture.staff._id,
          date: "2026-06-02",
          startTime: "14:00",
        });

    const responses = await Promise.all([sendWalkIn(), sendWalkIn()]);

    expectOneAcceptedAndOneConflict(responses);
    await expect(
      countAppointmentsInSlot({
        business: fixture.business._id,
        staff: fixture.staff._id,
        date: "2026-06-02",
        startTime: "14:00",
        endTime: "14:30",
        extra: { visitType: "walk_in" },
      })
    ).resolves.toBe(1);
  });

  test("allows only one concurrent rebooking for the same staff slot", async () => {
    const fixture = await createCommerceFixture({
      ownerName: "Capacity Rebooking Owner",
      ownerEmail: "capacity-rebooking-owner@example.com",
      businessName: "Capacity Rebooking Shop",
      appointmentStatus: "Completed",
      bookingStatus: "confirmed",
      visitStatus: "completed",
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
    await assignPrimaryServiceToStaff(fixture.staff, fixture.service, 45);

    const secondClient = await Client.create({
      business: fixture.business._id,
      firstName: "Second",
      lastName: "Client",
      phone: "+34666666667",
    });

    const secondSourceAppointment = await Appointment.create({
      client: secondClient._id,
      business: fixture.business._id,
      service: fixture.service._id,
      staff: fixture.staff._id,
      date: moment("2026-04-19", "YYYY-MM-DD").startOf("day").toDate(),
      startTime: "10:00",
      endTime: "10:45",
      duration: 45,
      status: "Completed",
      bookingStatus: "confirmed",
      visitStatus: "completed",
      visitType: "appointment",
      paymentStatus: "Paid",
      price: 35,
      policySnapshot: Appointment.buildPolicySnapshot(fixture.business),
    });

    const createPaidCheckout = async (sourceAppointment, client, reference) => {
      const checkout = await Checkout.create({
        appointment: sourceAppointment._id,
        business: fixture.business._id,
        client: client._id,
        staff: fixture.staff._id,
        status: "paid",
        currency: "EUR",
        subtotal: 35,
        discountTotal: 0,
        tip: 0,
        total: 35,
        sourcePrice: 35,
        snapshot: {
          appointmentStatus: "Completed",
          bookingStatus: "confirmed",
          visitStatus: "completed",
          service: {
            id: fixture.service._id,
            name: fixture.service.name,
          },
          client: {
            id: client._id,
            firstName: client.firstName,
            lastName: client.lastName,
            phone: client.phone,
          },
          staff: {
            id: fixture.staff._id,
            firstName: fixture.staff.firstName,
            lastName: fixture.staff.lastName,
          },
          discounts: {
            promotion: { applied: false, id: null, amount: 0 },
            flashSale: { applied: false, id: null, amount: 0 },
          },
        },
        closedAt: new Date(),
        closedBy: fixture.owner._id,
      });

      await Payment.create({
        checkout: checkout._id,
        appointment: sourceAppointment._id,
        business: fixture.business._id,
        client: client._id,
        staff: fixture.staff._id,
        status: "captured",
        method: "cash",
        currency: "EUR",
        amount: 35,
        reference,
        capturedAt: new Date(),
        capturedBy: fixture.owner._id,
        snapshot: {
          subtotal: 35,
          discountTotal: 0,
          total: 35,
          sourcePrice: 35,
          service: {
            id: fixture.service._id,
            name: fixture.service.name,
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

      return checkout;
    };

    const firstCheckout = await createPaidCheckout(
      fixture.appointment,
      fixture.client,
      "capacity-rebooking-one"
    );
    const secondCheckout = await createPaidCheckout(
      secondSourceAppointment,
      secondClient,
      "capacity-rebooking-two"
    );

    const sendRebooking = (checkout) =>
      request(app)
        .post(`/checkout/${checkout._id}/rebook`)
        .set("Authorization", `Bearer ${fixture.token}`)
        .send({
          date: "2026-06-03",
          startTime: "15:00",
        });

    const responses = await Promise.all([
      sendRebooking(firstCheckout),
      sendRebooking(secondCheckout),
    ]);

    expectOneAcceptedAndOneConflict(responses);
    await expect(
      countAppointmentsInSlot({
        business: fixture.business._id,
        staff: fixture.staff._id,
        date: "2026-06-03",
        startTime: "15:00",
        endTime: "15:45",
      })
    ).resolves.toBe(1);
  });
});
