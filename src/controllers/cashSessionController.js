const CashSession = require("../models/cashSession");
const Payment = require("../models/payment");
const { resolveBusinessOrReply } = require("./commerceShared");
const { buildCommercePaymentFilter } = require("../services/payment/paymentScope");
const SuccessHandler = require("../utils/SuccessHandler");
const ErrorHandler = require("../utils/ErrorHandler");

const CASH_CLOSING_PAYMENT_STATUSES = [
  "captured",
  "refunded_partial",
  "refunded_full",
];

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
    .sort({ capturedAt: 1 })
    .lean();

const summarizeCashSessionPayments = (cashSession, payments) => {
  const summarizedPayments = payments
    .map((payment) => {
      const amount = Number(payment.amount) || 0;
      const refundedTotal = Number(payment.refundedTotal) || 0;
      const netAmount = Math.max(amount - refundedTotal, 0);

      return {
        payment,
        netAmount,
      };
    })
    .filter(({ netAmount }) => netAmount > 0);

  const cashSalesTotal = summarizedPayments.reduce(
    (sum, { netAmount }) => sum + netAmount,
    0
  );
  const tipsTotal = payments.reduce(
    (sum, payment) => sum + (Number(payment.tip) || 0),
    0
  );
  const transactionCount = summarizedPayments.length;
  const expectedDrawerTotal =
    (Number(cashSession.openingFloat) || 0) + cashSalesTotal;
  const closingDeclared = Number(cashSession.closingDeclared) || 0;

  return {
    paymentIds: summarizedPayments.map(({ payment }) => payment._id),
    payments: summarizedPayments.map(({ payment }) => payment),
    summary: {
      cashSalesTotal,
      tipsTotal,
      transactionCount,
      expectedDrawerTotal,
    },
    closingExpected: expectedDrawerTotal,
    variance: closingDeclared - expectedDrawerTotal,
    closing: {
      ready: transactionCount > 0,
      transactionCount,
      cashSalesTotal,
      expectedDrawerTotal,
    },
  };
};

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
  const snapshot = summarizeCashSessionPayments(base, payments);

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
    const rawLimit = Number(req.query.limit);
    const limit = Number.isNaN(rawLimit)
      ? 10
      : Math.min(Math.max(rawLimit, 1), 20);

    const cashSessions = await CashSession.find({
      business: business._id,
      ...statusFilter,
    })
      .populate("openedBy", "name email")
      .populate("closedBy", "name email")
      .populate("handoffFrom", "closingDeclared closedAt variance varianceStatus")
      .sort({ openedAt: -1 })
      .limit(limit);

    const readModels = await Promise.all(
      cashSessions.map((cashSession) => buildCashSessionReadModel(cashSession))
    );

    return SuccessHandler(readModels, 200, res);
  } catch (error) {
    return ErrorHandler(error.message, 500, req, res);
  }
};

const getCashSessionById = async (req, res) => {
  try {
    const business = req.business || (await resolveBusinessOrReply(req, res));
    if (!business) return;

    const cashSession = await getOwnedCashSession(
      business._id,
      req.params.id,
      true
    );

    if (!cashSession) {
      return ErrorHandler("Cash session not found", 404, req, res);
    }

    const readModel = await buildCashSessionReadModel(cashSession);
    return SuccessHandler(readModel, 200, res);
  } catch (error) {
    return ErrorHandler(error.message, 500, req, res);
  }
};

const closeCashSession = async (req, res) => {
  try {
    const business = req.business || (await resolveBusinessOrReply(req, res));
    if (!business) return;

    const cashSession = await getOwnedCashSession(business._id, req.params.id);

    if (!cashSession) {
      return ErrorHandler("Cash session not found", 404, req, res);
    }

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
    const snapshot = summarizeCashSessionPayments(
      {
        ...cashSession.toObject(),
        closingDeclared,
      },
      payments
    );
    const closingNote = String(req.body.closingNote || "").trim();
    const varianceStatus = getVarianceStatus(snapshot.variance);

    if (snapshot.variance !== 0 && !closingNote) {
      return ErrorHandler(
        "closingNote is required when closingDeclared differs from closingExpected",
        400,
        req,
        res
      );
    }

    cashSession.status = "closed";
    cashSession.closedAt = new Date();
    cashSession.closedBy = req.user._id || req.user.id;
    cashSession.closingExpected = snapshot.closingExpected;
    cashSession.closingDeclared = closingDeclared;
    cashSession.summary = snapshot.summary;
    cashSession.variance = snapshot.variance;
    cashSession.varianceStatus = varianceStatus;
    cashSession.closingNote = closingNote;
    cashSession.payments = snapshot.paymentIds;
    await cashSession.save();

    const hydrated = await hydrateCashSession(cashSession._id);
    return SuccessHandler(hydrated, 200, res);
  } catch (error) {
    return ErrorHandler(error.message, 500, req, res);
  }
};

module.exports = {
  openCashSession,
  getActiveCashSession,
  listCashSessions,
  getCashSessionById,
  closeCashSession,
};
