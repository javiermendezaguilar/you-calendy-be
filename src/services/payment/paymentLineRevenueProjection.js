const RETAINED_PAYMENT_STATUSES = new Set([
  "captured",
  "refunded_partial",
  "refunded_full",
]);

const PAYMENT_LINE_REVENUE_SOURCE = "payment_snapshot_service_lines";
const PAYMENT_LINE_REVENUE_EXCLUDES = ["platform_billing", "voided", "tips"];

const roundMoney = (value) =>
  Math.round((Number(value) + Number.EPSILON) * 100) / 100;

const toNumber = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
};

const getPaymentKey = (payment, index) =>
  payment?._id?.toString() || `payment:${index}`;

const getGrossServiceAmount = (payment) => {
  const subtotal = toNumber(payment?.snapshot?.subtotal);
  if (subtotal > 0) {
    return subtotal;
  }

  return Math.max(toNumber(payment?.amount) - toNumber(payment?.tip), 0);
};

const getRetainedServiceAmount = (payment, grossServiceAmount) => {
  const retainedPaymentAmount = Math.max(
    toNumber(payment?.amount) - toNumber(payment?.refundedTotal),
    0
  );
  const retainedServiceAmount = Math.max(
    retainedPaymentAmount - toNumber(payment?.tip),
    0
  );

  return Math.min(grossServiceAmount, retainedServiceAmount);
};

const allocateNetRevenue = (lines, retainedServiceAmount) => {
  const grossAmounts = lines.map((line) => Math.max(toNumber(line.lineTotal), 0));
  const grossTotal = roundMoney(
    grossAmounts.reduce((sum, amount) => sum + amount, 0)
  );
  const netTarget = roundMoney(Math.min(retainedServiceAmount, grossTotal));

  if (grossTotal <= 0 || netTarget <= 0) {
    return grossAmounts.map(() => 0);
  }

  let allocated = 0;
  return grossAmounts.map((amount, index) => {
    if (index === grossAmounts.length - 1) {
      return roundMoney(netTarget - allocated);
    }

    const lineNet = roundMoney((amount / grossTotal) * netTarget);
    allocated = roundMoney(allocated + lineNet);
    return lineNet;
  });
};

const createUnattributedPaymentRevenue = () => ({
  reason: "missing_payment_snapshot_service_lines",
  paymentIds: new Set(),
  grossRevenue: 0,
  netRevenue: 0,
});

const buildPaymentLineRevenueProjection = (payments = []) => {
  const lineRevenues = [];
  const unattributedPayments = createUnattributedPaymentRevenue();

  payments
    .filter((payment) => RETAINED_PAYMENT_STATUSES.has(payment.status))
    .forEach((payment, paymentIndex) => {
      const paymentId = getPaymentKey(payment, paymentIndex);
      const serviceLines = Array.isArray(payment?.snapshot?.serviceLines)
        ? payment.snapshot.serviceLines
        : [];
      const grossServiceAmount = getGrossServiceAmount(payment);
      const retainedServiceAmount = getRetainedServiceAmount(
        payment,
        grossServiceAmount
      );

      if (serviceLines.length === 0) {
        unattributedPayments.paymentIds.add(paymentId);
        unattributedPayments.grossRevenue = roundMoney(
          unattributedPayments.grossRevenue + grossServiceAmount
        );
        unattributedPayments.netRevenue = roundMoney(
          unattributedPayments.netRevenue + retainedServiceAmount
        );
        return;
      }

      const netAllocations = allocateNetRevenue(
        serviceLines,
        retainedServiceAmount
      );

      serviceLines.forEach((line, lineIndex) => {
        lineRevenues.push({
          paymentId,
          line,
          grossRevenue: roundMoney(Math.max(toNumber(line.lineTotal), 0)),
          netRevenue: roundMoney(netAllocations[lineIndex]),
          quantity: toNumber(line.quantity) || 1,
        });
      });
    });

  return {
    source: PAYMENT_LINE_REVENUE_SOURCE,
    excludes: PAYMENT_LINE_REVENUE_EXCLUDES,
    lineRevenues,
    unattributedPayments,
  };
};

module.exports = {
  PAYMENT_LINE_REVENUE_EXCLUDES,
  PAYMENT_LINE_REVENUE_SOURCE,
  buildPaymentLineRevenueProjection,
  roundMoney,
  toNumber,
};
