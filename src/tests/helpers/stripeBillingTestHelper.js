const mockStripe = {
  webhooks: {
    constructEvent: jest.fn(),
  },
  checkout: {
    sessions: {
      create: jest.fn(),
      listLineItems: jest.fn(),
    },
  },
  subscriptions: {
    create: jest.fn(),
    retrieve: jest.fn(),
  },
  customers: {
    create: jest.fn(),
  },
};

const createWebhookResponse = () => {
  const res = {
    statusCode: 200,
    payload: null,
  };

  res.status = jest.fn((code) => {
    res.statusCode = code;
    return res;
  });

  res.send = jest.fn((payload) => {
    res.payload = payload;
    return res;
  });

  return res;
};

const createSubscriptionDeletedEvent = ({
  subscriptionId,
  customerId,
  businessId,
}) => ({
  type: "customer.subscription.deleted",
  data: {
    object: {
      id: subscriptionId,
      status: "canceled",
      customer: customerId,
      metadata: {
        businessId,
      },
    },
  },
});

const createSubscriptionUpdatedEvent = ({
  subscriptionId,
  customerId,
  businessId,
  status = "active",
}) => ({
  type: "customer.subscription.updated",
  data: {
    object: {
      id: subscriptionId,
      status,
      customer: customerId,
      metadata: businessId
        ? {
            businessId,
          }
        : {},
    },
  },
});

const buildInvoiceEvent = ({
  eventId,
  eventType,
  invoiceId,
  customerId,
  subscriptionId,
  businessId,
  currency = "eur",
  status,
  created = 1776556800,
  extraFields = {},
}) => ({
  id: eventId,
  type: eventType,
  data: {
    object: {
      id: invoiceId,
      customer: customerId,
      subscription: subscriptionId,
      currency,
      status,
      number: `INV-${invoiceId}`,
      created,
      parent: businessId
        ? {
            subscription_details: {
              metadata: {
                businessId,
              },
            },
          }
        : null,
      ...extraFields,
    },
  },
});

const createInvoicePaidEvent = ({
  eventId = "evt_invoice_paid",
  invoiceId = "in_test_paid",
  customerId = "cus_test_paid",
  subscriptionId = "sub_test_paid",
  businessId,
  amountPaid = 2900,
  currency = "eur",
  paidAt = 1776556800,
}) =>
  buildInvoiceEvent({
    eventId,
    eventType: "invoice.paid",
    invoiceId,
    customerId,
    subscriptionId,
    businessId,
    currency,
    extraFields: {
      amount_paid: amountPaid,
      status_transitions: {
        paid_at: paidAt,
      },
    },
  });

const createInvoicePaymentFailedEvent = ({
  eventId = "evt_invoice_failed",
  invoiceId = "in_test_failed",
  customerId = "cus_test_failed",
  subscriptionId = "sub_test_failed",
  businessId,
  amountDue = 2900,
  currency = "eur",
  created = 1776556800,
  status = "open",
}) =>
  buildInvoiceEvent({
    eventId,
    eventType: "invoice.payment_failed",
    invoiceId,
    customerId,
    subscriptionId,
    businessId,
    currency,
    created,
    status,
    extraFields: {
      amount_due: amountDue,
    },
  });

const createInvoiceVoidedEvent = ({
  eventId = "evt_invoice_voided",
  invoiceId = "in_test_voided",
  customerId = "cus_test_voided",
  subscriptionId = "sub_test_voided",
  businessId,
  amountDue = 2900,
  currency = "eur",
  created = 1776556800,
  status = "void",
}) =>
  buildInvoiceEvent({
    eventId,
    eventType: "invoice.voided",
    invoiceId,
    customerId,
    subscriptionId,
    businessId,
    currency,
    created,
    status,
    extraFields: {
      amount_due: amountDue,
    },
  });

const registerStripeBillingTestHooks = ({
  clearLegacyWebhookSecrets = false,
} = {}) => {
  const {
    connectCommerceTestDatabase,
    disconnectCommerceTestDatabase,
  } = require("./commerceFixture");

  beforeAll(async () => {
    await connectCommerceTestDatabase();
  });

  afterAll(async () => {
    await disconnectCommerceTestDatabase();
  });

  beforeEach(() => {
    process.env.STRIPE_WEBHOOK_SECRET = "whsec_canonical";
    if (clearLegacyWebhookSecrets) {
      delete process.env.WEBHOOK_SECRET_ONE;
      delete process.env.WEBHOOK_SECRET_TWO;
    }
    jest.resetAllMocks();
  });
};

module.exports = {
  mockStripe,
  createWebhookResponse,
  createSubscriptionDeletedEvent,
  createSubscriptionUpdatedEvent,
  createInvoicePaidEvent,
  createInvoicePaymentFailedEvent,
  createInvoiceVoidedEvent,
  registerStripeBillingTestHooks,
};
