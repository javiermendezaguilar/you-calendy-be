const Client = require("../../models/client");
const Payment = require("../../models/payment");
const {
  PAYMENT_SCOPE,
} = require("../payment/paymentScope");
const {
  buildServiceError,
  findOwnedClientOrThrow,
} = require("./shared");

const CLIENT_LIFECYCLE_STATUS = Object.freeze({
  NEW: "new",
  ACTIVE: "active",
  AT_RISK: "at_risk",
  LOST: "lost",
  WON_BACK: "won_back",
});

const PAID_VISIT_PAYMENT_STATUSES = Object.freeze([
  "captured",
  "refunded_partial",
]);

const ACTIVE_WINDOW_DAYS = 60;
const LOST_WINDOW_DAYS = 120;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

const toDateOrNull = (value) => {
  if (!value) {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const daysSince = (date, now) => {
  return Math.floor((now.getTime() - date.getTime()) / MS_PER_DAY);
};

const deriveLifecycleStatus = ({
  firstPaidVisitAt,
  lastPaidVisitAt,
  previousStatus,
  now = new Date(),
}) => {
  const firstPaid = toDateOrNull(firstPaidVisitAt);
  const lastPaid = toDateOrNull(lastPaidVisitAt);

  if (!firstPaid || !lastPaid) {
    return CLIENT_LIFECYCLE_STATUS.NEW;
  }

  const ageInDays = daysSince(lastPaid, now);

  if (ageInDays > LOST_WINDOW_DAYS) {
    return CLIENT_LIFECYCLE_STATUS.LOST;
  }

  if (ageInDays > ACTIVE_WINDOW_DAYS) {
    return CLIENT_LIFECYCLE_STATUS.AT_RISK;
  }

  if (previousStatus === CLIENT_LIFECYCLE_STATUS.LOST) {
    return CLIENT_LIFECYCLE_STATUS.WON_BACK;
  }

  return CLIENT_LIFECYCLE_STATUS.ACTIVE;
};

const buildPaidVisitPaymentQuery = (client) => ({
  paymentScope: PAYMENT_SCOPE.COMMERCE_CHECKOUT,
  business: client.business,
  client: client._id,
  status: { $in: PAID_VISIT_PAYMENT_STATUSES },
  capturedAt: { $ne: null },
});

const findFirstAndLastPaidVisit = async (client) => {
  const query = buildPaidVisitPaymentQuery(client);
  const [firstPayment, lastPayment] = await Promise.all([
    Payment.findOne(query).select("capturedAt").sort({ capturedAt: 1 }),
    Payment.findOne(query).select("capturedAt").sort({ capturedAt: -1 }),
  ]);

  return {
    firstPaidVisitAt: firstPayment?.capturedAt || null,
    lastPaidVisitAt: lastPayment?.capturedAt || null,
  };
};

const serializeClientLifecycle = (client) => ({
  clientId: client._id,
  firstPaidVisitAt: client.firstPaidVisitAt || null,
  lastPaidVisitAt: client.lastPaidVisitAt || null,
  lifecycleStatus:
    client.lifecycleStatus || CLIENT_LIFECYCLE_STATUS.NEW,
  lifecycleUpdatedAt: client.lifecycleUpdatedAt || null,
  wonBackAt: client.wonBackAt || null,
  windows: {
    activeDays: ACTIVE_WINDOW_DAYS,
    lostDays: LOST_WINDOW_DAYS,
  },
});

const syncClientLifecycleFromPayments = async (clientOrId, options = {}) => {
  const now = options.now || new Date();
  const session = options.session || null;
  const client =
    typeof clientOrId === "object" && clientOrId?._id
      ? clientOrId
      : await Client.findById(clientOrId).session(session);

  if (!client) {
    throw buildServiceError("Client not found.", 404);
  }

  if (!client.business) {
    throw buildServiceError("Client business is required.", 400);
  }

  const previousStatus =
    client.lifecycleStatus || CLIENT_LIFECYCLE_STATUS.NEW;
  const { firstPaidVisitAt, lastPaidVisitAt } =
    await findFirstAndLastPaidVisit(client);
  const lifecycleStatus = deriveLifecycleStatus({
    firstPaidVisitAt,
    lastPaidVisitAt,
    previousStatus,
    now,
  });

  client.firstPaidVisitAt = firstPaidVisitAt;
  client.lastPaidVisitAt = lastPaidVisitAt;
  client.lifecycleStatus = lifecycleStatus;
  client.lifecycleUpdatedAt = now;

  if (
    lifecycleStatus === CLIENT_LIFECYCLE_STATUS.WON_BACK &&
    previousStatus === CLIENT_LIFECYCLE_STATUS.LOST
  ) {
    client.wonBackAt = lastPaidVisitAt || now;
  }

  if (lifecycleStatus === CLIENT_LIFECYCLE_STATUS.NEW) {
    client.wonBackAt = null;
  }

  await client.save(session ? { session } : undefined);

  return serializeClientLifecycle(client);
};

const syncClientLifecycleForOwner = async (user, clientId, options = {}) => {
  const { validClientId, business } = await findOwnedClientOrThrow(
    user,
    clientId
  );
  const client = await Client.findOne({
    _id: validClientId,
    business: business._id,
  });

  if (!client) {
    throw buildServiceError("Client not found.", 404);
  }

  return syncClientLifecycleFromPayments(client, options);
};

const syncClientLifecycleAfterPayment = async (payment, options = {}) => {
  if (
    !payment ||
    payment.paymentScope !== PAYMENT_SCOPE.COMMERCE_CHECKOUT ||
    !payment.client ||
    !payment.business
  ) {
    return null;
  }

  const client = await Client.findOne({
    _id: payment.client,
    business: payment.business,
  });

  if (!client) {
    return null;
  }

  return syncClientLifecycleFromPayments(client, options);
};

module.exports = {
  ACTIVE_WINDOW_DAYS,
  LOST_WINDOW_DAYS,
  CLIENT_LIFECYCLE_STATUS,
  PAID_VISIT_PAYMENT_STATUSES,
  deriveLifecycleStatus,
  serializeClientLifecycle,
  syncClientLifecycleFromPayments,
  syncClientLifecycleForOwner,
  syncClientLifecycleAfterPayment,
};
