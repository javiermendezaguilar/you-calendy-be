const {
  buildPaymentLineRevenueProjection,
  roundMoney,
} = require("./paymentLineRevenueProjection");

const getStaffId = (line) => {
  const id = line?.staff?.id;
  return id ? id.toString() : null;
};

const getStaffName = (line) => {
  const firstName = String(line?.staff?.firstName || "").trim();
  const lastName = String(line?.staff?.lastName || "").trim();
  const fullName = `${firstName} ${lastName}`.trim();
  return fullName || "Unattributed staff";
};

const createBreakdownItem = (line) => ({
  staffId: getStaffId(line),
  staffName: getStaffName(line),
  quantity: 0,
  lineCount: 0,
  paymentIds: new Set(),
  grossStaffRevenue: 0,
  netStaffRevenue: 0,
});

const createUnattributedStaffRevenue = (unattributedPayments) => ({
  reason: "missing_staff_or_service_line_snapshot",
  paymentIds: new Set(unattributedPayments.paymentIds),
  lineCount: 0,
  grossStaffRevenue: roundMoney(unattributedPayments.grossRevenue),
  netStaffRevenue: roundMoney(unattributedPayments.netRevenue),
});

const serializeItem = (item) => ({
  staffId: item.staffId,
  staffName: item.staffName,
  quantity: item.quantity,
  lineCount: item.lineCount,
  paymentCount: item.paymentIds.size,
  grossStaffRevenue: roundMoney(item.grossStaffRevenue),
  netStaffRevenue: roundMoney(item.netStaffRevenue),
});

const buildStaffRevenueBreakdown = (payments = []) => {
  const itemsByStaff = new Map();
  const projection = buildPaymentLineRevenueProjection(payments);
  const unattributed = createUnattributedStaffRevenue(
    projection.unattributedPayments
  );

  projection.lineRevenues.forEach((lineRevenue) => {
    const line = lineRevenue.line;
    const staffId = getStaffId(line);

    if (!staffId) {
      unattributed.paymentIds.add(lineRevenue.paymentId);
      unattributed.lineCount += 1;
      unattributed.grossStaffRevenue = roundMoney(
        unattributed.grossStaffRevenue + lineRevenue.grossRevenue
      );
      unattributed.netStaffRevenue = roundMoney(
        unattributed.netStaffRevenue + lineRevenue.netRevenue
      );
      return;
    }

    const item = itemsByStaff.get(staffId) || createBreakdownItem(line);
    item.quantity += lineRevenue.quantity;
    item.lineCount += 1;
    item.paymentIds.add(lineRevenue.paymentId);
    item.grossStaffRevenue = roundMoney(
      item.grossStaffRevenue + lineRevenue.grossRevenue
    );
    item.netStaffRevenue = roundMoney(
      item.netStaffRevenue + lineRevenue.netRevenue
    );
    itemsByStaff.set(staffId, item);
  });

  const items = Array.from(itemsByStaff.values())
    .map(serializeItem)
    .sort((left, right) => {
      if (right.netStaffRevenue !== left.netStaffRevenue) {
        return right.netStaffRevenue - left.netStaffRevenue;
      }

      return left.staffName.localeCompare(right.staffName);
    });

  return {
    source: projection.source,
    attributionScope: "performed_staff_snapshot",
    excludes: projection.excludes,
    items,
    unattributed: {
      reason: unattributed.reason,
      paymentCount: unattributed.paymentIds.size,
      lineCount: unattributed.lineCount,
      grossStaffRevenue: roundMoney(unattributed.grossStaffRevenue),
      netStaffRevenue: roundMoney(unattributed.netStaffRevenue),
    },
  };
};

module.exports = {
  buildStaffRevenueBreakdown,
};
