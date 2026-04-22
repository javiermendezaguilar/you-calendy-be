const mongoose = require("mongoose");
const Business = require("../src/models/User/business");
const Backup = require("../src/models/backup");
const {
  createJsonBackup,
  downloadBackupFromCloudinary,
  restoreFromBackupData,
} = require("../src/utils/backupUtils");
const { deleteFileFromCloudinary } = require("../src/functions/cloudinary");

async function main() {
  const mongoUri = process.env.MONGO_URI;
  if (!mongoUri) {
    throw new Error("MONGO_URI is not available");
  }

  await mongoose.connect(mongoUri, {
    serverSelectionTimeoutMS: 15000,
  });

  const business = await Business.findOne({}).sort({ createdAt: 1 });
  if (!business) {
    throw new Error("No business document found in staging");
  }

  const backupOwnerId = business.owner;
  const originalName = business.name || "Unnamed staging business";
  const marker = ` [restore-drill-${Date.now().toString().slice(-6)}]`;

  let backupResult = null;
  let backupData = null;

  try {
    backupResult = await createJsonBackup("daily", backupOwnerId);
    backupData = await downloadBackupFromCloudinary(backupResult.cloudinaryUrl);

    business.name = `${originalName}${marker}`;
    await business.save();

    const mutatedBusiness = await Business.findById(business._id).lean();
    if (mutatedBusiness.name !== `${originalName}${marker}`) {
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

    console.log(
      JSON.stringify(
        {
          success: true,
          businessId: business._id.toString(),
          originalName,
          mutatedName: `${originalName}${marker}`,
          restoredName,
          backupFile: backupResult.filename,
          cloudinaryPublicId: backupResult.cloudinaryPublicId,
          totalCollections: restoreResult.metadata.totalCollections,
          totalRecords: restoreResult.metadata.totalRecords,
          backupRecordId: latestBackupRecord?._id?.toString() || null,
        },
        null,
        2
      )
    );
  } finally {
    if (backupResult?.cloudinaryPublicId) {
      try {
        await deleteFileFromCloudinary(backupResult.cloudinaryPublicId, "raw");
      } catch (error) {
        console.warn(`Cloudinary cleanup failed: ${error.message}`);
      }
    }

    await mongoose.disconnect();
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
