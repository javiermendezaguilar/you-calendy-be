const PAYMENT_SCOPE = Object.freeze({
  COMMERCE_CHECKOUT: "commerce_checkout",
  COMMERCE_POLICY: "commerce_policy",
  PLATFORM_BILLING: "platform_billing",
});

const PAYMENT_PROVIDER = Object.freeze({
  INTERNAL: "internal",
  STRIPE: "stripe",
});

const buildCommercePaymentFilter = (filter = {}) => ({
  ...filter,
  paymentScope: PAYMENT_SCOPE.COMMERCE_CHECKOUT,
});

const buildPolicyPaymentFilter = (filter = {}) => ({
  ...filter,
  paymentScope: PAYMENT_SCOPE.COMMERCE_POLICY,
});

module.exports = {
  PAYMENT_SCOPE,
  PAYMENT_PROVIDER,
  buildCommercePaymentFilter,
  buildPolicyPaymentFilter,
};
