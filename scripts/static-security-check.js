#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const SENSITIVE_FILE_PATTERNS = Object.freeze([
  /^src\/utils\/fcm\.json$/i,
  /^src\/global-approach-.*\.json$/i,
  /(^|\/)(service[-_]?account|credential|credentials|private[-_]?key).*\.json$/i,
]);

const SCANNED_EXTENSIONS = Object.freeze([
  ".js",
  ".mjs",
  ".cjs",
  ".json",
  ".yml",
  ".yaml",
]);

const IGNORED_PATH_PREFIXES = Object.freeze([
  "node_modules/",
  "coverage/",
  "logs/",
  "src/tests/",
]);

const SECRET_PATTERNS = Object.freeze([
  {
    id: "private-key-block",
    regex: new RegExp(
      ["-----BEGIN ", "(?:RSA |EC |OPENSSH )?PRIVATE KEY", "-----"].join(""),
      "i"
    ),
  },
  {
    id: "google-service-account-private-key",
    regex: new RegExp(
      ['"private_key"\\s*:\\s*"', "-----BEGIN PRIVATE KEY", "-----"].join(""),
      "i"
    ),
  },
  {
    id: "mongodb-uri-with-password",
    regex: /mongodb(?:\+srv)?:\/\/[^"'\s:]+:[^"'\s@]+@/i,
  },
  {
    id: "stripe-live-secret",
    regex: /\b(?:sk|rk)_live_[A-Za-z0-9]{16,}\b/,
  },
  {
    id: "aws-access-key",
    regex: /\bAKIA[0-9A-Z]{16}\b/,
  },
  {
    id: "literal-secret-assignment",
    regex:
      /\b(?:secret|token|api[_-]?key|password|client[_-]?secret|private[_-]?key)\b\s*[:=]\s*["'][A-Za-z0-9_./+=-]{24,}["']/i,
  },
]);

const normalizePath = (filePath) => filePath.replace(/\\/g, "/");

const isIgnoredPath = (filePath) => {
  const normalized = normalizePath(filePath);
  return IGNORED_PATH_PREFIXES.some((prefix) => normalized.startsWith(prefix));
};

const isScannableFile = (filePath) => {
  const normalized = normalizePath(filePath);
  return (
    !isIgnoredPath(normalized) &&
    SCANNED_EXTENSIONS.includes(path.extname(normalized).toLowerCase())
  );
};

const getTrackedFiles = (repoRoot) =>
  execFileSync("git", ["ls-files"], {
    cwd: repoRoot,
    encoding: "utf8",
  })
    .split(/\r?\n/)
    .filter(Boolean)
    .map(normalizePath);

const findForbiddenTrackedFiles = (files) =>
  files
    .map(normalizePath)
    .filter((filePath) =>
      SENSITIVE_FILE_PATTERNS.some((pattern) => pattern.test(filePath))
    )
    .map((filePath) => ({
      id: "forbidden-sensitive-file",
      path: filePath,
      message: "Sensitive credential-like file must not be tracked.",
    }));

const scanContentForSecrets = (filePath, content) => {
  if (!isScannableFile(filePath)) {
    return [];
  }

  return SECRET_PATTERNS.filter((pattern) => pattern.regex.test(content)).map(
    (pattern) => ({
      id: pattern.id,
      path: normalizePath(filePath),
      message: "High-confidence secret pattern found in tracked runtime code.",
    })
  );
};

const scanTrackedFilesForSecrets = (repoRoot, files) =>
  files.flatMap((filePath) => {
    const absolutePath = path.join(repoRoot, filePath);
    if (!fs.existsSync(absolutePath)) {
      return [];
    }

    const content = fs.readFileSync(absolutePath, "utf8");
    return scanContentForSecrets(filePath, content);
  });

const checkWorkflowControlsFromText = ({ codeqlText, qualityText }) => {
  const findings = [];

  if (!/github\/codeql-action\/analyze@v4/.test(codeqlText)) {
    findings.push({
      id: "codeql-analyze-missing",
      path: ".github/workflows/codeql.yml",
      message: "CodeQL analyze step must remain enabled.",
    });
  }

  if (!/schedule:\s*\n\s*- cron:/m.test(codeqlText)) {
    findings.push({
      id: "codeql-schedule-missing",
      path: ".github/workflows/codeql.yml",
      message: "CodeQL must keep a scheduled run.",
    });
  }

  if (!/npm audit --audit-level=high/.test(qualityText)) {
    findings.push({
      id: "npm-audit-missing",
      path: ".github/workflows/quality.yml",
      message: "Backend Quality must keep high severity dependency audit.",
    });
  }

  if (!/npm run security:static/.test(qualityText)) {
    findings.push({
      id: "static-security-missing",
      path: ".github/workflows/quality.yml",
      message: "Backend Quality must run npm run security:static.",
    });
  }

  return findings;
};

const checkWorkflowControls = (repoRoot) => {
  const codeqlPath = path.join(repoRoot, ".github", "workflows", "codeql.yml");
  const qualityPath = path.join(repoRoot, ".github", "workflows", "quality.yml");

  return checkWorkflowControlsFromText({
    codeqlText: fs.readFileSync(codeqlPath, "utf8"),
    qualityText: fs.readFileSync(qualityPath, "utf8"),
  });
};

const runStaticSecurityCheck = (repoRoot = process.cwd()) => {
  const files = getTrackedFiles(repoRoot);
  const findings = [
    ...findForbiddenTrackedFiles(files),
    ...scanTrackedFilesForSecrets(repoRoot, files),
    ...checkWorkflowControls(repoRoot),
  ];

  return {
    success: findings.length === 0,
    scannedFiles: files.filter(isScannableFile).length,
    findings,
  };
};

const printResult = (result) => {
  console.log(
    JSON.stringify(
      {
        success: result.success,
        scannedFiles: result.scannedFiles,
        findings: result.findings,
      },
      null,
      2
    )
  );
};

const runCli = () => {
  const result = runStaticSecurityCheck();
  printResult(result);
  return result.success ? 0 : 1;
};

if (require.main === module) {
  process.exitCode = runCli();
}

module.exports = {
  checkWorkflowControlsFromText,
  findForbiddenTrackedFiles,
  isIgnoredPath,
  isScannableFile,
  normalizePath,
  runStaticSecurityCheck,
  scanContentForSecrets,
};
