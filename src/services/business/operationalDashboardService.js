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

const buildQueueStaffBreakdown = (queue) => {
  const breakdown = new Map();

  queue.forEach((entry) => {
    if (!entry.staff?._id) {
      return;
    }

    const staffId = entry.staff._id.toString();
    const current = breakdown.get(staffId) || {
      staff: {
        _id: entry.staff._id,
        firstName: entry.staff.firstName,
        lastName: entry.staff.lastName,
      },
      activeCount: 0,
      estimatedWaitMinutes: 0,
    };

    current.activeCount += 1;
    current.estimatedWaitMinutes = Math.max(
      current.estimatedWaitMinutes,
      Number(entry.estimatedWaitMinutes) || 0
    );

    breakdown.set(staffId, current);
  });

  return [...breakdown.values()].sort((left, right) => {
    if (right.estimatedWaitMinutes !== left.estimatedWaitMinutes) {
      return right.estimatedWaitMinutes - left.estimatedWaitMinutes;
    }

    return right.activeCount - left.activeCount;
  });
};

const buildNextActions = ({ queue, fillGapOpportunities, activeCashSession }) => {
  const actions = [];

  if (!activeCashSession) {
    actions.push({
      type: "open_cash_session",
      priority: "high",
      label: "Open cash session before taking cash payments",
      meta: {},
    });
  }

  if (queue.length > 0) {
    const nextEntry = queue[0];
    actions.push({
      type: "serve_next_walk_in",
      priority: "high",
      label: "Next walk-in is ready to be served",
      meta: {
        appointmentId: nextEntry._id,
        queuePosition: nextEntry.queuePosition,
        estimatedWaitMinutes: nextEntry.estimatedWaitMinutes,
      },
    });
  }

  if (fillGapOpportunities.length > 0) {
    actions.push({
      type: "review_fill_gaps",
      priority: "medium",
      label: "Review waitlist entries that can fill current gaps",
      meta: {
        compatibleCount: fillGapOpportunities.length,
      },
    });
  }

  return actions;
};

const buildAlerts = ({ queue, fillGapOpportunities, activeCashSession }) => {
  const alerts = [];

  if (queue.length >= 3) {
    const maxWaitMinutes = Math.max(
      ...queue.map((entry) => Number(entry.estimatedWaitMinutes) || 0)
    );

    alerts.push({
      type: "queue_backlog",
      severity: "warning",
      label: "Walk-in queue is building up",
      meta: {
        activeCount: queue.length,
        maxWaitMinutes,
      },
    });
  }

  if (!activeCashSession) {
    alerts.push({
      type: "no_cash_session",
      severity: "info",
      label: "No active cash session is open",
      meta: {},
    });
  }

  if (fillGapOpportunities.length > 0) {
    alerts.push({
      type: "waitlist_opportunity",
      severity: "info",
      label: "There are waitlist entries compatible with current gaps",
      meta: {
        compatibleCount: fillGapOpportunities.length,
      },
    });
  }

  return alerts;
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
  const queueStaffBreakdown = buildQueueStaffBreakdown(queue);
  const nextActions = buildNextActions({
    queue,
    fillGapOpportunities,
    activeCashSession,
  });
  const alerts = buildAlerts({
    queue,
    fillGapOpportunities,
    activeCashSession,
  });

  return {
    date: bounds.dateLabel,
    queue: {
      activeCount: queue.length,
      nextUp: queue.slice(0, 3),
      staffBreakdown: queueStaffBreakdown,
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
    nextActions,
    alerts,
  };
};

module.exports = {
  getOperationalDashboardForOwner,
};
