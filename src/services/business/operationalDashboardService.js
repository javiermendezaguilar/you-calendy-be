const moment = require("moment");
const CashSession = require("../../models/cashSession");
const Payment = require("../../models/payment");
const WaitlistEntry = require("../../models/waitlistEntry");
const { getBusinessForOwner } = require("./shared");
const {
  getQueueResponseForBusiness,
  normalizeQueueDate,
} = require("./queueService");
const {
  getFillGapCandidatesForBusiness,
} = require("./waitlistService");

const normalizeScopeId = (value) => {
  if (!value) {
    return null;
  }

  if (typeof value === "string") {
    return value;
  }

  if (typeof value.toString === "function") {
    return value.toString();
  }

  return null;
};

const buildDayBounds = (date) => {
  const normalizedDate = normalizeQueueDate(
    date || moment().format("YYYY-MM-DD")
  );

  return {
    normalizedDate,
    start: moment(normalizedDate).startOf("day").toDate(),
    end: moment(normalizedDate).endOf("day").toDate(),
    dateLabel: moment(normalizedDate).format("YYYY-MM-DD"),
  };
};

const buildPaymentSummary = async (businessId, bounds) => {
  const payments = await Payment.find({
    business: businessId,
    capturedAt: { $gte: bounds.start, $lte: bounds.end },
  }).lean();

  const grossCaptured = payments
    .filter((payment) => payment.status !== "voided")
    .reduce((sum, payment) => sum + (Number(payment.amount) || 0), 0);
  const refundedTotal = payments.reduce(
    (sum, payment) => sum + (Number(payment.refundedTotal) || 0),
    0
  );

  return {
    grossCaptured,
    refundedTotal,
    netCaptured: grossCaptured - refundedTotal,
    transactionCount: payments.length,
  };
};

const getOperationalDashboardForOwner = async (ownerId, query = {}) => {
  const business = await getBusinessForOwner(ownerId);
  const bounds = buildDayBounds(query.date);
  const fromTime = query.fromTime || moment().format("HH:mm");

  const queue = await getQueueResponseForBusiness(business._id, {
    date: bounds.dateLabel,
  });
  const activeWaitlistEntries = await WaitlistEntry.find({
    business: business._id,
    date: bounds.normalizedDate,
    status: "active",
  })
    .select("service staff")
    .lean();

  const uniqueScopes = [
    ...new Map(
      activeWaitlistEntries
        .map((entry) => {
          const serviceId = normalizeScopeId(entry.service);
          const staffId = normalizeScopeId(entry.staff);

          if (!serviceId) {
            return null;
          }

          return [
            `${serviceId}:${staffId || ""}`,
            {
              serviceId,
              staffId,
            },
          ];
        })
        .filter(Boolean)
    ).values(),
  ];

  const fillGapResults = await Promise.all(
    uniqueScopes.map((scope) =>
      getFillGapCandidatesForBusiness(business._id, {
        serviceId: scope.serviceId,
        staffId: scope.staffId || undefined,
        date: bounds.dateLabel,
        fromTime,
      })
    )
  );

  const fillGapOpportunities = fillGapResults
    .flat()
    .filter((slot) => slot.compatibleEntries.length > 0)
    .slice(0, 3);

  const activeCashSession = await CashSession.findOne({
    business: business._id,
    status: "open",
  }).lean();

  return {
    date: bounds.dateLabel,
    queue: {
      activeCount: queue.length,
      nextUp: queue.slice(0, 3),
    },
    waitlist: {
      activeCount: activeWaitlistEntries.length,
      fillGapCount: fillGapOpportunities.length,
      opportunities: fillGapOpportunities,
    },
    cashSession: activeCashSession
      ? {
          active: true,
          id: activeCashSession._id,
          openingFloat: activeCashSession.openingFloat,
          closingExpected: activeCashSession.closingExpected,
          summary: activeCashSession.summary,
        }
      : {
          active: false,
        },
    commerceToday: await buildPaymentSummary(business._id, bounds),
  };
};

module.exports = {
  getOperationalDashboardForOwner,
};
