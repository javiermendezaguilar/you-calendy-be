const RETAINED_PAYMENT_STATUSES = new Set([
  "captured",
  "refunded_partial",
  "refunded_full",
]);

const roundMoney = (value) =>
  Math.round((Number(value) + Number.EPSILON) * 100) / 100;

const toNumber = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
};

const getServiceId = (line) => {
  const id = line?.service?.id;
  return id ? id.toString() : "unattributed_service";
};

const getServiceName = (line) =>
  String(line?.service?.name || "Unattributed service").trim();

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

const createBreakdownItem = (line) => ({
  serviceId: getServiceId(line),
  serviceName: getServiceName(line),
  quantity: 0,
  lineCount: 0,
  paymentIds: new Set(),
  grossServiceRevenue: 0,
  netServiceRevenue: 0,
});

const serializeItem = (item) => ({
  serviceId: item.serviceId === "unattributed_service" ? null : item.serviceId,
  serviceName: item.serviceName,
  quantity: item.quantity,
  lineCount: item.lineCount,
  paymentCount: item.paymentIds.size,
  grossServiceRevenue: roundMoney(item.grossServiceRevenue),
  netServiceRevenue: roundMoney(item.netServiceRevenue),
});

const buildServiceRevenueBreakdown = (payments = []) => {
  const itemsByService = new Map();
  const unattributed = {
    reason: "missing_payment_snapshot_service_lines",
    paymentCount: 0,
    grossServiceRevenue: 0,
    netServiceRevenue: 0,
  };

  payments
    .filter((payment) => RETAINED_PAYMENT_STATUSES.has(payment.status))
    .forEach((payment) => {
      const serviceLines = Array.isArray(payment?.snapshot?.serviceLines)
        ? payment.snapshot.serviceLines
        : [];
      const grossServiceAmount = getGrossServiceAmount(payment);
      const retainedServiceAmount = getRetainedServiceAmount(
        payment,
        grossServiceAmount
      );

      if (serviceLines.length === 0) {
        unattributed.paymentCount += 1;
        unattributed.grossServiceRevenue = roundMoney(
          unattributed.grossServiceRevenue + grossServiceAmount
        );
        unattributed.netServiceRevenue = roundMoney(
          unattributed.netServiceRevenue + retainedServiceAmount
        );
        return;
      }

      const netAllocations = allocateNetRevenue(
        serviceLines,
        retainedServiceAmount
      );

      serviceLines.forEach((line, index) => {
        const serviceId = getServiceId(line);
        const item =
          itemsByService.get(serviceId) || createBreakdownItem(line);
        const quantity = toNumber(line.quantity) || 1;

        item.quantity += quantity;
        item.lineCount += 1;
        item.paymentIds.add(payment._id?.toString() || String(index));
        item.grossServiceRevenue = roundMoney(
          item.grossServiceRevenue + Math.max(toNumber(line.lineTotal), 0)
        );
        item.netServiceRevenue = roundMoney(
          item.netServiceRevenue + netAllocations[index]
        );
        itemsByService.set(serviceId, item);
      });
    });

  const items = Array.from(itemsByService.values())
    .map(serializeItem)
    .sort((left, right) => {
      if (right.netServiceRevenue !== left.netServiceRevenue) {
        return right.netServiceRevenue - left.netServiceRevenue;
      }

      return left.serviceName.localeCompare(right.serviceName);
    });

  return {
    source: "payment_snapshot_service_lines",
    attributionScope: "performed_service_snapshot",
    excludes: ["platform_billing", "voided", "tips"],
    items,
    unattributed: {
      ...unattributed,
      grossServiceRevenue: roundMoney(unattributed.grossServiceRevenue),
      netServiceRevenue: roundMoney(unattributed.netServiceRevenue),
    },
  };
};

module.exports = {
  buildServiceRevenueBreakdown,
};
