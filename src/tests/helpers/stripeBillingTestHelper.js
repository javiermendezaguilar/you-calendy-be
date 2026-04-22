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
  registerStripeBillingTestHooks,
};
