const mongoose = require("mongoose");
const Business = require("../src/models/User/business");
const Backup = require("../src/models/backup");
const {
  createJsonBackup,
  downloadBackupFromCloudinary,
  restoreFromBackupData,
} = require("../src/utils/backupUtils");
const { deleteFileFromCloudinary } = require("../src/functions/cloudinary");

const CONFIRMATION_PHRASE = "staging-restore-drill";
const PRODUCTION_PATTERN = /\b(prod|production|live)\b/i;

mongoose.set("strictQuery", true);

const parseArgs = (argv = []) => {
  const options = {
    confirm: null,
    dryRun: false,
    help: false,
    json: false,
    target:
      process.env.RESTORE_DRILL_TARGET ||
      process.env.RAILWAY_ENVIRONMENT_NAME ||
      process.env.RAILWAY_ENVIRONMENT ||
      "",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--json") {
      options.json = true;
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--target") {
      options.target = argv[index + 1] || "";
      index += 1;
    } else if (arg.startsWith("--target=")) {
      options.target = arg.slice("--target=".length);
    } else if (arg === "--confirm") {
      options.confirm = argv[index + 1] || "";
      index += 1;
    } else if (arg.startsWith("--confirm=")) {
      options.confirm = arg.slice("--confirm=".length);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return options;
};

const usage = () => [
  "Usage:",
  "  npm run restore:drill:staging -- --dry-run --target staging",
  `  npm run restore:drill:staging -- --target staging --confirm ${CONFIRMATION_PHRASE}`,
  "",
  "This command is blocked unless the target and Mongo database prove staging.",
].join("\n");

const looksProductionLike = (value) =>
  PRODUCTION_PATTERN.test(String(value || ""));

const assertSafeTarget = ({
  confirm,
  dryRun,
  mongoUri,
  railwayEnvironmentName,
  target,
}) => {
  const normalizedTarget = String(target || "").trim().toLowerCase();
  const runtimeName = String(railwayEnvironmentName || "").trim();
  const uri = String(mongoUri || "");

  if (normalizedTarget !== "staging") {
    throw new Error("Restore drill target must be exactly staging.");
  }

  if (looksProductionLike(runtimeName) || looksProductionLike(uri)) {
    throw new Error(
      "Restore drill refused because the environment looks production-like."
    );
  }

  if (!/staging/i.test(runtimeName) && !/staging/i.test(uri)) {
    throw new Error("Restore drill refused because staging could not be proven.");
  }

  if (!dryRun && confirm !== CONFIRMATION_PHRASE) {
    throw new Error(
      `Restore drill writes require --confirm ${CONFIRMATION_PHRASE}.`
    );
  }
};

const printJson = (payload) => {
  console.log(JSON.stringify(payload, null, 2));
};

const connectMongo = async (mongoUri) => {
  await mongoose.connect(mongoUri, {
    serverSelectionTimeoutMS: 15000,
  });
};

const runDryRun = async () => {
  const business = await Business.findOne({}).sort({ createdAt: 1 }).lean();
  if (!business) {
    throw new Error("No business document found in staging");
  }

  const [businessCount, backupCount] = await Promise.all([
    Business.countDocuments(),
    Backup.countDocuments(),
  ]);

  return {
    success: true,
    dryRun: true,
    businessId: business._id.toString(),
    businessCount,
    backupCount,
    message: "Restore drill prechecks passed without mutating data.",
  };
};

const runRestoreDrill = async () => {
  const business = await Business.findOne({}).sort({ createdAt: 1 });
  if (!business) {
    throw new Error("No business document found in staging");
  }

  const backupOwnerId = business.owner;
  const originalName = business.name || "Unnamed staging business";
  const marker = ` [restore-drill-${Date.now().toString().slice(-6)}]`;
  const mutatedName = `${originalName}${marker}`;

  let backupResult = null;
  let mutationApplied = false;

  try {
    backupResult = await createJsonBackup("daily", backupOwnerId);
    const backupData = await downloadBackupFromCloudinary(
      backupResult.cloudinaryUrl
    );

    business.name = mutatedName;
    await business.save();
    mutationApplied = true;

    const mutatedBusiness = await Business.findById(business._id).lean();
    if (mutatedBusiness.name !== mutatedName) {
      throw new Error("Mutation step failed before restore");
    }

    const restoreResult = await restoreFromBackupData(backupData);
    const restoredBusiness = await Business.findById(business._id).lean();
    const restoredName = restoredBusiness?.name || "Unnamed staging business";

    if (restoredName !== originalName) {
      throw new Error(
        `Restore verification failed: expected "${originalName}" but got "${restoredName}"`
      );
    }

    const latestBackupRecord = await Backup.findOne({
      cloudinaryPublicId: backupResult.cloudinaryPublicId,
    })
      .sort({ createdAt: -1 })
      .lean();

    return {
      success: true,
      dryRun: false,
      businessId: business._id.toString(),
      originalName,
      mutatedName,
      restoredName,
      backupFile: backupResult.filename,
      cloudinaryPublicId: backupResult.cloudinaryPublicId,
      totalCollections: restoreResult.metadata.totalCollections,
      totalRecords: restoreResult.metadata.totalRecords,
      backupRecordId: latestBackupRecord?._id?.toString() || null,
    };
  } catch (error) {
    if (mutationApplied) {
      try {
        await Business.findByIdAndUpdate(business._id, {
          $set: { name: originalName },
        });
      } catch (revertError) {
        console.warn(`Targeted revert failed: ${revertError.message}`);
      }
    }

    throw error;
  } finally {
    if (backupResult?.cloudinaryPublicId) {
      try {
        await deleteFileFromCloudinary(backupResult.cloudinaryPublicId, "raw");
      } catch (error) {
        console.warn(`Cloudinary cleanup failed: ${error.message}`);
      }
    }
  }
};

const runCli = async (argv = process.argv.slice(2), env = process.env) => {
  try {
    const options = parseArgs(argv);
    if (options.help) {
      console.log(usage());
      return 0;
    }

    const mongoUri = env.MONGO_URI;
    if (!mongoUri) {
      throw new Error("MONGO_URI is not available");
    }

    assertSafeTarget({
      confirm: options.confirm,
      dryRun: options.dryRun,
      mongoUri,
      railwayEnvironmentName:
        env.RAILWAY_ENVIRONMENT_NAME || env.RAILWAY_ENVIRONMENT || "",
      target: options.target,
    });

    await connectMongo(mongoUri);
    const result = options.dryRun ? await runDryRun() : await runRestoreDrill();
    printJson(result);
    return 0;
  } catch (error) {
    console.error(error.message);
    return 1;
  } finally {
    if (mongoose.connection.readyState !== 0) {
      await mongoose.disconnect();
    }
  }
};

if (require.main === module) {
  runCli().then((exitCode) => {
    process.exitCode = exitCode;
  });
}

module.exports = {
  CONFIRMATION_PHRASE,
  assertSafeTarget,
  looksProductionLike,
  parseArgs,
  runCli,
  usage,
};
