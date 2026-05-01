const mongoose = require("mongoose");
const CashSession = require("../models/cashSession");
const Payment = require("../models/payment");
const { resolveBusinessOrReply } = require("./commerceShared");
const { buildCommercePaymentFilter } = require("../services/payment/paymentScope");
const { buildCashSessionSnapshot } = require("../services/payment/cashSessionSummary");
const {
  recordBusinessOperationalAlert,
} = require("../services/businessOperationalAlertService");
const SuccessHandler = require("../utils/SuccessHandler");
const ErrorHandler = require("../utils/ErrorHandler");

const CASH_CLOSING_PAYMENT_STATUSES = [
  "captured",
  "refunded_partial",
  "refunded_full",
];

const CASH_SESSION_LIST_SORT = { openedAt: -1, _id: -1 };
const CASH_PAYMENT_READ_SORT = { capturedAt: 1, _id: 1 };
const DEFAULT_CASH_SESSION_LIMIT = 10;

const getVarianceStatus = (variance) => {
  if (variance === 0) {
    return "exact";
  }

  return variance > 0 ? "over" : "short";
};

const hydrateCashSession = async (cashSessionId) => {
  return CashSession.findById(cashSessionId)
    .populate("openedBy", "name email")
    .populate("closedBy", "name email")
    .populate("handoffFrom", "closingDeclared closedAt variance varianceStatus")
    .populate({
      path: "payments",
      select: "amount tip method status reference capturedAt",
    });
};

const getOpenCashSessionPayments = async (businessId, cashSessionId) =>
  Payment.find({
    business: businessId,
    cashSession: cashSessionId,
    method: "cash",
    status: { $in: CASH_CLOSING_PAYMENT_STATUSES },
    ...buildCommercePaymentFilter(),
  })
    .select("amount tip method status reference capturedAt refundedTotal")
    .sort(CASH_PAYMENT_READ_SORT)
    .lean();

const buildVariancePreview = (expectedDrawerTotal, closingDeclaredPreview) => {
  if (
    closingDeclaredPreview === undefined ||
    closingDeclaredPreview === null ||
    closingDeclaredPreview === ""
  ) {
    return null;
  }

  const normalizedPreview = Number(closingDeclaredPreview);
  if (Number.isNaN(normalizedPreview) || normalizedPreview < 0) {
    return null;
  }

  const variance = normalizedPreview - (Number(expectedDrawerTotal) || 0);

  return {
    closingDeclared: normalizedPreview,
    variance,
    varianceStatus: getVarianceStatus(variance),
  };
};

const buildCashSessionClosingUpdate = ({
  cashSession,
  snapshot,
  closingDeclared,
  closingNote,
  closedBy,
}) => ({
  status: "closed",
  closedAt: new Date(),
  closedBy,
  closingExpected: snapshot.closingExpected,
  closingDeclared,
  summary: snapshot.summary,
  variance: snapshot.variance,
  varianceStatus: getVarianceStatus(snapshot.variance),
  closingNote,
  payments: snapshot.paymentIds,
  openingFloat: cashSession.openingFloat,
});

const parseDateQuery = (value, fieldName) => {
  if (!value) {
    return { date: null };
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return { error: `${fieldName} must be a valid date` };
  }

  return { date };
};

const buildCashSessionReportTotals = (cashSessions = []) =>
  cashSessions.reduce(
    (totals, cashSession) => {
      const summary = cashSession.summary || {};
      const isClosed = cashSession.status === "closed";
      const varianceStatus = cashSession.varianceStatus || "exact";

      totals.sessionCount += 1;
      totals.openCount += cashSession.status === "open" ? 1 : 0;
      totals.closedCount += isClosed ? 1 : 0;
      totals.transactionCount += Number(summary.transactionCount) || 0;
      totals.cashSalesTotal += Number(summary.cashSalesTotal) || 0;
      totals.tipsTotal += Number(summary.tipsTotal) || 0;
      totals.expectedDrawerTotal +=
        Number(summary.expectedDrawerTotal) ||
        Number(cashSession.closingExpected) ||
        0;

      if (isClosed) {
        totals.closingDeclaredTotal += Number(cashSession.closingDeclared) || 0;
        totals.varianceTotal += Number(cashSession.variance) || 0;
      }

      if (isClosed && varianceStatus === "over") {
        totals.varianceBreakdown.over += 1;
      } else if (isClosed && varianceStatus === "short") {
        totals.varianceBreakdown.short += 1;
      } else if (isClosed) {
        totals.varianceBreakdown.exact += 1;
      }

      return totals;
    },
    {
      sessionCount: 0,
      openCount: 0,
      closedCount: 0,
      transactionCount: 0,
      cashSalesTotal: 0,
      tipsTotal: 0,
      expectedDrawerTotal: 0,
      closingDeclaredTotal: 0,
      varianceTotal: 0,
      varianceBreakdown: {
        exact: 0,
        over: 0,
        short: 0,
      },
    }
  );

const buildCashSessionReadModel = async (cashSession, options = {}) => {
  const base =
    typeof cashSession.toObject === "function" ? cashSession.toObject() : cashSession;

  const opening = {
    source: base?.openingSource || "manual",
    reason: base?.openingReason || "manual_start",
    note: base?.openingNote || "",
    float: Number(base?.openingFloat) || 0,
    openedAt: base?.openedAt || null,
    openedBy: base?.openedBy || null,
    handoffFrom: base?.handoffFrom || null,
  };

  if (!base || base.status !== "open") {
    const expectedDrawerTotal =
      Number(base?.summary?.expectedDrawerTotal) ||
      Number(base?.closingExpected) ||
      0;

    return {
      ...base,
      opening,
      closing: {
        ready: Number(base?.summary?.transactionCount) > 0,
        transactionCount: Number(base?.summary?.transactionCount) || 0,
        cashSalesTotal: Number(base?.summary?.cashSalesTotal) || 0,
        expectedDrawerTotal,
      },
      variancePreview: buildVariancePreview(
        expectedDrawerTotal,
        options.closingDeclaredPreview
      ),
    };
  }

  const payments = await getOpenCashSessionPayments(base.business, base._id);
  const snapshot = buildCashSessionSnapshot(base, payments);

  return {
    ...base,
    opening,
    payments: snapshot.payments,
    summary: snapshot.summary,
    closingExpected: snapshot.closingExpected,
    variance: snapshot.variance,
    closing: snapshot.closing,
    variancePreview: buildVariancePreview(
      snapshot.closing.expectedDrawerTotal,
      options.closingDeclaredPreview
    ),
  };
};

const getOwnedCashSession = async (businessId, cashSessionId, hydrated = false) => {
  const query = CashSession.findOne({
    _id: cashSessionId,
    business: businessId,
  });

  if (!hydrated) {
    return query;
  }

  return query
    .populate("openedBy", "name email")
    .populate("closedBy", "name email")
    .populate({
      path: "payments",
      select: "amount tip method status reference capturedAt",
    });
};

const getBusinessAndOwnedCashSession = async (
  req,
  res,
  { hydrated = false } = {}
) => {
  const business = req.business || (await resolveBusinessOrReply(req, res));
  if (!business) {
    return {};
  }

  const cashSession = await getOwnedCashSession(
    business._id,
    req.params.id,
    hydrated
  );

  if (!cashSession) {
    ErrorHandler("Cash session not found", 404, req, res);
    return { business };
  }

  return { business, cashSession };
};

const openCashSession = async (req, res) => {
  try {
    const business = req.business || (await resolveBusinessOrReply(req, res));
    if (!business) return;

    const existingSession = await CashSession.findOne({
      business: business._id,
      status: "open",
    });

    if (existingSession) {
      return ErrorHandler(
        "An active cash session already exists for this business",
        409,
        req,
        res
      );
    }

    const openingFloat = Number(req.body.openingFloat);
    if (Number.isNaN(openingFloat) || openingFloat < 0) {
      return ErrorHandler(
        "openingFloat must be a non-negative number",
        400,
        req,
        res
      );
    }

    let openingSource = "manual";
    let openingReason = req.body.openingReason || "manual_start";
    let openingNote = String(req.body.openingNote || "").trim();
    let handoffFrom = null;

    if (req.body.handoffFromSessionId) {
      if (!mongoose.Types.ObjectId.isValid(req.body.handoffFromSessionId)) {
        return ErrorHandler(
          "handoffFromSessionId must be a valid cash session id",
          400,
          req,
          res
        );
      }

      handoffFrom = await CashSession.findOne({
        _id: req.body.handoffFromSessionId,
        business: business._id,
        status: "closed",
      });

      if (!handoffFrom) {
        return ErrorHandler(
          "Closed handoff cash session not found",
          404,
          req,
          res
        );
      }

      if (Number(handoffFrom.closingDeclared) !== openingFloat) {
        return ErrorHandler(
          "openingFloat must match the closingDeclared amount of the handoff session",
          409,
          req,
          res
        );
      }

      openingSource = "handoff";
      openingReason = "handoff";
    } else {
      if (
        openingReason !== "manual_start" &&
        openingReason !== "manual_adjustment"
      ) {
        return ErrorHandler(
          "openingReason must be manual_start or manual_adjustment for manual cash sessions",
          400,
          req,
          res
        );
      }

      if (openingReason === "manual_adjustment" && !openingNote) {
        return ErrorHandler(
          "openingNote is required when openingReason is manual_adjustment",
          400,
          req,
          res
        );
      }
    }

    const cashSession = await CashSession.create({
      business: business._id,
      status: "open",
      currency: req.body.currency || "EUR",
      openingFloat,
      openingSource,
      openingReason,
      openingNote,
      handoffFrom: handoffFrom?._id || null,
      openedAt: new Date(),
      openedBy: req.user._id || req.user.id,
    });

    const hydrated = await hydrateCashSession(cashSession._id);
    return SuccessHandler(hydrated, 201, res);
  } catch (error) {
    if (error?.code === 11000) {
      return ErrorHandler(
        "An active cash session already exists for this business",
        409,
        req,
        res
      );
    }

    return ErrorHandler(error.message, 500, req, res);
  }
};

const getActiveCashSession = async (req, res) => {
  try {
    const business = req.business || (await resolveBusinessOrReply(req, res));
    if (!business) return;

    const cashSession = await CashSession.findOne({
      business: business._id,
      status: "open",
    })
      .populate("openedBy", "name email")
      .populate("closedBy", "name email")
      .populate("handoffFrom", "closingDeclared closedAt variance varianceStatus")
      .populate({
        path: "payments",
        select: "amount tip method status reference capturedAt",
      });

    if (!cashSession) {
      return ErrorHandler("Active cash session not found", 404, req, res);
    }

    const readModel = await buildCashSessionReadModel(cashSession, {
      closingDeclaredPreview: req.query.closingDeclaredPreview,
    });
    return SuccessHandler(readModel, 200, res);
  } catch (error) {
    return ErrorHandler(error.message, 500, req, res);
  }
};

const listCashSessions = async (req, res) => {
  try {
    const business = req.business || (await resolveBusinessOrReply(req, res));
    if (!business) return;

    const statusFilter =
      req.query.status === "open" || req.query.status === "closed"
        ? { status: req.query.status }
        : {};
    const limit = Number(req.query.limit) || DEFAULT_CASH_SESSION_LIMIT;
    const page = Number(req.query.page) || 1;
    const skip = (page - 1) * limit;
    const filter = {
      business: business._id,
      ...statusFilter,
    };

    const [total, cashSessions] = await Promise.all([
      CashSession.countDocuments(filter),
      CashSession.find(filter)
        .populate("openedBy", "name email")
        .populate("closedBy", "name email")
        .populate("handoffFrom", "closingDeclared closedAt variance varianceStatus")
        .sort(CASH_SESSION_LIST_SORT)
        .skip(skip)
        .limit(limit),
    ]);

    const readModels = await Promise.all(
      cashSessions.map((cashSession) => buildCashSessionReadModel(cashSession))
    );

    return SuccessHandler(
      {
        sessions: readModels,
        pagination: {
          total,
          page,
          limit,
          pages: Math.ceil(total / limit),
          hasMore: page * limit < total,
        },
      },
      200,
      res
    );
  } catch (error) {
    return ErrorHandler(error.message, 500, req, res);
  }
};

const getCashSessionReport = async (req, res) => {
  try {
    const business = req.business || (await resolveBusinessOrReply(req, res));
    if (!business) return;

    const requestedStatus = req.query.status || "closed";
    if (!["open", "closed", "all"].includes(requestedStatus)) {
      return ErrorHandler("status must be open, closed or all", 400, req, res);
    }

    const from = parseDateQuery(req.query.from, "from");
    if (from.error) {
      return ErrorHandler(from.error, 400, req, res);
    }

    const to = parseDateQuery(req.query.to, "to");
    if (to.error) {
      return ErrorHandler(to.error, 400, req, res);
    }

    if (from.date && to.date && from.date > to.date) {
      return ErrorHandler("from must be before to", 400, req, res);
    }

    const dateField = requestedStatus === "closed" ? "closedAt" : "openedAt";
    const dateFilter = {};
    if (from.date) {
      dateFilter.$gte = from.date;
    }
    if (to.date) {
      dateFilter.$lte = to.date;
    }

    const filter = {
      business: business._id,
      ...(requestedStatus === "all" ? {} : { status: requestedStatus }),
      ...(Object.keys(dateFilter).length ? { [dateField]: dateFilter } : {}),
    };

    const cashSessions = await CashSession.find(filter)
      .select(
        "status currency openingFloat openedAt closedAt closingExpected closingDeclared summary variance varianceStatus closingNote"
      )
      .sort({ [dateField]: -1, _id: -1 })
      .lean();

    const totals = buildCashSessionReportTotals(cashSessions);

    return SuccessHandler(
      {
        status: requestedStatus,
        period: {
          from: from.date,
          to: to.date,
          dateField,
        },
        totals,
      },
      200,
      res
    );
  } catch (error) {
    return ErrorHandler(error.message, 500, req, res);
  }
};

const getCashSessionById = async (req, res) => {
  try {
    const { cashSession } = await getBusinessAndOwnedCashSession(req, res, {
      hydrated: true,
    });
    if (!cashSession) return;

    const readModel = await buildCashSessionReadModel(cashSession);
    return SuccessHandler(readModel, 200, res);
  } catch (error) {
    return ErrorHandler(error.message, 500, req, res);
  }
};

const closeCashSession = async (req, res) => {
  try {
    const { business, cashSession } = await getBusinessAndOwnedCashSession(
      req,
      res
    );
    if (!business || !cashSession) return;

    if (cashSession.status !== "open") {
      return ErrorHandler("Cash session is already closed", 409, req, res);
    }

    const closingDeclared = Number(req.body.closingDeclared);
    if (Number.isNaN(closingDeclared) || closingDeclared < 0) {
      return ErrorHandler(
        "closingDeclared must be a non-negative number",
        400,
        req,
        res
      );
    }

    const payments = await getOpenCashSessionPayments(business._id, cashSession._id);
    const snapshot = buildCashSessionSnapshot(
      {
        ...cashSession.toObject(),
        closingDeclared,
      },
      payments
    );
    const closingNote = String(req.body.closingNote || "").trim();

    if (snapshot.variance !== 0 && !closingNote) {
      return ErrorHandler(
        "closingNote is required when closingDeclared differs from closingExpected",
        400,
        req,
        res
      );
    }

    const closedBy = req.user._id || req.user.id;
    const closingUpdate = buildCashSessionClosingUpdate({
      cashSession,
      snapshot,
      closingDeclared,
      closingNote,
      closedBy,
    });

    const closedSession = await CashSession.findOneAndUpdate(
      {
        _id: cashSession._id,
        business: business._id,
        status: "open",
      },
      { $set: closingUpdate },
      { new: true }
    );

    if (!closedSession) {
      return ErrorHandler("Cash session is already closed", 409, req, res);
    }

    if (snapshot.variance !== 0) {
      await recordBusinessOperationalAlert("cash_session_variance", {
        businessId: business._id,
        actorId: req.user?._id || req.user?.id || null,
        actorType: "user",
        source: "cash_session_controller",
        correlationId: `cash-session-variance:${closedSession._id}`,
        entityType: "cash_session",
        entityId: closedSession._id,
        metadata: {
          openingFloat: cashSession.openingFloat,
          closingDeclared,
          closingExpected: snapshot.closingExpected,
          variance: snapshot.variance,
          varianceStatus: getVarianceStatus(snapshot.variance),
          hasClosingNote: Boolean(closingNote),
        },
      });
    }

    const hydrated = await hydrateCashSession(closedSession._id);
    const readModel = await buildCashSessionReadModel(hydrated);
    return SuccessHandler(readModel, 200, res);
  } catch (error) {
    return ErrorHandler(error.message, 500, req, res);
  }
};

module.exports = {
  openCashSession,
  getActiveCashSession,
  listCashSessions,
  getCashSessionReport,
  getCashSessionById,
  closeCashSession,
};
