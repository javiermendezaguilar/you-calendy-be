const CashSession = require("../models/cashSession");
const Payment = require("../models/payment");
const { resolveBusinessOrReply } = require("./commerceShared");
const { buildCommercePaymentFilter } = require("../services/payment/paymentScope");
const SuccessHandler = require("../utils/SuccessHandler");
const ErrorHandler = require("../utils/ErrorHandler");

const hydrateCashSession = async (cashSessionId) => {
  return CashSession.findById(cashSessionId)
    .populate("openedBy", "name email")
    .populate("closedBy", "name email")
    .populate({
      path: "payments",
      select: "amount tip method status reference capturedAt",
    });
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
    const business = await resolveBusinessOrReply(req, res);
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

    const cashSession = await CashSession.create({
      business: business._id,
      status: "open",
      currency: req.body.currency || "EUR",
      openingFloat,
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
    const business = await resolveBusinessOrReply(req, res);
    if (!business) return;

    const cashSession = await CashSession.findOne({
      business: business._id,
      status: "open",
    })
      .populate("openedBy", "name email")
      .populate("closedBy", "name email")
      .populate({
        path: "payments",
        select: "amount tip method status reference capturedAt",
      });

    if (!cashSession) {
      return ErrorHandler("Active cash session not found", 404, req, res);
    }

    return SuccessHandler(cashSession, 200, res);
  } catch (error) {
    return ErrorHandler(error.message, 500, req, res);
  }
};

const getCashSessionById = async (req, res) => {
  try {
    const business = await resolveBusinessOrReply(req, res);
    if (!business) return;

    const cashSession = await getOwnedCashSession(
      business._id,
      req.params.id,
      true
    );

    if (!cashSession) {
      return ErrorHandler("Cash session not found", 404, req, res);
    }

    return SuccessHandler(cashSession, 200, res);
  } catch (error) {
    return ErrorHandler(error.message, 500, req, res);
  }
};

const closeCashSession = async (req, res) => {
  try {
    const business = await resolveBusinessOrReply(req, res);
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

    const payments = await Payment.find({
      business: business._id,
      cashSession: cashSession._id,
      status: "captured",
      method: "cash",
      ...buildCommercePaymentFilter(),
    }).sort({ capturedAt: 1 });

    const cashSalesTotal = payments.reduce(
      (sum, payment) => sum + (Number(payment.amount) || 0),
      0
    );
    const tipsTotal = payments.reduce(
      (sum, payment) => sum + (Number(payment.tip) || 0),
      0
    );
    const transactionCount = payments.length;
    const expectedDrawerTotal =
      (Number(cashSession.openingFloat) || 0) + cashSalesTotal;
    const variance = closingDeclared - expectedDrawerTotal;

    cashSession.status = "closed";
    cashSession.closedAt = new Date();
    cashSession.closedBy = req.user._id || req.user.id;
    cashSession.closingExpected = expectedDrawerTotal;
    cashSession.closingDeclared = closingDeclared;
    cashSession.summary = {
      cashSalesTotal,
      tipsTotal,
      transactionCount,
      expectedDrawerTotal,
    };
    cashSession.variance = variance;
    cashSession.payments = payments.map((payment) => payment._id);
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
  getCashSessionById,
  closeCashSession,
};
