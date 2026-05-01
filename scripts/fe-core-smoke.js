#!/usr/bin/env node

const DEFAULT_BASE_URL = "http://localhost:8080";
const DEFAULT_TIMEOUT_MS = 15000;

const parseArgs = (argv) => {
  const args = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) continue;

    const [rawKey, inlineValue] = arg.slice(2).split("=", 2);
    const key = rawKey.replace(/-([a-z])/g, (_, char) => char.toUpperCase());

    if (inlineValue !== undefined) {
      args[key] = inlineValue;
      continue;
    }

    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      args[key] = next;
      index += 1;
    } else {
      args[key] = true;
    }
  }

  return args;
};

const toPositiveInteger = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
};

const normalizeBaseUrl = (value) => {
  const baseUrl = String(value || DEFAULT_BASE_URL).trim();
  const parsed = new URL(baseUrl);
  return parsed.toString().replace(/\/$/, "");
};

const truncate = (value, maxLength = 280) => {
  if (!value) return "";
  const normalized = String(value).replace(/\s+/g, " ").trim();
  return normalized.length > maxLength
    ? `${normalized.slice(0, maxLength - 3)}...`
    : normalized;
};

const safeJsonParse = (text) => {
  if (!text) return undefined;

  try {
    return JSON.parse(text);
  } catch (_error) {
    return undefined;
  }
};

const buildConfig = () => {
  const args = parseArgs(process.argv.slice(2));

  return {
    baseUrl: normalizeBaseUrl(
      args.baseUrl || process.env.SMOKE_BASE_URL || DEFAULT_BASE_URL
    ),
    timeoutMs: toPositiveInteger(
      args.timeoutMs || process.env.SMOKE_TIMEOUT_MS,
      DEFAULT_TIMEOUT_MS
    ),
    ownerToken: args.ownerToken || process.env.SMOKE_OWNER_TOKEN,
    clientToken: args.clientToken || process.env.SMOKE_CLIENT_TOKEN,
    businessId: args.businessId || process.env.SMOKE_BUSINESS_ID,
    serviceId: args.serviceId || process.env.SMOKE_SERVICE_ID,
    staffId: args.staffId || process.env.SMOKE_STAFF_ID,
    date: args.date || process.env.SMOKE_DATE,
    expectReady:
      String(args.expectReady || process.env.SMOKE_EXPECT_READY || "true") !==
      "false",
  };
};

const authHeader = (token) =>
  token
    ? {
        Authorization: `Bearer ${token}`,
      }
    : {};

const makeRequest = async (config, check) => {
  const url = new URL(check.path, config.baseUrl);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.timeoutMs);
  const startedAt = Date.now();

  try {
    const response = await fetch(url, {
      method: check.method || "GET",
      headers: {
        Accept: "application/json",
        ...authHeader(check.token),
        ...(check.headers || {}),
      },
      signal: controller.signal,
    });
    const text = await response.text();

    return {
      status: response.status,
      body: safeJsonParse(text),
      text,
      durationMs: Date.now() - startedAt,
    };
  } finally {
    clearTimeout(timeout);
  }
};

const validateBody = (check, response) => {
  if (check.success === undefined) return null;

  if (!response.body || response.body.success !== check.success) {
    return `expected body.success=${check.success}`;
  }

  return null;
};

const runCheck = async (config, check) => {
  if (check.skip) {
    return {
      name: check.name,
      skipped: true,
      reason: check.skip,
    };
  }

  try {
    const response = await makeRequest(config, check);
    const expectedStatuses = check.expectedStatuses || [200];
    const statusOk = expectedStatuses.includes(response.status);
    const bodyError = statusOk ? validateBody(check, response) : null;

    if (!statusOk || bodyError) {
      return {
        name: check.name,
        passed: false,
        status: response.status,
        durationMs: response.durationMs,
        expectedStatuses,
        error: bodyError || truncate(response.text),
      };
    }

    return {
      name: check.name,
      passed: true,
      status: response.status,
      durationMs: response.durationMs,
    };
  } catch (error) {
    return {
      name: check.name,
      passed: false,
      error: error.name === "AbortError" ? "request timeout" : error.message,
    };
  }
};

const buildChecks = (config) => {
  const checks = [
    {
      name: "health liveness",
      path: "/healthz",
      expectedStatuses: [200],
      success: true,
    },
    {
      name: "readiness",
      path: "/readyz",
      expectedStatuses: [200],
      success: true,
      skip: config.expectReady ? null : "SMOKE_EXPECT_READY=false",
    },
    {
      name: "auth bootstrap rejects anonymous session",
      path: "/auth/me",
      expectedStatuses: [401],
      success: false,
    },
    {
      name: "protected business rejects anonymous session",
      path: "/business",
      expectedStatuses: [401],
      success: false,
    },
    {
      name: "protected appointments rejects anonymous session",
      path: "/appointments",
      expectedStatuses: [401],
      success: false,
    },
    {
      name: "public services validates businessId",
      path: "/services?businessId=not-an-object-id",
      expectedStatuses: [400],
      success: false,
    },
    {
      name: "public service categories validates businessId",
      path: "/services/categories?businessId=not-an-object-id",
      expectedStatuses: [400],
      success: false,
    },
    {
      name: "public availability validates required query",
      path: "/appointments/available?businessId=not-an-object-id&serviceId=not-an-object-id&date=invalid-date",
      expectedStatuses: [400],
      success: false,
    },
    {
      name: "public plans validates plan id",
      path: "/plans/not-an-object-id",
      expectedStatuses: [400],
      success: false,
    },
    {
      name: "admin plan list rejects anonymous session",
      path: "/plans/admin/all",
      expectedStatuses: [401],
      success: false,
    },
  ];

  const ownerTokenMissing = config.ownerToken
    ? null
    : "SMOKE_OWNER_TOKEN not provided";

  checks.push(
    {
      name: "owner auth bootstrap",
      path: "/auth/me",
      token: config.ownerToken,
      expectedStatuses: [200],
      success: true,
      skip: ownerTokenMissing,
    },
    {
      name: "owner role permissions",
      path: "/auth/role-permissions",
      token: config.ownerToken,
      expectedStatuses: [200],
      success: true,
      skip: ownerTokenMissing,
    },
    {
      name: "owner business profile",
      path: "/business",
      token: config.ownerToken,
      expectedStatuses: [200],
      success: true,
      skip: ownerTokenMissing,
    },
    {
      name: "owner business settings",
      path: "/business/settings",
      token: config.ownerToken,
      expectedStatuses: [200],
      success: true,
      skip: ownerTokenMissing,
    },
    {
      name: "owner staff list",
      path: "/business/staff",
      token: config.ownerToken,
      expectedStatuses: [200],
      success: true,
      skip: ownerTokenMissing,
    },
    {
      name: "owner service catalog",
      path: "/business/services",
      token: config.ownerToken,
      expectedStatuses: [200],
      success: true,
      skip: ownerTokenMissing,
    },
    {
      name: "owner appointment list",
      path: "/appointments?limit=1",
      token: config.ownerToken,
      expectedStatuses: [200],
      success: true,
      skip: ownerTokenMissing,
    },
    {
      name: "owner operational dashboard",
      path: "/business/operational-dashboard",
      token: config.ownerToken,
      expectedStatuses: [200],
      success: true,
      skip: ownerTokenMissing,
    },
    {
      name: "owner operational reporting",
      path: "/business/operational-reporting",
      token: config.ownerToken,
      expectedStatuses: [200],
      success: true,
      skip: ownerTokenMissing,
    },
    {
      name: "owner payment summary",
      path: "/payment/summary",
      token: config.ownerToken,
      expectedStatuses: [200],
      success: true,
      skip: ownerTokenMissing,
    },
    {
      name: "owner payment reconciliation",
      path: "/payment/reconciliation",
      token: config.ownerToken,
      expectedStatuses: [200],
      success: true,
      skip: ownerTokenMissing,
    },
    {
      name: "owner cash active read model",
      path: "/cash-sessions/active",
      token: config.ownerToken,
      expectedStatuses: [200, 404],
      skip: ownerTokenMissing,
    }
  );

  const availabilityMissing =
    ownerTokenMissing ||
    (config.businessId && config.serviceId && config.date
      ? null
      : "SMOKE_BUSINESS_ID, SMOKE_SERVICE_ID and SMOKE_DATE not provided");

  const availabilityParams = new URLSearchParams({
    businessId: config.businessId || "",
    serviceId: config.serviceId || "",
    date: config.date || "",
  });
  if (config.staffId) availabilityParams.set("staffId", config.staffId);

  checks.push({
    name: "core availability happy path",
    path: `/appointments/available?${availabilityParams.toString()}`,
    token: config.ownerToken,
    expectedStatuses: [200],
    success: true,
    skip: availabilityMissing,
  });

  const clientTokenMissing = config.clientToken
    ? null
    : "SMOKE_CLIENT_TOKEN not provided";

  checks.push({
    name: "client profile bootstrap",
    path: "/client/profile",
    token: config.clientToken,
    expectedStatuses: [200],
    success: true,
    skip: clientTokenMissing,
  });

  return checks;
};

const printResult = (result) => {
  if (result.skipped) {
    console.log(`SKIP ${result.name} (${result.reason})`);
    return;
  }

  if (result.passed) {
    console.log(`PASS ${result.name} (${result.status}, ${result.durationMs}ms)`);
    return;
  }

  const expected = result.expectedStatuses
    ? ` expected ${result.expectedStatuses.join("/")}`
    : "";
  const status = result.status ? ` status ${result.status}` : "";
  const detail = result.error ? ` - ${result.error}` : "";
  console.error(`FAIL ${result.name}${status}${expected}${detail}`);
};

const main = async () => {
  const config = buildConfig();
  const checks = buildChecks(config);

  console.log(`FE core smoke target: ${config.baseUrl}`);
  console.log(`Timeout per check: ${config.timeoutMs}ms`);

  const results = [];
  for (const check of checks) {
    const result = await runCheck(config, check);
    printResult(result);
    results.push(result);
  }

  const failed = results.filter((result) => result.passed === false);
  const skipped = results.filter((result) => result.skipped);
  const passed = results.filter((result) => result.passed === true);

  console.log(
    `Summary: ${passed.length} passed, ${skipped.length} skipped, ${failed.length} failed`
  );

  if (failed.length > 0) {
    process.exitCode = 1;
  }
};

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});

