const Business = require("../models/User/business");
const {
  connectCommerceTestDatabase,
  disconnectCommerceTestDatabase,
  createCommerceFixture,
} = require("./helpers/commerceFixture");
const {
  deductSmsCredits,
  deductEmailCredits,
  addSmsCredits,
  addEmailCredits,
} = require("../utils/creditManager");

const expectOneConcurrentDeduction = async ({
  business,
  creditField,
  deductCredit,
}) => {
  const results = await Promise.allSettled([
    deductCredit(business._id, 1),
    deductCredit(business._id, 1),
  ]);
  const updatedBusiness = await Business.findById(business._id).lean();

  expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
  expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
  expect(updatedBusiness[creditField]).toBe(0);
};

beforeAll(async () => {
  await connectCommerceTestDatabase();
});

afterAll(async () => {
  await disconnectCommerceTestDatabase();
});

describe("creditManager v1", () => {
  test("allows only one concurrent SMS deduction to consume the last credit", async () => {
    const fixture = await createCommerceFixture({
      ownerName: "SMS Credit Owner",
      ownerEmail: "sms-credit-owner@example.com",
      businessName: "SMS Credit Shop",
    });

    fixture.business.smsCredits = 1;
    await fixture.business.save();

    await expectOneConcurrentDeduction({
      business: fixture.business,
      creditField: "smsCredits",
      deductCredit: deductSmsCredits,
    });
  });

  test("allows only one concurrent email deduction to consume the last credit", async () => {
    const fixture = await createCommerceFixture({
      ownerName: "Email Credit Owner",
      ownerEmail: "email-credit-owner@example.com",
      businessName: "Email Credit Shop",
    });

    fixture.business.emailCredits = 1;
    await fixture.business.save();

    await expectOneConcurrentDeduction({
      business: fixture.business,
      creditField: "emailCredits",
      deductCredit: deductEmailCredits,
    });
  });

  test("rejects invalid credit amounts without mutating balances", async () => {
    const fixture = await createCommerceFixture({
      ownerName: "Invalid Credit Owner",
      ownerEmail: "invalid-credit-owner@example.com",
      businessName: "Invalid Credit Shop",
    });

    fixture.business.smsCredits = 5;
    fixture.business.emailCredits = 7;
    await fixture.business.save();

    await expect(deductSmsCredits(fixture.business._id, -1)).rejects.toThrow(
      "positive integer"
    );
    await expect(deductEmailCredits(fixture.business._id, 0)).rejects.toThrow(
      "positive integer"
    );
    await expect(addSmsCredits(fixture.business._id, -10)).rejects.toThrow(
      "non-negative integer"
    );
    await expect(addEmailCredits(fixture.business._id, 1.5)).rejects.toThrow(
      "non-negative integer"
    );

    const updatedBusiness = await Business.findById(fixture.business._id).lean();

    expect(updatedBusiness.smsCredits).toBe(5);
    expect(updatedBusiness.emailCredits).toBe(7);
  });
});
