#!/usr/bin/env node

const GOLDEN_PATHS = Object.freeze([
  {
    name: "booking",
    purpose: "Reserva y disponibilidad no deben permitir overbooking.",
    checks: ["appointments", "contract", "staging smoke with seed when runtime changes"],
  },
  {
    name: "payment-refund",
    purpose: "Cobros, refunds y voids no deben duplicar ni perder dinero.",
    checks: ["commerce", "billing when Stripe/credits are touched", "idempotency/concurrency evidence"],
  },
  {
    name: "rebooking",
    purpose: "Reagendar debe liberar/capturar capacidad y preservar contexto comercial.",
    checks: ["appointments", "commerce", "staging smoke with seed"],
  },
  {
    name: "cash-session",
    purpose: "Caja debe cerrar sin descuadres silenciosos.",
    checks: ["commerce", "data-ops", "read model verification"],
  },
  {
    name: "permissions",
    purpose: "Roles y tenant ownership no deben filtrar negocio ajeno.",
    checks: ["auth-permissions", "contract", "401/403/404 evidence"],
  },
]);

const VALIDATION_PROFILES = Object.freeze({
  "docs-tooling": {
    description: "Documentation, local scripts or non-runtime tooling.",
    stagingRequired: false,
    local: [
      "git diff --check",
      "node --check for touched scripts",
      "directed tests for touched tooling",
      "npm audit --audit-level=high when package or CI changes",
    ],
    ci: ["GitHub quality", "CodeQL/Analyze when PR opens"],
    staging: ["not required unless tooling changes deployment/runtime behavior"],
    production: ["production smoke no-write if backend main changed"],
    evidence: ["PR checks", "local command output summary", "docs updated"],
  },
  "normal-backend": {
    description: "Backend logic with limited blast radius and no money/permissions/data migration.",
    stagingRequired: false,
    local: [
      "npm run test:risk -- --list",
      "target risk group from docs/tecnica/Test-Suites-Por-Riesgo.md",
      "npm audit --audit-level=high",
      "QUALITY_BASE_REF=main node scripts/check-jscpd-regression.js",
      "git diff --check",
    ],
    ci: ["GitHub quality", "CodeQL/Analyze"],
    staging: ["use staging smoke if endpoint contract or runtime behavior changes"],
    production: ["npm run smoke:fe-core -- --base-url https://api.groomnest.com"],
    evidence: ["risk group chosen", "CI green", "production no-write smoke summary"],
  },
  "sensitive-business": {
    description: "Money, appointments, refunds, cash, credits, permissions or tenant isolation.",
    stagingRequired: true,
    local: [
      "write or reference the business rule first",
      "npm run test:risk -- contract",
      "npm run test:risk -- auth-permissions when roles or ownership are touched",
      "npm run test:risk -- appointments when agenda/capacity is touched",
      "npm run test:risk -- commerce when checkout/payment/refund/cash/rebooking is touched",
      "npm run test:risk -- billing when Stripe, credits or plan limits are touched",
      "validate idempotency/concurrency when the action can repeat",
      "npm audit --audit-level=high",
      "QUALITY_BASE_REF=main node scripts/check-jscpd-regression.js",
      "git diff --check",
    ],
    ci: ["GitHub quality", "CodeQL/Analyze"],
    staging: [
      "railway status must show project you-calendy-be, environment staging, service you-calendy-be",
      "railway run -- npm run seed:fe-core-staging -- --dry-run",
      "railway run -- npm run seed:fe-core-staging -- --confirm staging-fixture when authenticated smoke needs seed data",
      "npm run smoke:fe-core with staging base URL and seed variables when tokens/data are available",
      "manual log/Sentry check when the change emits operational signals",
    ],
    production: ["npm run smoke:fe-core -- --base-url https://api.groomnest.com"],
    evidence: ["business rule", "risk groups", "staging smoke summary", "production no-write smoke summary"],
  },
  "data-migration": {
    description: "Schema, migration, backup, restore or data hygiene changes.",
    stagingRequired: true,
    local: [
      "migration/data script dry-run",
      "targeted data tests",
      "consistency check against docs/tecnica/Modelo-Datos.md",
      "rollback note before writes",
      "git diff --check",
    ],
    ci: ["GitHub quality", "CodeQL/Analyze"],
    staging: [
      "run dry-run in Railway staging before apply",
      "apply only with explicit staging confirmation",
      "read back affected collections",
      "run smoke for affected read models",
    ],
    production: ["no production write without explicit scope and rollback path"],
    evidence: ["dry-run output", "affected collection counts", "rollback note"],
  },
  "external-integration": {
    description: "Stripe, email, SMS, Cloudinary, translation or provider boundary.",
    stagingRequired: true,
    local: [
      "provider contract tests or sandbox mocks",
      "risk group integrations-jobs, billing or commerce as applicable",
      "no secrets in diff",
      "npm audit --audit-level=high",
      "git diff --check",
    ],
    ci: ["GitHub quality", "CodeQL/Analyze"],
    staging: [
      "use provider test mode or no-write smoke",
      "verify retry/idempotency behavior when provider can resend",
      "check logs for normalized provider error shape",
    ],
    production: ["production no-write smoke only unless user explicitly approves real effect"],
    evidence: ["provider mode used", "retry/idempotency note", "logs/Sentry note if applicable"],
  },
  "deploy-runtime": {
    description: "Runtime, env vars, cookies, CORS, Railway/Vercel deploy or health/readiness.",
    stagingRequired: true,
    local: [
      "node --check touched scripts/config when applicable",
      "contract/auth tests when cookies/CORS/session are touched",
      "git diff --check",
    ],
    ci: ["GitHub quality", "CodeQL/Analyze"],
    staging: [
      "railway status before deploy",
      "railway up --detach for staging manual deploy",
      "railway deployment list --limit 3 shows SUCCESS",
      "smoke staging no-write or authenticated depending on risk",
    ],
    production: ["confirm auto-deploy or manual promote", "production no-write smoke", "rollback target known"],
    evidence: ["deployment id", "staging smoke summary", "production smoke summary"],
  },
  "fe-contract": {
    description: "Backend contract consumed directly by the FE core.",
    stagingRequired: true,
    local: [
      "npm run test:risk -- contract",
      "risk group for affected domain",
      "update docs/tecnica/API-FE-Core-Contratos.md when shape changes",
      "git diff --check",
    ],
    ci: ["GitHub quality", "CodeQL/Analyze"],
    staging: [
      "seed FE core data when authenticated checks are needed",
      "npm run smoke:fe-core against staging",
      "verify 400/401/403/404 shapes that FE will branch on",
    ],
    production: ["production no-write smoke"],
    evidence: ["contract doc updated", "staging smoke summary", "production smoke summary"],
  },
});

const parseArgs = (argv = []) => {
  const options = { list: false, json: false, profile: null };

  for (const arg of argv) {
    if (arg === "--list") options.list = true;
    else if (arg === "--json") options.json = true;
    else if (!options.profile) options.profile = arg;
  }

  return options;
};

const listProfiles = () =>
  Object.entries(VALIDATION_PROFILES).map(([name, profile]) => ({
    name,
    description: profile.description,
    stagingRequired: profile.stagingRequired,
  }));

const getProfile = (name) => {
  const profile = VALIDATION_PROFILES[name];
  if (!profile) {
    throw new Error(`Unknown staging validation profile: ${name}`);
  }

  return { name, ...profile };
};

const printList = ({ json = false } = {}) => {
  const profiles = listProfiles();
  if (json) {
    console.log(JSON.stringify(profiles, null, 2));
    return;
  }

  profiles.forEach((profile) => {
    const staging = profile.stagingRequired ? "staging required" : "staging optional";
    console.log(`${profile.name}: ${profile.description} (${staging})`);
  });
};

const printItems = (title, items) => {
  console.log(`${title}:`);
  items.forEach((item) => console.log(`- ${item}`));
};

const printProfile = (profile, { json = false } = {}) => {
  if (json) {
    console.log(JSON.stringify({ ...profile, goldenPaths: GOLDEN_PATHS }, null, 2));
    return;
  }

  console.log(`${profile.name}: ${profile.description}`);
  console.log(`staging: ${profile.stagingRequired ? "required" : "optional"}`);
  printItems("local", profile.local);
  printItems("ci", profile.ci);
  printItems("staging", profile.staging);
  printItems("production", profile.production);
  printItems("evidence", profile.evidence);
};

const runCli = (argv = process.argv.slice(2)) => {
  try {
    const options = parseArgs(argv);

    if (options.list || !options.profile) {
      printList({ json: options.json });
      return 0;
    }

    printProfile(getProfile(options.profile), { json: options.json });
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
  GOLDEN_PATHS,
  VALIDATION_PROFILES,
  getProfile,
  listProfiles,
  parseArgs,
  runCli,
};
