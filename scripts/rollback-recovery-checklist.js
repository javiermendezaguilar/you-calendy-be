#!/usr/bin/env node

const COMMON_POSTCHECKS = Object.freeze([
  "run production smoke no-write",
  "check /healthz and /readyz",
  "check Sentry and provider logs when relevant",
  "update SESSION_HANDOFF_CURRENT.md with cause, action and residual risk",
]);

const ROLLBACK_PLANS = Object.freeze({
  "railway-deploy": {
    description: "Backend deploy rollback or promote of last healthy Railway deployment.",
    severity: "high",
    prechecks: [
      "stop blind hotfix loop",
      "identify failing deployment id and last known healthy deployment id",
      "capture Railway logs, Sentry event and smoke failure",
      "confirm target environment before any promote or rollback",
    ],
    containment: [
      "prefer Railway rollback/promote to last healthy deployment for severe runtime breakage",
      "do not deploy a new fix before the failure is captured",
      "keep staging linked after validation work is done",
    ],
    recovery: [
      "promote or roll back to known healthy deployment",
      "rerun smoke against affected environment",
      "open follow-up fix branch from current main after containment",
    ],
    validation: COMMON_POSTCHECKS,
    evidence: ["deployment ids", "smoke summary", "log or Sentry reference"],
  },
  "env-vars": {
    description: "Environment variable rollback for secrets, CORS, URLs or provider config.",
    severity: "high",
    prechecks: [
      "identify exact variable diff and environment",
      "do not print secret values",
      "confirm whether failure is production-only or staging too",
      "capture failing endpoint and provider error shape",
    ],
    containment: [
      "restore previous known-good variable value from provider history or password manager",
      "avoid changing unrelated variables in same action",
      "restart or redeploy only the affected service if required",
    ],
    recovery: [
      "validate health/readiness",
      "validate auth/cookies/CORS or provider flow affected",
      "document variable name, not secret value",
    ],
    validation: COMMON_POSTCHECKS,
    evidence: ["variable names", "environment", "smoke summary"],
  },
  database: {
    description: "MongoDB data recovery, restore drill or bad migration containment.",
    severity: "critical",
    prechecks: [
      "stop writes if corruption or destructive migration is suspected",
      "identify affected collections, tenant ids and time window",
      "capture counts/read samples without exposing PII",
      "confirm backup or restore point before applying any write",
    ],
    containment: [
      "prefer targeted repair over full restore when blast radius is one tenant",
      "do not run destructive cleanup without explicit rollback path",
      "freeze related jobs/webhooks if they can amplify corruption",
    ],
    recovery: [
      "restore in staging or scratch environment first when possible",
      "compare counts and key read models",
      "apply production repair only with explicit scope and evidence",
    ],
    validation: [
      ...COMMON_POSTCHECKS,
      "read back affected collections",
      "verify business-critical read models",
    ],
    evidence: ["collection counts", "tenant ids or anonymized scope", "restore/repair note"],
  },
  webhooks: {
    description: "Stripe or provider webhook rollback and replay containment.",
    severity: "high",
    prechecks: [
      "identify provider event ids and endpoint",
      "classify duplicate, stale, failed signature or no-resolvable-business",
      "disable/repoint only if provider keeps causing damage",
      "capture idempotency keys and business_observability_signal when present",
    ],
    containment: [
      "do not replay events until idempotency expectation is clear",
      "use provider test mode or staging for reproduction",
      "pause only the broken endpoint if provider dashboard allows targeted action",
    ],
    recovery: [
      "restore endpoint secret or URL",
      "replay only selected events with known expected outcome",
      "reconcile payments/credits after replay",
    ],
    validation: [
      ...COMMON_POSTCHECKS,
      "verify provider dashboard delivery status",
      "verify idempotent outcome after replay",
    ],
    evidence: ["event ids", "provider endpoint", "idempotency outcome"],
  },
  domains: {
    description: "Domain, DNS, canonical URL or frontend/backend routing rollback.",
    severity: "high",
    prechecks: [
      "identify whether breakage is DNS, Vercel, Railway, CORS or cookie scope",
      "capture affected hostnames and status codes",
      "confirm canonical production hosts before change",
      "avoid changing DNS and app config at the same time unless required",
    ],
    containment: [
      "promote last healthy frontend/backend deployment when routing is app-level",
      "revert DNS/redirect/config to last known good value when infra-level",
      "keep legacy host behavior explicit: redirect, disabled or supported",
    ],
    recovery: [
      "validate / and /login for frontend when applicable",
      "validate api.groomnest.com health/readiness for backend",
      "validate CORS/cookies on canonical host",
    ],
    validation: COMMON_POSTCHECKS,
    evidence: ["hostnames", "deployment ids", "DNS/config change note"],
  },
});

const parseArgs = (argv = []) => {
  const options = { list: false, json: false, plan: null };

  for (const arg of argv) {
    if (arg === "--list") options.list = true;
    else if (arg === "--json") options.json = true;
    else if (!options.plan) options.plan = arg;
  }

  return options;
};

const listPlans = () =>
  Object.entries(ROLLBACK_PLANS).map(([name, plan]) => ({
    name,
    description: plan.description,
    severity: plan.severity,
  }));

const getPlan = (name) => {
  const plan = ROLLBACK_PLANS[name];
  if (!plan) {
    throw new Error(`Unknown rollback plan: ${name}`);
  }

  return { name, ...plan };
};

const printList = ({ json = false } = {}) => {
  const plans = listPlans();
  if (json) {
    console.log(JSON.stringify(plans, null, 2));
    return;
  }

  plans.forEach((plan) => {
    console.log(`${plan.name}: ${plan.description} (${plan.severity})`);
  });
};

const printItems = (title, items) => {
  console.log(`${title}:`);
  items.forEach((item) => console.log(`- ${item}`));
};

const printPlan = (plan, { json = false } = {}) => {
  if (json) {
    console.log(JSON.stringify(plan, null, 2));
    return;
  }

  console.log(`${plan.name}: ${plan.description}`);
  console.log(`severity: ${plan.severity}`);
  printItems("prechecks", plan.prechecks);
  printItems("containment", plan.containment);
  printItems("recovery", plan.recovery);
  printItems("validation", plan.validation);
  printItems("evidence", plan.evidence);
};

const runCli = (argv = process.argv.slice(2)) => {
  try {
    const options = parseArgs(argv);
    if (options.list || !options.plan) {
      printList({ json: options.json });
      return 0;
    }

    printPlan(getPlan(options.plan), { json: options.json });
    return 0;
  } catch (error) {
    console.error(error.message);
    return 1;
  }
};

if (require.main === module) {
  process.exitCode = runCli();
}

module.exports = {
  COMMON_POSTCHECKS,
  ROLLBACK_PLANS,
  getPlan,
  listPlans,
  parseArgs,
  runCli,
};
