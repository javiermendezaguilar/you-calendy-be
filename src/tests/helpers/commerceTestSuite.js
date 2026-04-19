const {
  connectCommerceTestDatabase,
  disconnectCommerceTestDatabase,
} = require("./commerceFixture");

const setupCommerceTestSuite = () => {
  beforeAll(async () => {
    await connectCommerceTestDatabase();
  });

  afterAll(async () => {
    await disconnectCommerceTestDatabase();
  });
};

module.exports = {
  setupCommerceTestSuite,
};
