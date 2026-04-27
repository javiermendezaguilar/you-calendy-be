#!/usr/bin/env node

const mongoose = require("mongoose");
const {
  DEFAULT_RETENTION_DAYS,
  HAIRCUT_GALLERY_CONFIRMATION,
  INVALID_HAIRCUT_GALLERY_FILTER,
  TTL_INDEX_NAME,
  connectToMongo,
  parseRetentionDaysValue,
  runCli,
  secondsFromDays,
} = require("./data-hygiene-shared");

const parseArgs = (argv = []) => {
  const args = {
    apply: false,
    confirm: "",
    deactivateInvalidHaircutGalleries: false,
    dropSampleMflix: false,
    ensureTranslationCacheTtl: false,
    retentionDays: DEFAULT_RETENTION_DAYS,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--apply") {
      args.apply = true;
    } else if (arg === "--confirm") {
      args.confirm = argv[++index] || "";
    } else if (arg === "--deactivate-invalid-haircut-galleries") {
      args.deactivateInvalidHaircutGalleries = true;
    } else if (arg === "--drop-sample-mflix") {
      args.dropSampleMflix = true;
    } else if (arg === "--ensure-translation-cache-ttl") {
      args.ensureTranslationCacheTtl = true;
    } else if (arg === "--retention-days") {
      args.retentionDays = parseRetentionDaysValue(argv[++index]);
    }
  }

  return args;
};

const validatePlan = (args) => {
  const actions = [];

  if (args.ensureTranslationCacheTtl) {
    actions.push({
      type: "ensure_translation_cache_ttl",
      collection: "translationcaches",
      indexName: TTL_INDEX_NAME,
      expireAfterSeconds: secondsFromDays(args.retentionDays),
    });
  }

  if (args.dropSampleMflix) {
    if (args.confirm !== "sample_mflix") {
      throw new Error(
        "--drop-sample-mflix requires --confirm sample_mflix"
      );
    }

    actions.push({
      type: "drop_database",
      database: "sample_mflix",
    });
  }

  if (args.deactivateInvalidHaircutGalleries) {
    if (args.apply && args.confirm !== HAIRCUT_GALLERY_CONFIRMATION) {
      throw new Error(
        "--deactivate-invalid-haircut-galleries with --apply requires --confirm haircutgalleries"
      );
    }

    actions.push({
      type: "deactivate_invalid_haircut_galleries",
      collection: "haircutgalleries",
      filter: {
        ...INVALID_HAIRCUT_GALLERY_FILTER,
        isActive: true,
      },
    });
  }

  if (actions.length === 0) {
    throw new Error(
      "No action selected. Use --ensure-translation-cache-ttl, --deactivate-invalid-haircut-galleries or --drop-sample-mflix"
    );
  }

  return {
    apply: args.apply,
    dryRun: !args.apply,
    actions,
  };
};

const ensureTranslationCacheTtl = async (db, action) => {
  if (!action.apply) {
    return {
      action: action.type,
      applied: false,
      dryRun: true,
    };
  }

  const indexName = await db.collection("translationcaches").createIndex(
    { lastUsed: 1 },
    {
      expireAfterSeconds: action.expireAfterSeconds,
      name: TTL_INDEX_NAME,
      background: true,
    }
  );

  return {
    action: action.type,
    applied: true,
    indexName,
    expireAfterSeconds: action.expireAfterSeconds,
  };
};

const dropSampleMflix = async (client, action) => {
  if (!action.apply) {
    return {
      action: action.type,
      database: action.database,
      applied: false,
      dryRun: true,
    };
  }

  const sampleDb = client.db("sample_mflix");
  const result = await sampleDb.dropDatabase();
  return {
    action: action.type,
    database: action.database,
    applied: true,
    result,
  };
};

const deactivateInvalidHaircutGalleries = async (db, action) => {
  const collection = db.collection("haircutgalleries");
  const matchedCount = await collection.countDocuments(action.filter);

  if (!action.apply) {
    return {
      action: action.type,
      collection: action.collection,
      matchedCount,
      applied: false,
      dryRun: true,
    };
  }

  const result = await collection.updateMany(action.filter, {
    $set: {
      isActive: false,
      "dataHygiene.deactivatedAt": new Date(),
      "dataHygiene.reason": "missing_required_gallery_fields",
    },
  });

  return {
    action: action.type,
    collection: action.collection,
    matchedCount,
    applied: true,
    modifiedCount: result.modifiedCount,
  };
};

const executePlan = async (plan) => {
  const db = mongoose.connection.db;
  const client = mongoose.connection.getClient();
  const results = [];

  for (const rawAction of plan.actions) {
    const action = { ...rawAction, apply: plan.apply };
    if (action.type === "ensure_translation_cache_ttl") {
      results.push(await ensureTranslationCacheTtl(db, action));
    } else if (action.type === "deactivate_invalid_haircut_galleries") {
      results.push(await deactivateInvalidHaircutGalleries(db, action));
    } else if (action.type === "drop_database") {
      results.push(await dropSampleMflix(client, action));
    }
  }

  return {
    dryRun: plan.dryRun,
    results,
  };
};

const main = async () => {
  const args = parseArgs(process.argv.slice(2));
  const plan = validatePlan(args);

  await connectToMongo();

  try {
    const result = await executePlan(plan);
    console.log(JSON.stringify(result, null, 2));
  } finally {
    await mongoose.disconnect();
  }
};

if (require.main === module) {
  runCli(main);
}

module.exports = {
  DEFAULT_RETENTION_DAYS,
  TTL_INDEX_NAME,
  executePlan,
  parseArgs,
  validatePlan,
};
