#!/usr/bin/env node

const { spawnSync } = require("child_process");

const JEST_SETUP_ARGS = ["--setupFilesAfterEnv", "./src/tests/setup.js", "--runInBand"];

const RISK_TEST_GROUPS = Object.freeze({
  contract: {
    description: "API contracts, input validation, response wrappers and FE-ready tooling.",
    tests: [
      "src/tests/apiErrorResponseConsistencyV1.test.js",
      "src/tests/adminInputValidationV1.test.js",
      "src/tests/appointmentInputValidationV1.test.js",
      "src/tests/authCookieOptionsV1.test.js",
      "src/tests/authInputValidationV1.test.js",
      "src/tests/commerceInputValidationV1.test.js",
      "src/tests/csrfProtection.test.js",
      "src/tests/feCoreStagingSeedScriptV1.test.js",
      "src/tests/serviceInputValidationV1.test.js",
    ],
  },
  "auth-permissions": {
    description: "Session resolution, actor context, role matrix and tenant ownership.",
    tests: [
      "src/tests/authActorContextV1.test.js",
      "src/tests/authClientGalleryAuthorizationV1.test.js",
      "src/tests/authSessionConsolidationV1.test.js",
      "src/tests/appointmentPermissionsV1.test.js",
      "src/tests/commercePermissionsV2.test.js",
      "src/tests/rolePermissionMatrixV1.test.js",
      "src/tests/tenantOwnershipV1.test.js",
    ],
  },
  appointments: {
    description: "Booking, availability, visit state, capacity and operational agenda.",
    tests: [
      "src/tests/appointmentCapacityConcurrencyV1.test.js",
      "src/tests/appointmentEventMapV2.test.js",
      "src/tests/appointmentListPaginationV1.test.js",
      "src/tests/appointmentPolicyOutcomeV1.test.js",
      "src/tests/appointmentPolicyV2.test.js",
      "src/tests/appointmentSemanticStatus.test.js",
      "src/tests/appointmentStateContractV1.test.js",
      "src/tests/availabilityEngineV1.test.js",
      "src/tests/bookingEventMapV3.test.js",
      "src/tests/checkInV1.test.js",
      "src/tests/noShowBlock.test.js",
      "src/tests/waitlistV1.test.js",
      "src/tests/walkInQueueV2.test.js",
      "src/tests/walkInV1.test.js",
    ],
  },
  commerce: {
    description: "Checkout, payment, refunds, voids, cash sessions, rebooking and revenue.",
    tests: [
      "src/tests/cashSessionV1.test.js",
      "src/tests/checkoutStateContractV1.test.js",
      "src/tests/checkoutV1.test.js",
      "src/tests/financialReconciliationV1.test.js",
      "src/tests/legacyRevenueCanonicalPhase3V1.test.js",
      "src/tests/paymentProviderAdaptersV1.test.js",
      "src/tests/paymentRefundV1.test.js",
      "src/tests/paymentSummaryV1.test.js",
      "src/tests/paymentV1.test.js",
      "src/tests/paymentVoidV1.test.js",
      "src/tests/policyChargesV1.test.js",
      "src/tests/rebookingV1.test.js",
      "src/tests/topBarbersCanonicalRevenueV1.test.js",
      "src/tests/visitServiceSnapshotV1.test.js",
    ],
  },
  billing: {
    description: "SaaS billing, credits, Stripe webhooks and economic rate limits.",
    tests: [
      "src/tests/creditAwareMessaging.test.js",
      "src/tests/creditManagerV1.test.js",
      "src/tests/economicRateLimitV1.test.js",
      "src/tests/planEntitlementsV1.test.js",
      "src/tests/stripeSubscriptionStatusV2.test.js",
      "src/tests/stripeWebhookV1.test.js",
    ],
  },
  "integrations-jobs": {
    description: "External providers, messaging, media, translation and async-like helpers.",
    tests: [
      "src/tests/cloudinaryMediaGovernanceV1.test.js",
      "src/tests/emailCampaignOptOutV1.test.js",
      "src/tests/googleServiceAccountAuthV1.test.js",
      "src/tests/pushNotificationAuthLibraryV1.test.js",
      "src/tests/sendMailBrevoProviderV1.test.js",
      "src/tests/smsCampaignOptOutV1.test.js",
      "src/tests/translatorRestClientV1.test.js",
      "src/tests/twilioRestClientV1.test.js",
    ],
  },
  "data-ops": {
    description: "Health, hygiene, observability, reporting, dashboard and lifecycle data.",
    tests: [
      "src/tests/adminRevenueProjectionV1.test.js",
      "src/tests/appointmentRevenueProjectionV1.test.js",
      "src/tests/businessObservabilityV1.test.js",
      "src/tests/businessServicesSourceOfTruth.test.js",
      "src/tests/clientLifecycleConsentV1.test.js",
      "src/tests/clientListPaginationV1.test.js",
      "src/tests/clientNotesCompatibility.test.js",
      "src/tests/dataHygieneV1.test.js",
      "src/tests/domainEventV1.test.js",
      "src/tests/healthV1.test.js",
      "src/tests/onboardingBackendV1.test.js",
      "src/tests/operationalDashboardV1.test.js",
      "src/tests/operationalReportingV1.test.js",
      "src/tests/visitSemanticLayerV1.test.js",
    ],
  },
  smoke: {
    description: "Runtime smoke against a real URL; execute with npm run smoke:fe-core.",
    command: "npm run smoke:fe-core",
    tests: [],
  },
});

const parseArgs = (argv = []) => {
  const options = {
    list: false,
    json: false,
    dryRun: false,
    groups: [],
  };

  for (const arg of argv) {
    if (arg === "--list") options.list = true;
    else if (arg === "--json") options.json = true;
    else if (arg === "--dry-run") options.dryRun = true;
    else options.groups.push(arg);
  }

  return options;
};

const listGroups = () =>
  Object.entries(RISK_TEST_GROUPS).map(([name, group]) => ({
    name,
    description: group.description,
    tests: group.tests.length,
    command: group.command || "jest",
  }));

const assertKnownGroups = (groupNames) => {
  const unknownGroups = groupNames.filter((name) => !RISK_TEST_GROUPS[name]);
  if (unknownGroups.length > 0) {
    throw new Error(`Unknown test risk group: ${unknownGroups.join(", ")}`);
  }
};

const getJestTestsForGroups = (groupNames) => {
  assertKnownGroups(groupNames);

  return [
    ...new Set(
      groupNames.flatMap((name) => RISK_TEST_GROUPS[name].tests || [])
    ),
  ];
};

const buildJestArgs = (groupNames) => {
  const tests = getJestTestsForGroups(groupNames);
  if (tests.length === 0) {
    throw new Error(
      `Selected group has no Jest tests. Use its documented command instead.`
    );
  }

  return [...tests, ...JEST_SETUP_ARGS];
};

const printGroupList = ({ json = false } = {}) => {
  const groups = listGroups();

  if (json) {
    console.log(JSON.stringify(groups, null, 2));
    return;
  }

  groups.forEach((group) => {
    console.log(`${group.name}: ${group.description}`);
    console.log(`  command: ${group.command}`);
    console.log(`  tests: ${group.tests}`);
  });
};

const runJestGroups = (groupNames, { dryRun = false } = {}) => {
  const jestArgs = buildJestArgs(groupNames);
  const command = process.execPath;
  const args = [require.resolve("jest/bin/jest"), ...jestArgs];

  if (dryRun) {
    console.log([command, ...args].join(" "));
    return 0;
  }

  const result = spawnSync(command, args, {
    stdio: "inherit",
    shell: false,
  });

  if (result.error) {
    console.error(result.error.message);
    return 1;
  }

  return typeof result.status === "number" ? result.status : 1;
};

const runCli = (argv = process.argv.slice(2)) => {
  try {
    const options = parseArgs(argv);

    if (options.list || options.groups.length === 0) {
      printGroupList({ json: options.json });
      return options.groups.length === 0 && !options.list ? 1 : 0;
    }

    return runJestGroups(options.groups, { dryRun: options.dryRun });
  } catch (error) {
    console.error(error.message);
    return 1;
  }
};

if (require.main === module) {
  process.exitCode = runCli();
}

module.exports = {
  RISK_TEST_GROUPS,
  buildJestArgs,
  getJestTestsForGroups,
  listGroups,
  parseArgs,
  runJestGroups,
  runCli,
};
