const {
  connectCommerceTestDatabase,
  disconnectCommerceTestDatabase,
} = require("./commerceFixture");

const waitForDeferredCleanup = () =>
  new Promise((resolve) => {
    setTimeout(resolve, 1100);
  });

const useCommerceTestDatabase = () => {
  beforeAll(async () => {
    await connectCommerceTestDatabase();
  });

  afterAll(async () => {
    await disconnectCommerceTestDatabase();
    await waitForDeferredCleanup();
  });
};

module.exports = {
  useCommerceTestDatabase,
  waitForDeferredCleanup,
};

