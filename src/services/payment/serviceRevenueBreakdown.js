const {
  buildPaymentLineRevenueProjection,
  roundMoney,
} = require("./paymentLineRevenueProjection");

const getServiceId = (line) => {
  const id = line?.service?.id;
  return id ? id.toString() : "unattributed_service";
};

const getServiceName = (line) =>
  String(line?.service?.name || "Unattributed service").trim();

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
  const projection = buildPaymentLineRevenueProjection(payments);

  projection.lineRevenues.forEach((lineRevenue) => {
    const line = lineRevenue.line;
    const serviceId = getServiceId(line);
    const item = itemsByService.get(serviceId) || createBreakdownItem(line);

    item.quantity += lineRevenue.quantity;
    item.lineCount += 1;
    item.paymentIds.add(lineRevenue.paymentId);
    item.grossServiceRevenue = roundMoney(
      item.grossServiceRevenue + lineRevenue.grossRevenue
    );
    item.netServiceRevenue = roundMoney(
      item.netServiceRevenue + lineRevenue.netRevenue
    );
    itemsByService.set(serviceId, item);
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
    source: projection.source,
    attributionScope: "performed_service_snapshot",
    excludes: projection.excludes,
    items,
    unattributed: {
      reason: projection.unattributedPayments.reason,
      paymentCount: projection.unattributedPayments.paymentIds.size,
      grossServiceRevenue: roundMoney(
        projection.unattributedPayments.grossRevenue
      ),
      netServiceRevenue: roundMoney(projection.unattributedPayments.netRevenue),
    },
  };
};

module.exports = {
  buildServiceRevenueBreakdown,
};
