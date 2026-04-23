const COMMERCE_REPORTING_SCOPE = Object.freeze({
  domain: "commerce_checkout",
  owner: "business",
  excludes: ["platform_billing"],
});

const PLATFORM_BILLING_SCOPE = Object.freeze({
  domain: "platform_billing",
  owner: "platform",
  product: "saas_subscription",
});

module.exports = {
  COMMERCE_REPORTING_SCOPE,
  PLATFORM_BILLING_SCOPE,
};
