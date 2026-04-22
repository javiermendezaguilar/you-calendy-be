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

const createInvoicePaidEvent = ({
  eventId = "evt_invoice_paid",
  invoiceId = "in_test_paid",
  customerId = "cus_test_paid",
  subscriptionId = "sub_test_paid",
  businessId,
  amountPaid = 2900,
  currency = "eur",
  paidAt = 1776556800,
}) => ({
  id: eventId,
  type: "invoice.paid",
  data: {
    object: {
      id: invoiceId,
      customer: customerId,
      subscription: subscriptionId,
      amount_paid: amountPaid,
      currency,
      number: `INV-${invoiceId}`,
      status_transitions: {
        paid_at: paidAt,
      },
      parent: {
        subscription_details: {
          metadata: {
            businessId,
          },
        },
      },
    },
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
    jest.clearAllMocks();
  });
};

module.exports = {
  mockStripe,
  createWebhookResponse,
  createSubscriptionDeletedEvent,
  createInvoicePaidEvent,
  registerStripeBillingTestHooks,
};
