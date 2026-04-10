const fs = require("fs");
const path = require("path");

function parseServiceAccountJson(rawValue) {
  if (!rawValue) return null;

  try {
    return JSON.parse(rawValue);
  } catch (error) {
    return null;
  }
}

function parseServiceAccountBase64(base64Value) {
  if (!base64Value) return null;

  try {
    const decoded = Buffer.from(base64Value, "base64").toString("utf8");
    return JSON.parse(decoded);
  } catch (error) {
    return null;
  }
}

function loadServiceAccount({
  jsonEnvVar,
  base64EnvVar,
  filePathEnvVar,
  fallbackPaths = [],
}) {
  const inlineJson = parseServiceAccountJson(process.env[jsonEnvVar]);
  if (inlineJson) {
    return {
      credentials: inlineJson,
      source: jsonEnvVar,
    };
  }

  const inlineBase64 = parseServiceAccountBase64(process.env[base64EnvVar]);
  if (inlineBase64) {
    return {
      credentials: inlineBase64,
      source: base64EnvVar,
    };
  }

  const configuredPath = process.env[filePathEnvVar];
  if (configuredPath) {
    const resolvedConfiguredPath = path.isAbsolute(configuredPath)
      ? configuredPath
      : path.resolve(process.cwd(), configuredPath);

    if (fs.existsSync(resolvedConfiguredPath)) {
      return {
        keyFilename: resolvedConfiguredPath,
        source: filePathEnvVar,
      };
    }
  }

  for (const candidate of fallbackPaths) {
    if (candidate && fs.existsSync(candidate)) {
      return {
        keyFilename: candidate,
        source: candidate,
      };
    }
  }

  return {
    credentials: null,
    keyFilename: null,
    source: null,
  };
}

function describeServiceAccountSource(source, fallbackPaths = []) {
  if (!source) return "not-configured";
  if (source.endsWith("_JSON")) return "env-json";
  if (source.endsWith("_BASE64")) return "env-base64";
  if (source.endsWith("_FILE")) return "env-file";
  if (fallbackPaths.includes(source)) return "file-fallback";
  return "unknown";
}

module.exports = {
  loadServiceAccount,
  describeServiceAccountSource,
};
