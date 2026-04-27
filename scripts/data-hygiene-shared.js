const mongoose = require("mongoose");

const DEFAULT_RETENTION_DAYS = 90;
const TTL_INDEX_NAME = "translation_cache_lastUsed_ttl_v1";

const secondsFromDays = (days) => days * 24 * 60 * 60;

const parseRetentionDaysValue = (value) => {
  const retentionDays = Number.parseInt(value, 10);
  if (!Number.isInteger(retentionDays) || retentionDays <= 0) {
    throw new Error("--retention-days must be a positive integer");
  }

  return retentionDays;
};

const requireMongoUri = () => {
  if (!process.env.MONGO_URI) {
    throw new Error("MONGO_URI is required");
  }

  return process.env.MONGO_URI;
};

const connectToMongo = async (options = {}) =>
  mongoose.connect(requireMongoUri(), {
    serverSelectionTimeoutMS: 15000,
    ...options,
  });

const runCli = (main) => {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
};

module.exports = {
  DEFAULT_RETENTION_DAYS,
  TTL_INDEX_NAME,
  connectToMongo,
  parseRetentionDaysValue,
  runCli,
  secondsFromDays,
};
