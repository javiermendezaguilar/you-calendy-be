const Appointment = require("../models/appointment");

describe("Appointment semantic status helpers", () => {
  test("maps legacy statuses into booking and visit semantics", () => {
    expect(Appointment.getSemanticStateFromLegacyStatus("Pending")).toEqual({
      bookingStatus: "booked",
      visitStatus: "not_started",
    });

    expect(Appointment.getSemanticStateFromLegacyStatus("Confirmed")).toEqual({
      bookingStatus: "confirmed",
      visitStatus: "not_started",
    });

    expect(Appointment.getSemanticStateFromLegacyStatus("Completed")).toEqual({
      bookingStatus: "confirmed",
      visitStatus: "completed",
    });

    expect(Appointment.getSemanticStateFromLegacyStatus("No-Show")).toEqual({
      bookingStatus: "confirmed",
      visitStatus: "no_show",
    });

    expect(Appointment.getSemanticStateFromLegacyStatus("Canceled")).toEqual({
      bookingStatus: "cancelled",
      visitStatus: "cancelled",
    });
  });

  test("allows explicit semantic overrides when the legacy status is not enough", () => {
    expect(
      Appointment.getSemanticStateFromLegacyStatus("Pending", {
        bookingStatus: "rescheduled",
      })
    ).toEqual({
      bookingStatus: "rescheduled",
      visitStatus: "not_started",
    });
  });

  test("builds a minimal policy snapshot from the business penalty settings", () => {
    expect(
      Appointment.buildPolicySnapshot({
        penaltySettings: {
          noShowPenalty: true,
          noShowPenaltyAmount: 15,
        },
      })
    ).toEqual({
      noShowPenaltyEnabled: true,
      noShowPenaltyAmount: 15,
    });

    expect(Appointment.buildPolicySnapshot({})).toEqual({
      noShowPenaltyEnabled: false,
      noShowPenaltyAmount: 0,
    });
  });
});
