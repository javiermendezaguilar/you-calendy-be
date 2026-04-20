const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

const OUTPUT_ROOT = path.join(os.tmpdir(), "groomnest-jscpd-quality");
const CURRENT_REPORT_DIR = path.join(OUTPUT_ROOT, "current");
const BASE_REPORT_DIR = path.join(OUTPUT_ROOT, "base");
const BASE_WORKTREE_DIR = path.join(OUTPUT_ROOT, "base-worktree");
const EPSILON = 0.01;

const rmIfExists = (targetPath) => {
  fs.rmSync(targetPath, { recursive: true, force: true });
};

const run = (command, args, options = {}) => {
  return execFileSync(command, args, {
    stdio: "pipe",
    encoding: "utf8",
    ...options,
  }).trim();
};

const runStreaming = (command, args, options = {}) => {
  execFileSync(command, args, {
    stdio: "inherit",
    ...options,
  });
};

const runNpxStreaming = (args, options = {}) => {
  if (process.platform === "win32") {
    const commandString = ["npx", ...args].join(" ");
    return runStreaming(process.env.ComSpec || "cmd.exe", ["/d", "/s", "/c", commandString], options);
  }

  return runStreaming("npx", args, options);
};

const ensureBaseRef = () => {
  const baseRef = process.env.QUALITY_BASE_REF || process.env.GITHUB_BASE_REF;

  if (!baseRef) {
    console.log("Skipping jscpd non-regression check: no base ref configured.");
    process.exit(0);
  }

  return baseRef.startsWith("origin/") ? baseRef : `origin/${baseRef}`;
};

const readPercentage = (reportDir) => {
  const reportPath = path.join(reportDir, "jscpd-report.json");
  const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
  return report.statistics.total.percentage;
};

const measurePercentage = (cwd, reportDir) => {
  rmIfExists(reportDir);
  runNpxStreaming(
    [
      "jscpd",
      "--threshold",
      "100",
      "--gitignore",
      "--reporters",
      "json",
      "--output",
      reportDir,
      "src",
    ],
    { cwd }
  );

  return readPercentage(reportDir);
};

const main = () => {
  const repoRoot = process.cwd();
  const baseRef = ensureBaseRef();

  rmIfExists(OUTPUT_ROOT);
  fs.mkdirSync(OUTPUT_ROOT, { recursive: true });

  const mergeBase = run("git", ["merge-base", "HEAD", baseRef], {
    cwd: repoRoot,
  });

  let basePercentage;
  let currentPercentage;

  try {
    runStreaming("git", ["worktree", "add", "--detach", BASE_WORKTREE_DIR, mergeBase], {
      cwd: repoRoot,
    });

    basePercentage = measurePercentage(BASE_WORKTREE_DIR, BASE_REPORT_DIR);
    currentPercentage = measurePercentage(repoRoot, CURRENT_REPORT_DIR);
  } finally {
    try {
      runStreaming("git", ["worktree", "remove", "--force", BASE_WORKTREE_DIR], {
        cwd: repoRoot,
      });
    } catch (_) {
      rmIfExists(BASE_WORKTREE_DIR);
    }

    rmIfExists(CURRENT_REPORT_DIR);
    rmIfExists(BASE_REPORT_DIR);
  }

  console.log(
    `jscpd baseline comparison: base=${basePercentage.toFixed(2)}%, current=${currentPercentage.toFixed(2)}%`
  );

  if (currentPercentage > basePercentage + EPSILON) {
    console.error(
      `Quality regression detected: duplication increased from ${basePercentage.toFixed(2)}% to ${currentPercentage.toFixed(2)}%.`
    );
    process.exit(1);
  }

  console.log("jscpd non-regression check passed.");
};

main();
