const request = require("supertest");
const moment = require("moment");
const app = require("../app");
const Appointment = require("../models/appointment");
const Staff = require("../models/staff");
const {
  createOperationalCommerceFixture,
} = require("./helpers/commerceFixture");
const { setupCommerceTestSuite } = require("./helpers/commerceTestSuite");

setupCommerceTestSuite();

const mondayDate = "2026-06-01";

const setBusinessHours = async (business, shifts, enabled = true) => {
  business.businessHours = {
    ...(business.businessHours?.toObject?.() || business.businessHours || {}),
    monday: {
      enabled,
      shifts,
    },
  };
  await business.save();
};

const setStaffHours = async (staff, shifts, enabled = true) => {
  staff.availableForBooking = true;
  staff.workingHours = [
    {
      day: "monday",
      enabled,
      shifts,
    },
  ];
  await staff.save();
};

const getAvailability = ({ business, service, staff = null }) => {
  const query = {
    businessId: business._id.toString(),
    serviceId: service._id.toString(),
    date: mondayDate,
  };

  if (staff) {
    query.staffId = staff._id.toString();
  }

  return request(app).get("/appointments/available").query(query);
};

const expectAvailableSlots = (res) => {
  expect(res.status).toBe(200);
  return res.body.data.availableSlots;
};

describe("Availability engine v1", () => {
  test("intersects staff availability with business hours", async () => {
    const fixture = await createOperationalCommerceFixture(
      {
        ownerName: "Availability Owner",
        ownerEmail: "availability-owner@example.com",
        businessName: "Availability Shop",
      },
      { staffTimeInterval: 30 }
    );

    await setBusinessHours(fixture.business, [
      { start: "10:00", end: "12:00" },
    ]);
    await setStaffHours(fixture.staff, [
      { start: "09:00", end: "12:00", breaks: [] },
    ]);

    const res = await getAvailability({
      business: fixture.business,
      service: fixture.service,
      staff: fixture.staff,
    });

    const availableSlots = expectAvailableSlots(res);
    expect(availableSlots).not.toContain("09:00");
    expect(availableSlots).toEqual([
      "10:00",
      "10:30",
      "11:00",
      "11:30",
    ]);
  });

  test("removes slots whose full service duration overlaps a staff break", async () => {
    const fixture = await createOperationalCommerceFixture(
      {
        ownerName: "Availability Break Owner",
        ownerEmail: "availability-break-owner@example.com",
        businessName: "Availability Break Shop",
      },
      { staffTimeInterval: 45 }
    );

    await setBusinessHours(fixture.business, [
      { start: "09:00", end: "12:00" },
    ]);
    await setStaffHours(fixture.staff, [
      {
        start: "09:00",
        end: "12:00",
        breaks: [{ start: "10:00", end: "10:30" }],
      },
    ]);

    const res = await getAvailability({
      business: fixture.business,
      service: fixture.service,
      staff: fixture.staff,
    });

    const availableSlots = expectAvailableSlots(res);
    expect(availableSlots).toContain("09:00");
    expect(availableSlots).not.toContain("09:45");
    expect(availableSlots).toContain("10:30");
  });

  test("without staffId keeps a business slot when another eligible staff member is free", async () => {
    const fixture = await createOperationalCommerceFixture(
      {
        ownerName: "Availability Multi Owner",
        ownerEmail: "availability-multi-owner@example.com",
        businessName: "Availability Multi Shop",
      },
      { staffTimeInterval: 30 }
    );

    await setBusinessHours(fixture.business, [
      { start: "09:00", end: "10:00" },
    ]);
    await setStaffHours(fixture.staff, [
      { start: "09:00", end: "10:00", breaks: [] },
    ]);

    const secondStaff = await Staff.create({
      business: fixture.business._id,
      firstName: "Second",
      lastName: "Barber",
      email: "second.availability@example.com",
      availableForBooking: true,
      services: [{ service: fixture.service._id, timeInterval: 30 }],
      workingHours: [
        {
          day: "monday",
          enabled: true,
          shifts: [{ start: "09:00", end: "10:00", breaks: [] }],
        },
      ],
    });

    await Appointment.create({
      client: fixture.client._id,
      business: fixture.business._id,
      service: fixture.service._id,
      staff: fixture.staff._id,
      date: moment(mondayDate, "YYYY-MM-DD").startOf("day").toDate(),
      startTime: "09:00",
      endTime: "09:30",
      duration: 30,
      status: "Confirmed",
      bookingStatus: "confirmed",
      visitStatus: "not_started",
      visitType: "appointment",
      paymentStatus: "Pending",
      price: 30,
      policySnapshot: Appointment.buildPolicySnapshot(fixture.business),
    });

    const res = await getAvailability({
      business: fixture.business,
      service: fixture.service,
    });

    const availableSlots = expectAvailableSlots(res);
    expect(availableSlots).toContain("09:00");

    const firstStaffAvailability = res.body.data.availabilityByStaff.find(
      (entry) => entry.staff._id === fixture.staff._id.toString()
    );
    const secondStaffAvailability = res.body.data.availabilityByStaff.find(
      (entry) => entry.staff._id === secondStaff._id.toString()
    );

    expect(firstStaffAvailability.availableSlots).not.toContain("09:00");
    expect(secondStaffAvailability.availableSlots).toContain("09:00");
  });
});
