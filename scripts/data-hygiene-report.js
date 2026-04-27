#!/usr/bin/env node

const mongoose = require("mongoose");
const {
  DEFAULT_RETENTION_DAYS,
  TTL_INDEX_NAME,
  connectToMongo,
  parseRetentionDaysValue,
  runCli,
  secondsFromDays,
} = require("./data-hygiene-shared");

mongoose.set("autoCreate", false);
mongoose.set("autoIndex", false);

const knownModelLoaders = [
  "../src/models/apiKey",
  "../src/models/appointment",
  "../src/models/auditing",
  "../src/models/backup",
  "../src/models/barberLink",
  "../src/models/capacityLock",
  "../src/models/cashSession",
  "../src/models/checkout",
  "../src/models/client",
  "../src/models/creditProduct",
  "../src/models/domainEvent",
  "../src/models/emailCampaign",
  "../src/models/featureSuggestion",
  "../src/models/flashSale",
  "../src/models/haircutGallery",
  "../src/models/note",
  "../src/models/payment",
  "../src/models/plan",
  "../src/models/promotion",
  "../src/models/refund",
  "../src/models/service",
  "../src/models/smsCampaign",
  "../src/models/staff",
  "../src/models/support",
  "../src/models/translationCache",
  "../src/models/User/billing",
  "../src/models/User/business",
  "../src/models/User/notification",
  "../src/models/User/user",
  "../src/models/waitlistEntry",
];

const parseArgs = (argv = []) => {
  const args = {
    retentionDays: DEFAULT_RETENTION_DAYS,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--retention-days") {
      args.retentionDays = parseRetentionDaysValue(argv[++index]);
    }
  }

  return args;
};

const loadKnownModels = () => {
  knownModelLoaders.forEach((modelPath) => {
    require(modelPath);
  });

  return new Set(
    mongoose.modelNames().map((modelName) => mongoose.model(modelName).collection.name)
  );
};

const getCollectionIndexes = async (db, collectionName) => {
  try {
    return await db.collection(collectionName).indexes();
  } catch (_) {
    return [];
  }
};

const hasTranslationCacheTtl = (
  indexes = [],
  expireAfterSeconds = secondsFromDays(DEFAULT_RETENTION_DAYS)
) =>
  indexes.some(
    (index) =>
      index.name === TTL_INDEX_NAME &&
      Number(index.expireAfterSeconds) === expireAfterSeconds &&
      index.key?.lastUsed === 1
  );

const inspectTranslationCache = async (db, retentionDays) => {
  const collection = db.collection("translationcaches");
  const indexes = await getCollectionIndexes(db, "translationcaches");
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);

  return {
    exists: true,
    count: await collection.countDocuments({}),
    olderThanRetentionCount: await collection.countDocuments({
      lastUsed: { $lt: cutoff },
    }),
    retentionDays,
    ttlIndexPresent: hasTranslationCacheTtl(
      indexes,
      secondsFromDays(retentionDays)
    ),
    indexes: indexes.map((index) => ({
      name: index.name,
      key: index.key,
      expireAfterSeconds: index.expireAfterSeconds,
    })),
  };
};

const inspectHaircutGalleries = async (db) => {
  const collection = db.collection("haircutgalleries");
  const invalidRequiredFilter = {
    $or: [
      { business: { $exists: false } },
      { business: null },
      { client: { $exists: false } },
      { client: null },
      { imageUrl: { $exists: false } },
      { imageUrl: "" },
      { title: { $exists: false } },
      { title: "" },
    ],
  };

  return {
    exists: true,
    count: await collection.countDocuments({}),
    invalidRequiredCount: await collection.countDocuments(invalidRequiredFilter),
    withoutBusinessCount: await collection.countDocuments({
      $or: [{ business: { $exists: false } }, { business: null }],
    }),
    withoutClientCount: await collection.countDocuments({
      $or: [{ client: { $exists: false } }, { client: null }],
    }),
    withoutImageUrlCount: await collection.countDocuments({
      $or: [{ imageUrl: { $exists: false } }, { imageUrl: "" }],
    }),
  };
};

const listDatabasesSafely = async (db) => {
  try {
    const result = await db.admin().listDatabases();
    return {
      allowed: true,
      databases: result.databases.map((database) => ({
        name: database.name,
        sizeOnDisk: database.sizeOnDisk,
        empty: database.empty,
      })),
    };
  } catch (error) {
    return {
      allowed: false,
      error: error.message,
      databases: [],
    };
  }
};

const buildDataHygieneReport = async ({ retentionDays = DEFAULT_RETENTION_DAYS } = {}) => {
  const db = mongoose.connection.db;
  const knownCollections = loadKnownModels();
  const collections = await db.listCollections().toArray();
  const collectionReports = [];

  for (const collection of collections) {
    if (collection.name.startsWith("system.")) {
      continue;
    }

    const count = await db.collection(collection.name).countDocuments({});
    collectionReports.push({
      name: collection.name,
      count,
      knownModel: knownCollections.has(collection.name),
    });
  }

  collectionReports.sort((left, right) => left.name.localeCompare(right.name));

  const collectionNames = new Set(collectionReports.map((collection) => collection.name));
  const databaseList = await listDatabasesSafely(db);

  return {
    generatedAt: new Date().toISOString(),
    database: db.databaseName,
    knownModelCollections: Array.from(knownCollections).sort(),
    collections: collectionReports,
    emptyCollections: collectionReports
      .filter((collection) => collection.count === 0)
      .map((collection) => collection.name),
    unknownCollections: collectionReports
      .filter((collection) => !collection.knownModel)
      .map((collection) => collection.name),
    externalDatabases: {
      listAllowed: databaseList.allowed,
      error: databaseList.error || null,
      sampleMflixPresent: databaseList.databases.some(
        (database) => database.name === "sample_mflix"
      ),
      databases: databaseList.databases,
    },
    translationCache: collectionNames.has("translationcaches")
      ? await inspectTranslationCache(db, retentionDays)
      : { exists: false },
    haircutGalleries: collectionNames.has("haircutgalleries")
      ? await inspectHaircutGalleries(db)
      : { exists: false },
  };
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  await connectToMongo({
    autoCreate: false,
    autoIndex: false,
  });

  try {
    const report = await buildDataHygieneReport(args);
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await mongoose.disconnect();
  }
};

if (require.main === module) {
  runCli(main);
}

module.exports = {
  DEFAULT_RETENTION_DAYS,
  buildDataHygieneReport,
  hasTranslationCacheTtl,
  parseArgs,
};
