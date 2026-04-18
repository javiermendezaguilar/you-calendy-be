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

  test("builds an expanded policy snapshot from the business settings", () => {
    const withPenalty = Appointment.buildPolicySnapshot({
      bookingBuffer: 20,
      penaltySettings: {
        noShowPenalty: true,
        noShowPenaltyAmount: 15,
      },
    });

    expect(withPenalty).toEqual(
      expect.objectContaining({
        version: 2,
        bookingBufferMinutes: 20,
        noShowPenaltyEnabled: true,
        noShowPenaltyAmount: 15,
      })
    );
    expect(withPenalty.capturedAt).toBeInstanceOf(Date);

    const withoutPenalty = Appointment.buildPolicySnapshot({});
    expect(withoutPenalty).toEqual(
      expect.objectContaining({
        version: 2,
        bookingBufferMinutes: 0,
        noShowPenaltyEnabled: false,
        noShowPenaltyAmount: 0,
      })
    );
    expect(withoutPenalty.capturedAt).toBeInstanceOf(Date);
  });
});
