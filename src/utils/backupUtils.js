const mongoose = require("mongoose");
const { uploadFileToCloudinary } = require("../functions/cloudinary");

// Import all models for backup
const User = require("../models/User/user");
const Business = require("../models/User/business");
const Client = require("../models/client");
const Appointment = require("../models/appointment");
const Service = require("../models/service");
const Staff = require("../models/staff");
const Support = require("../models/support");
const FeatureSuggestion = require("../models/featureSuggestion");
const Promotion = require("../models/promotion");
const FlashSale = require("../models/flashSale");
const HaircutGallery = require("../models/haircutGallery");
const Note = require("../models/note");
const Notification = require("../models/User/notification");
const Billing = require("../models/User/billing");
const EmailCampaign = require("../models/emailCampaign");
const SmsCampaign = require("../models/smsCampaign");

const BACKUP_COLLECTIONS = [
  { name: "users", model: User },
  { name: "businesses", model: Business },
  { name: "clients", model: Client },
  { name: "appointments", model: Appointment },
  { name: "services", model: Service },
  { name: "staff", model: Staff },
  { name: "supports", model: Support },
  { name: "featuresuggestions", model: FeatureSuggestion },
  { name: "promotions", model: Promotion },
  { name: "flashsales", model: FlashSale },
  { name: "haircutgalleries", model: HaircutGallery },
  { name: "notes", model: Note },
  { name: "notifications", model: Notification },
  { name: "billings", model: Billing },
  { name: "emailcampaigns", model: EmailCampaign },
  { name: "smscampaigns", model: SmsCampaign },
];

/**
 * Get all collections from the database
 */
const getAllCollections = async () => {
  const collections = await mongoose.connection.db.listCollections().toArray();
  return collections.map((col) => col.name);
};

const createBackupEnvelope = (backupType, createdBy) => ({
  metadata: {
    backupType,
    backupDate: new Date(),
    version: "1.0",
    createdBy: createdBy.toString(),
    totalCollections: 0,
    totalRecords: 0,
  },
  collections: {},
});

const emitCollectionProgress = async ({
  onProgress,
  phase,
  collections,
  processed,
  currentCollection,
  reserveUploadTail = false,
}) => {
  if (!onProgress) {
    return;
  }

  const ratio = processed / collections.length;
  const progress = reserveUploadTail
    ? Math.max(1, Math.round(ratio * 90))
    : Math.max(1, Math.round(ratio * 100));

  await onProgress({
    [`${phase}Phase`]: phase,
    [`${phase}TotalCollections`]: collections.length,
    [`${phase}ProcessedCollections`]: processed,
    [`${phase}CurrentCollection`]: currentCollection,
    [`${phase}Progress`]: progress,
  });
};

const collectBackupData = async (collections, backupData, onProgress) => {
  let totalRecords = 0;

  if (onProgress) {
    await onProgress({
      backupPhase: "gathering",
      backupTotalCollections: collections.length,
      backupProcessedCollections: 0,
      backupCurrentCollection: null,
      backupProgress: 1,
    });
  }

  for (let idx = 0; idx < collections.length; idx++) {
    const collection = collections[idx];
    try {
      const data = await collection.model.find({}).lean();
      backupData.collections[collection.name] = data;
      totalRecords += data.length;

      console.log(`Backed up ${data.length} records from ${collection.name}`);

      await emitCollectionProgress({
        onProgress,
        phase: "backup",
        collections,
        processed: idx + 1,
        currentCollection: collection.name,
        reserveUploadTail: true,
      });
    } catch (error) {
      console.error(`Error backing up ${collection.name}:`, error.message);
      backupData.collections[collection.name] = [];
    }
  }

  backupData.metadata.totalCollections = collections.length;
  backupData.metadata.totalRecords = totalRecords;
};

const buildBackupResult = (filename, buffer, cloudinaryResult, backupData) => ({
  filename,
  cloudinaryUrl: cloudinaryResult.secure_url,
  cloudinaryPublicId: cloudinaryResult.public_id,
  fileSize: buffer.length,
  collections: BACKUP_COLLECTIONS.map((col) => ({
    name: col.name,
    count: backupData.collections[col.name]?.length || 0,
  })),
  metadata: backupData.metadata,
});

/**
 * Create a JSON backup and upload to Cloudinary
 */
const createJsonBackup = async (backupType, createdBy, opts = {}) => {
  const onProgress = typeof opts.onProgress === "function" ? opts.onProgress : null;
  try {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `backup_${backupType}_${timestamp}.json`;
    const backupData = createBackupEnvelope(backupType, createdBy);

    // Emit total collections upfront
    if (onProgress) {
      await onProgress({
        backupPhase: "gathering",
        backupTotalCollections: BACKUP_COLLECTIONS.length,
        backupProcessedCollections: 0,
        backupCurrentCollection: null,
        // Reserve 90% for gathering data, 10% for upload
        backupProgress: 1,
      });
    }

    await collectBackupData(BACKUP_COLLECTIONS, backupData, onProgress);

    // Convert backup data to JSON buffer
    const jsonData = JSON.stringify(backupData, null, 2);
    const buffer = Buffer.from(jsonData, "utf8");

    // Upload to Cloudinary using the file upload function
    if (onProgress) {
      await onProgress({
        backupPhase: "uploading",
        backupCurrentCollection: null,
        backupProgress: 95,
      });
    }

    const cloudinaryResult = await uploadFileToCloudinary(
      buffer,
      "backups",
      filename
    );

    if (onProgress) {
      await onProgress({
        backupPhase: "finalizing",
        backupProgress: 100,
      });
    }

    return buildBackupResult(filename, buffer, cloudinaryResult, backupData);
  } catch (error) {
    throw new Error(`Backup creation failed: ${error.message}`);
  }
};

/**
 * Create a compressed backup and upload to Cloudinary
 */
const createCompressedBackup = async (backupType, createdBy, opts = {}) => {
  const onProgress = typeof opts.onProgress === "function" ? opts.onProgress : null;
  try {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const filename = `backup_${backupType}_${timestamp}.json.gz`;
    const backupData = createBackupEnvelope(backupType, createdBy);

    if (onProgress) {
      await onProgress({
        backupPhase: "gathering",
        backupTotalCollections: BACKUP_COLLECTIONS.length,
        backupProcessedCollections: 0,
        backupCurrentCollection: null,
        backupProgress: 1,
      });
    }

    await collectBackupData(BACKUP_COLLECTIONS, backupData, onProgress);

    // Convert backup data to JSON and compress
    const jsonData = JSON.stringify(backupData, null, 2);
    const buffer = Buffer.from(jsonData, "utf8");

    // For now, we'll use the uncompressed version since Cloudinary handles compression
    // In a production environment, you might want to use zlib for compression
    if (onProgress) {
      await onProgress({
        backupPhase: "uploading",
        backupCurrentCollection: null,
        backupProgress: 95,
      });
    }

    const cloudinaryResult = await uploadFileToCloudinary(
      buffer,
      "backups",
      filename
    );

    if (onProgress) {
      await onProgress({
        backupPhase: "finalizing",
        backupProgress: 100,
      });
    }

    return buildBackupResult(filename, buffer, cloudinaryResult, backupData);
  } catch (error) {
    throw new Error(`Compressed backup creation failed: ${error.message}`);
  }
};

/**
 * Download backup from Cloudinary and parse it
 */
const downloadBackupFromCloudinary = async (cloudinaryUrl) => {
  try {
    const response = await fetch(cloudinaryUrl);
    if (!response.ok) {
      throw new Error(`Failed to download backup: ${response.statusText}`);
    }

    const jsonData = await response.text();
    const backupData = JSON.parse(jsonData);

    // Validate backup structure
    if (!backupData.metadata || !backupData.collections) {
      throw new Error("Invalid backup file format");
    }

    return backupData;
  } catch (error) {
    throw new Error(`Failed to download and parse backup: ${error.message}`);
  }
};

/**
 * Normalize legacy Staff documents to current schema
 * - Ensures `services` is an array of embedded documents: { service: ObjectId, timeInterval: Number }
 * - Accepts legacy shapes where `services` is a string, ObjectId string array, or objects missing timeInterval
 */
const normalizeStaffDocuments = (docs) => {
  return (docs || []).map((doc) => {
    try {
      const fallbackInterval =
        typeof doc.timeInterval === "number" && doc.timeInterval >= 5
          ? doc.timeInterval
          : 15;

      const normalizeItem = (item) => {
        if (!item) return null;
        // If item is a service id string
        if (typeof item === "string") {
          if (mongoose.Types.ObjectId.isValid(item)) {
            return {
              service: new mongoose.Types.ObjectId(item),
              timeInterval: fallbackInterval,
            };
          }
          return null;
        }
        // If item already looks like an embedded doc
        if (typeof item === "object") {
          const normalized = { ...item };
          if (typeof normalized.service === "string") {
            if (mongoose.Types.ObjectId.isValid(normalized.service)) {
              normalized.service = new mongoose.Types.ObjectId(
                normalized.service
              );
            } else {
              return null;
            }
          }
          if (
            typeof normalized.timeInterval !== "number" ||
            normalized.timeInterval < 5 ||
            normalized.timeInterval > 120
          ) {
            normalized.timeInterval = fallbackInterval;
          }
          return normalized;
        }
        return null;
      };

      let services = doc.services;
      if (!services) {
        services = [];
      } else if (!Array.isArray(services)) {
        services = [services];
      }

      const normalizedServices = services
        .map((s) => normalizeItem(s))
        .filter(Boolean);

      return { ...doc, services: normalizedServices };
    } catch (e) {
      // If normalization fails, return original doc to let validation surface specific errors
      return doc;
    }
  });
};

/**
 * Restore from JSON backup data
 */
const restoreFromBackupData = async (backupData, opts = {}) => {
  const onProgress = typeof opts.onProgress === "function" ? opts.onProgress : null;
  try {
    console.log(`Restoring backup from ${backupData.metadata.backupDate}`);
    console.log(`Total collections: ${backupData.metadata.totalCollections}`);
    console.log(`Total records: ${backupData.metadata.totalRecords}`);

    // Define collections to restore in order
    // Emit total upfront
    if (onProgress) {
      await onProgress({
        restorePhase: "restoring",
        restoreTotalCollections: BACKUP_COLLECTIONS.length,
        restoreProcessedCollections: 0,
        restoreCurrentCollection: null,
        restoreProgress: 1,
      });
    }

    // Restore collections in order
    for (let idx = 0; idx < BACKUP_COLLECTIONS.length; idx++) {
      const collection = BACKUP_COLLECTIONS[idx];
      try {
        let data = backupData.collections[collection.name] || [];

        if (data.length > 0) {
          // Clear existing data
          await collection.model.deleteMany({});

          // Insert backup data
          if (data.length > 0) {
            // Apply compatibility normalization for specific collections
            if (collection.name === "staff") {
              data = normalizeStaffDocuments(data);
            }

            await collection.model.insertMany(data);
          }

          console.log(`Restored ${data.length} records to ${collection.name}`);

          if (onProgress) {
            await emitCollectionProgress({
              onProgress,
              phase: "restore",
              collections: BACKUP_COLLECTIONS,
              processed: idx + 1,
              currentCollection: collection.name,
            });
          }
        }
      } catch (error) {
        console.error(`Error restoring ${collection.name}:`, error.message);
        throw new Error(
          `Failed to restore ${collection.name}: ${error.message}`
        );
      }
    }

    return {
      success: true,
      message: `Successfully restored ${backupData.metadata.totalRecords} records from ${backupData.metadata.totalCollections} collections`,
      metadata: backupData.metadata,
    };
  } catch (error) {
    throw new Error(`Restore failed: ${error.message}`);
  }
};

/**
 * Get backup file info from Cloudinary
 */
const getBackupFileInfo = async (cloudinaryUrl) => {
  try {
    const response = await fetch(cloudinaryUrl);
    if (!response.ok) {
      throw new Error(`Failed to access backup file: ${response.statusText}`);
    }

    const contentLength = response.headers.get("content-length");
    const lastModified = response.headers.get("last-modified");

    // Try to get metadata from the file content
    try {
      const jsonData = await response.text();
      const backupData = JSON.parse(jsonData);

      return {
        fileSize: parseInt(contentLength) || jsonData.length,
        createdAt: lastModified ? new Date(lastModified) : new Date(),
        modifiedAt: lastModified ? new Date(lastModified) : new Date(),
        metadata: backupData.metadata,
      };
    } catch (error) {
      // Not a JSON file or invalid JSON, return basic info
      return {
        fileSize: parseInt(contentLength) || 0,
        createdAt: lastModified ? new Date(lastModified) : new Date(),
        modifiedAt: lastModified ? new Date(lastModified) : new Date(),
        metadata: null,
      };
    }
  } catch (error) {
    throw new Error(`Error reading backup file: ${error.message}`);
  }
};

/**
 * Clean up old backups from Cloudinary
 */
const cleanupOldBackups = async (maxAgeInDays = 30) => {
  try {
    // This would require Cloudinary Admin API to list and delete files
    // For now, we'll return a message indicating this needs to be implemented
    // with proper Cloudinary Admin API credentials

    return {
      deletedCount: 0,
      message: `Cleanup functionality requires Cloudinary Admin API implementation. Please implement with proper credentials.`,
    };
  } catch (error) {
    throw new Error(`Cleanup failed: ${error.message}`);
  }
};

module.exports = {
  createJsonBackup,
  createCompressedBackup,
  downloadBackupFromCloudinary,
  restoreFromBackupData,
  getBackupFileInfo,
  cleanupOldBackups,
  // Exported for testing and diagnostics
  normalizeStaffDocuments,
};
