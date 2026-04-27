const normalizeCheckoutId = (value) => {
  if (!value) {
    return null;
  }

  return String(value._id || value);
};

const hasTerminalCheckoutRefund = (checkout) =>
  Boolean(checkout?.refundSummary?.status) &&
  checkout.refundSummary.status !== "none";

const getCheckoutIdsByStatus = (payments, statuses) =>
  new Set(
    payments
      .filter((payment) => statuses.includes(payment.status))
      .map((payment) => normalizeCheckoutId(payment.checkout))
      .filter(Boolean)
  );

const getRebookingStatus = (checkout) => checkout.rebooking?.status || "none";

const buildRebookingSummary = (checkouts = [], payments = []) => {
  const capturedCheckoutIds = getCheckoutIdsByStatus(payments, ["captured"]);
  const refundedCheckoutIds = getCheckoutIdsByStatus(payments, [
    "refunded_partial",
    "refunded_full",
  ]);

  const eligibleCheckouts = checkouts.filter((checkout) => {
    const checkoutId = normalizeCheckoutId(checkout._id);
    return (
      checkout.status === "paid" &&
      capturedCheckoutIds.has(checkoutId) &&
      !refundedCheckoutIds.has(checkoutId) &&
      !hasTerminalCheckoutRefund(checkout)
    );
  });

  const counts = eligibleCheckouts.reduce(
    (acc, checkout) => {
      const status = getRebookingStatus(checkout);
      if (status === "booked") acc.bookedCount += 1;
      if (status === "follow_up_needed") acc.followUpNeededCount += 1;
      if (status === "declined") acc.declinedCount += 1;
      if (!status || status === "none") acc.pendingCount += 1;
      return acc;
    },
    {
      bookedCount: 0,
      followUpNeededCount: 0,
      declinedCount: 0,
      pendingCount: 0,
    }
  );

  const eligibleCount = eligibleCheckouts.length;
  const rate =
    eligibleCount > 0
      ? Number((counts.bookedCount / eligibleCount).toFixed(4))
      : 0;

  return {
    count: counts.bookedCount,
    eligibleCount,
    bookedCount: counts.bookedCount,
    pendingCount: counts.pendingCount,
    followUpNeededCount: counts.followUpNeededCount,
    declinedCount: counts.declinedCount,
    rate,
  };
};

module.exports = {
  buildRebookingSummary,
};
