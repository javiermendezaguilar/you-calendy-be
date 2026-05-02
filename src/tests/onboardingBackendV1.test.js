const request = require("supertest");
const app = require("../app");
const BarberLink = require("../models/barberLink");
const Business = require("../models/User/business");
const { setupCommerceTestSuite } = require("./helpers/commerceTestSuite");
const {
  assignPrimaryServiceToStaff,
  createCommerceFixture,
} = require("./helpers/commerceFixture");

setupCommerceTestSuite();

describe("Onboarding backend v1", () => {
  let fixture;

  const createPublicLink = async (token = "onboarding-public-link") => {
    await BarberLink.deleteMany({});
    return BarberLink.create({
      business: fixture.business._id,
      linkToken: token,
      isActive: true,
      createdBy: fixture.owner._id,
    });
  };

  const makeBusinessHoursReady = async () => {
    fixture.business.businessHours.monday = {
      enabled: true,
      shifts: [{ start: "09:00", end: "17:00" }],
    };
    await fixture.business.save();
  };

  const makeStaffReady = async () => {
    fixture.staff.availableForBooking = true;
    fixture.staff.showInCalendar = true;
    fixture.staff.workingHours = [
      {
        day: "monday",
        enabled: true,
        shifts: [{ start: "09:00", end: "17:00", breaks: [] }],
      },
    ];
    await assignPrimaryServiceToStaff(fixture.staff, fixture.service, 45);
  };

  beforeEach(async () => {
    fixture = await createCommerceFixture({
      businessName: "Onboarding Shop",
      duration: 45,
    });
    fixture.business.contactInfo.email = "onboarding-shop@example.com";
    fixture.business.address = {
      streetName: "Main Street",
      houseNumber: "10",
      city: "Madrid",
      postalCode: "28001",
    };
    fixture.business.location = {
      type: "Point",
      coordinates: [-3.7038, 40.4168],
      address: "Main Street 10, Madrid",
    };
    await fixture.business.save();
    await BarberLink.deleteMany({});
  });

  test("requires authentication", async () => {
    const res = await request(app).get("/business/onboarding-status");

    expect(res.status).toBe(401);
  });

  test("returns 404 when owner has no business", async () => {
    await Business.deleteMany({ _id: fixture.business._id });

    const res = await request(app)
      .get("/business/onboarding-status")
      .set("Authorization", `Bearer ${fixture.token}`);

    expect(res.status).toBe(404);
  });

  test("shows operational blockers before the business is ready", async () => {
    const res = await request(app)
      .get("/business/onboarding-status")
      .set("Authorization", `Bearer ${fixture.token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.readyForBooking).toBe(false);
    expect(res.body.data.nextAction).toBe("set_business_hours");
    expect(res.body.data.sections.businessProfile.complete).toBe(true);
    expect(res.body.data.sections.businessHours.complete).toBe(false);
    expect(res.body.data.sections.services.complete).toBe(true);
    expect(res.body.data.sections.staff.complete).toBe(false);
    expect(res.body.data.sections.publicProfile.complete).toBe(false);
    expect(res.body.data.sections.staff.missing).toEqual(
      expect.arrayContaining(["staff_working_hours", "staff_service_assignment"])
    );
  });

  test("marks the business ready when minimum capacity and public link exist", async () => {
    await makeBusinessHoursReady();
    await makeStaffReady();
    await createPublicLink();

    const res = await request(app)
      .get("/business/onboarding-status")
      .set("Authorization", `Bearer ${fixture.token}`);

    expect(res.status).toBe(200);
    expect(res.body.data.readyForBooking).toBe(true);
    expect(res.body.data.nextAction).toBe("ready_for_booking");
    expect(res.body.data.summary).toEqual({ completed: 6, total: 6 });
    expect(res.body.data.sections.staff.details.readyStaff).toBe(1);
    expect(res.body.data.sections.publicProfile.details.linkToken).toBe(
      "onboarding-public-link"
    );
  });

  test("public profile returns visible staff and populated service assignments", async () => {
    await makeStaffReady();
    fixture.staff.user = fixture.owner._id;
    await fixture.staff.save();
    await createPublicLink("onboarding-profile-staff");

    const res = await request(app).get(
      "/barber/profile/onboarding-profile-staff"
    );

    expect(res.status).toBe(200);
    expect(res.body.data.staff).toHaveLength(1);
    expect(res.body.data.staff[0].firstName).toBe(fixture.staff.firstName);
    expect(res.body.data.staff[0].services[0].service.name).toBe(
      fixture.service.name
    );
    expect(res.body.data.staff[0].user).toBeUndefined();
  });
});
