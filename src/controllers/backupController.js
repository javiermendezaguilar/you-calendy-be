const Backup = require("../models/backup");
const SuccessHandler = require("../utils/SuccessHandler");
const ErrorHandler = require("../utils/ErrorHandler");
const {
  createJsonBackup,
  createCompressedBackup,
  downloadBackupFromCloudinary,
  restoreFromBackupData,
  getBackupFileInfo,
  cleanupOldBackups,
} = require("../utils/backupUtils");

/**
 * @desc Create a manual backup
 * @route POST /api/admin/backup
 * @access Private (Admin only)
 */
const createManualBackup = async (req, res) => {
  // #swagger.tags = ['Backup']
  /* #swagger.description = 'Create a manual backup of the database and upload to Cloudinary.'
     #swagger.security = [{ "Bearer": [] }]
     #swagger.parameters['obj'] = {
        in: 'body',
        description: 'Backup configuration.',
        required: true,
        schema: {
          type: 'daily',
          format: 'json'
        }
     }
  */
  try {
    const { type, format = "json" } = req.body;
    const admin = req.user._id;

    // Validate backup type
    if (!type || !["daily", "weekly", "monthly"].includes(type)) {
      return ErrorHandler(
        "Backup type must be 'daily', 'weekly', or 'monthly'.",
        400,
        req,
        res
      );
    }

    // Validate format
    if (!["json", "compressed"].includes(format)) {
      return ErrorHandler(
        "Backup format must be 'json' or 'compressed'.",
        400,
        req,
        res
      );
    }

    // Create backup record
    const backupRecord = await Backup.create({
      type,
      filename: "pending",
      cloudinaryUrl: "pending",
      cloudinaryPublicId: "pending",
      fileSize: 0,
      createdBy: admin,
      status: "in_progress",
      backupStatus: "in_progress",
      backupPhase: "initializing",
      backupProgress: 1,
    });

    try {
      let backupResult;

      // Create backup based on format
      const onProgress = async (fields) => {
        try {
          await Backup.findByIdAndUpdate(backupRecord._id, {
            $set: {
              backupStatus: "in_progress",
              ...(fields.backupPhase ? { backupPhase: fields.backupPhase } : {}),
              ...(typeof fields.backupProgress === "number"
                ? { backupProgress: fields.backupProgress }
                : {}),
              ...(typeof fields.backupProcessedCollections === "number"
                ? { backupProcessedCollections: fields.backupProcessedCollections }
                : {}),
              ...(typeof fields.backupTotalCollections === "number"
                ? { backupTotalCollections: fields.backupTotalCollections }
                : {}),
              ...(fields.backupCurrentCollection
                ? { backupCurrentCollection: fields.backupCurrentCollection }
                : {}),
            },
          });
        } catch (e) {
          console.warn("Failed to update backup progress:", e.message);
        }
      };

      if (format === "json") {
        backupResult = await createJsonBackup(type, admin, { onProgress });
      } else {
        backupResult = await createCompressedBackup(type, admin, { onProgress });
      }

      // Update backup record with results
      backupRecord.filename = backupResult.filename;
      backupRecord.cloudinaryUrl = backupResult.cloudinaryUrl;
      backupRecord.cloudinaryPublicId = backupResult.cloudinaryPublicId;
      backupRecord.fileSize = backupResult.fileSize;
      backupRecord.collections = backupResult.collections;
      backupRecord.metadata = backupResult.metadata;
      backupRecord.status = "completed";
      backupRecord.backupStatus = "completed";
      backupRecord.backupPhase = "finalizing";
      backupRecord.backupProgress = 100;

      await backupRecord.save();

      return SuccessHandler(
        {
          message: "Backup created successfully and uploaded to Cloudinary",
          backup: backupRecord,
          downloadUrl: backupRecord.cloudinaryUrl,
        },
        201,
        res
      );
    } catch (error) {
      // Update backup record with error
      backupRecord.status = "failed";
      backupRecord.backupStatus = "failed";
      backupRecord.backupPhase = "finalizing";
      backupRecord.errorMessage = error.message;
      await backupRecord.save();

      return ErrorHandler(
        `Backup creation failed: ${error.message}`,
        500,
        req,
        res
      );
    }
  } catch (error) {
    return ErrorHandler(error.message, 500, req, res);
  }
};

/**
 * @desc Get all backups
 * @route GET /api/admin/backup
 * @access Private (Admin only)
 */
const getAllBackups = async (req, res) => {
  // #swagger.tags = ['Backup']
  /* #swagger.description = 'Get all backup records with pagination and filtering.'
     #swagger.security = [{ "Bearer": [] }]
     #swagger.parameters['type'] = { in: 'query', description: 'Filter by backup type (daily, weekly)', required: false, type: 'string' }
     #swagger.parameters['status'] = { in: 'query', description: 'Filter by status (completed, failed, in_progress)', required: false, type: 'string' }
     #swagger.parameters['page'] = { in: 'query', description: 'Page number for pagination', required: false, type: 'integer' }
     #swagger.parameters['limit'] = { in: 'query', description: 'Number of items per page', required: false, type: 'integer' }
  */
  try {
    const { type, status, page = 1, limit = 10 } = req.query;
    const query = {};

    // Apply filters
    if (type) {
      query.type = type;
    }
    if (status) {
      query.status = status;
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const backups = await Backup.find(query)
      .populate("createdBy", "firstName lastName email")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Backup.countDocuments(query);

    return SuccessHandler(
      {
        backups,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(total / parseInt(limit)),
          totalItems: total,
          itemsPerPage: parseInt(limit),
        },
      },
      200,
      res
    );
  } catch (error) {
    return ErrorHandler(error.message, 500, req, res);
  }
};

/**
 * @desc Get backup by ID
 * @route GET /api/admin/backup/:id
 * @access Private (Admin only)
 */
const getBackupById = async (req, res) => {
  // #swagger.tags = ['Backup']
  /* #swagger.description = 'Get a single backup record by ID.'
     #swagger.security = [{ "Bearer": [] }]
     #swagger.parameters['id'] = { in: 'path', description: 'Backup ID', required: true, type: 'string' }
  */
  try {
    const { id } = req.params;
    const backup = await Backup.findById(id).populate(
      "createdBy",
      "firstName lastName email"
    );

    if (!backup) {
      return ErrorHandler("Backup not found.", 404, req, res);
    }

    return SuccessHandler(backup, 200, res);
  } catch (error) {
    return ErrorHandler(error.message, 500, req, res);
  }
};

/**
 * @desc Get backup download URL
 * @route GET /api/admin/backup/:id/download
 * @access Private (Admin only)
 */
const getBackupDownloadUrl = async (req, res) => {
  // #swagger.tags = ['Backup']
  /* #swagger.description = 'Get the Cloudinary download URL for a backup file.'
     #swagger.security = [{ "Bearer": [] }]
     #swagger.parameters['id'] = { in: 'path', description: 'Backup ID', required: true, type: 'string' }
  */
  try {
    const { id } = req.params;
    const backup = await Backup.findById(id);

    if (!backup) {
      return ErrorHandler("Backup not found.", 404, req, res);
    }

    if (backup.status !== "completed") {
      return ErrorHandler("Backup is not ready for download.", 400, req, res);
    }

    return SuccessHandler(
      {
        downloadUrl: backup.cloudinaryUrl,
        filename: backup.filename,
        fileSize: backup.fileSize,
      },
      200,
      res
    );
  } catch (error) {
    return ErrorHandler(error.message, 500, req, res);
  }
};

/**
 * @desc Restore from backup
 * @route POST /api/admin/backup/:id/restore
 * @access Private (Admin only)
 */
const restoreFromBackup = async (req, res) => {
  // #swagger.tags = ['Backup']
  /* #swagger.description = 'Restore database from a backup stored in Cloudinary.'
     #swagger.security = [{ "Bearer": [] }]
     #swagger.parameters['id'] = { in: 'path', description: 'Backup ID', required: true, type: 'string' }
     #swagger.parameters['obj'] = {
        in: 'body',
        description: 'Restore configuration.',
        required: true,
        schema: {
          confirm: true
        }
     }
  */
  try {
    const { id } = req.params;
    const { confirm } = req.body;

    if (!confirm) {
      return ErrorHandler(
        "Please confirm the restore operation by setting confirm to true.",
        400,
        req,
        res
      );
    }

    const backup = await Backup.findById(id);
    if (!backup) {
      return ErrorHandler("Backup not found.", 404, req, res);
    }

    if (backup.status !== "completed") {
      return ErrorHandler("Backup is not ready for restore.", 400, req, res);
    }

    try {
      // Mark restore as in-progress
      await Backup.findByIdAndUpdate(id, {
        $set: { restoreStatus: "in_progress", restoreProgress: 5, restorePhase: "downloading" },
      });

      // Download backup from Cloudinary
      const backupData = await downloadBackupFromCloudinary(
        backup.cloudinaryUrl
      );

      // Restore from backup data
      const restoreResult = await restoreFromBackupData(backupData, {
        onProgress: async (fields) => {
          try {
            await Backup.findByIdAndUpdate(id, {
              $set: {
                restoreStatus: "in_progress",
                ...(fields.restorePhase ? { restorePhase: fields.restorePhase } : {}),
                ...(typeof fields.restoreProgress === "number"
                  ? { restoreProgress: fields.restoreProgress }
                  : {}),
                ...(typeof fields.restoreProcessedCollections === "number"
                  ? { restoreProcessedCollections: fields.restoreProcessedCollections }
                  : {}),
                ...(typeof fields.restoreTotalCollections === "number"
                  ? { restoreTotalCollections: fields.restoreTotalCollections }
                  : {}),
                ...(fields.restoreCurrentCollection
                  ? { restoreCurrentCollection: fields.restoreCurrentCollection }
                  : {}),
              },
            });
          } catch (e) {
            console.warn("Failed to update restore progress:", e.message);
          }
        },
      });

      // Mark restore as completed
      await Backup.findByIdAndUpdate(id, {
        $set: { restoreStatus: "completed", restoreProgress: 100, restorePhase: "finalizing" },
      });

      return SuccessHandler(
        {
          message: "Database restored successfully from Cloudinary backup",
          restoreResult,
        },
        200,
        res
      );
    } catch (error) {
      await Backup.findByIdAndUpdate(id, {
        $set: { restoreStatus: "failed", restorePhase: "finalizing" },
      });
      return ErrorHandler(`Restore failed: ${error.message}`, 500, req, res);
    }
  } catch (error) {
    return ErrorHandler(error.message, 500, req, res);
  }
};

/**
 * @desc Upload and restore from backup file
 * @route POST /api/admin/backup/upload-restore
 * @access Private (Admin only)
 */
const uploadAndRestore = async (req, res) => {
  // #swagger.tags = ['Backup']
  /* #swagger.description = 'Upload a backup file and restore from it.'
     #swagger.security = [{ "Bearer": [] }]
     #swagger.parameters['backupFile'] = { in: 'formData', description: 'Backup file to upload', required: true, type: 'file' }
     #swagger.parameters['confirm'] = { in: 'formData', description: 'Confirm restore operation', required: true, type: 'boolean' }
  */
  try {
    const { confirm } = req.body;

    if (!confirm) {
      return ErrorHandler(
        "Please confirm the restore operation by setting confirm to true.",
        400,
        req,
        res
      );
    }

    if (!req.file) {
      return ErrorHandler("No backup file uploaded.", 400, req, res);
    }

    try {
      // Read the uploaded file
      const fileBuffer = req.file.buffer;
      const jsonData = fileBuffer.toString("utf8");
      const backupData = JSON.parse(jsonData);

      // Validate backup structure
      if (!backupData.metadata || !backupData.collections) {
        throw new Error("Invalid backup file format");
      }

      // Restore from backup data
      const restoreResult = await restoreFromBackupData(backupData);

      return SuccessHandler(
        {
          message: "Database restored successfully from uploaded file",
          restoreResult,
        },
        200,
        res
      );
    } catch (error) {
      return ErrorHandler(`Restore failed: ${error.message}`, 500, req, res);
    }
  } catch (error) {
    return ErrorHandler(error.message, 500, req, res);
  }
};

/**
 * @desc Delete backup
 * @route DELETE /api/admin/backup/:id
 * @access Private (Admin only)
 */
const deleteBackup = async (req, res) => {
  // #swagger.tags = ['Backup']
  /* #swagger.description = 'Delete a backup record from database (Cloudinary file deletion requires Admin API).'
     #swagger.security = [{ "Bearer": [] }]
     #swagger.parameters['id'] = { in: 'path', description: 'Backup ID', required: true, type: 'string' }
  */
  try {
    const { id } = req.params;
    const backup = await Backup.findById(id);

    if (!backup) {
      return ErrorHandler("Backup not found.", 404, req, res);
    }

    // Note: To delete from Cloudinary, you would need to implement
    // Cloudinary Admin API with proper credentials
    // For now, we'll only delete the database record

    // Delete backup record
    await Backup.findByIdAndDelete(id);

    return SuccessHandler(
      {
        message:
          "Backup record deleted successfully. Note: Cloudinary file deletion requires Admin API implementation.",
        cloudinaryPublicId: backup.cloudinaryPublicId,
      },
      200,
      res
    );
  } catch (error) {
    return ErrorHandler(error.message, 500, req, res);
  }
};

/**
 * @desc Get backup statistics
 * @route GET /api/admin/backup/stats
 * @access Private (Admin only)
 */
const getBackupStats = async (req, res) => {
  // #swagger.tags = ['Backup']
  /* #swagger.description = 'Get backup statistics for admin dashboard.'
     #swagger.security = [{ "Bearer": [] }]
  */
  try {
    const totalBackups = await Backup.countDocuments();
    const completedBackups = await Backup.countDocuments({
      status: "completed",
    });
    const failedBackups = await Backup.countDocuments({ status: "failed" });
    const inProgressBackups = await Backup.countDocuments({
      status: "in_progress",
    });

    const typeStats = await Backup.aggregate([
      {
        $group: {
          _id: "$type",
          count: { $sum: 1 },
        },
      },
    ]);

    const typeBreakdown = {};
    typeStats.forEach((stat) => {
      typeBreakdown[stat._id] = stat.count;
    });

    // Ensure all types are represented
    ["daily", "weekly"].forEach((type) => {
      if (!typeBreakdown[type]) {
        typeBreakdown[type] = 0;
      }
    });

    const recentBackups = await Backup.find()
      .populate("createdBy", "firstName lastName email")
      .sort({ createdAt: -1 })
      .limit(5);

    const totalSize = await Backup.aggregate([
      { $match: { status: "completed" } },
      { $group: { _id: null, totalSize: { $sum: "$fileSize" } } },
    ]);

    return SuccessHandler(
      {
        totalBackups,
        completedBackups,
        failedBackups,
        inProgressBackups,
        successRate:
          totalBackups > 0 ? (completedBackups / totalBackups) * 100 : 0,
        typeBreakdown,
        totalSize: totalSize[0]?.totalSize || 0,
        recentBackups,
      },
      200,
      res
    );
  } catch (error) {
    return ErrorHandler(error.message, 500, req, res);
  }
};

/**
 * @desc Clean up old backups
 * @route POST /api/admin/backup/cleanup
 * @access Private (Admin only)
 */
const cleanupBackups = async (req, res) => {
  // #swagger.tags = ['Backup']
  /* #swagger.description = 'Clean up old backup records from database.'
     #swagger.security = [{ "Bearer": [] }]
     #swagger.parameters['obj'] = {
        in: 'body',
        description: 'Cleanup configuration.',
        required: true,
        schema: {
          maxAgeInDays: 30
        }
     }
  */
  try {
    const { maxAgeInDays = 30 } = req.body;
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - maxAgeInDays);

    const oldBackups = await Backup.find({
      createdAt: { $lt: cutoffDate },
      status: "completed",
    });

    const deletedCount = oldBackups.length;

    // Delete old backup records
    await Backup.deleteMany({
      createdAt: { $lt: cutoffDate },
      status: "completed",
    });

    return SuccessHandler(
      {
        deletedCount,
        message: `Cleaned up ${deletedCount} old backup records. Note: Cloudinary file cleanup requires Admin API implementation.`,
        cloudinaryPublicIds: oldBackups.map(
          (backup) => backup.cloudinaryPublicId
        ),
      },
      200,
      res
    );
  } catch (error) {
    return ErrorHandler(error.message, 500, req, res);
  }
};

module.exports = {
  createManualBackup,
  getAllBackups,
  getBackupById,
  getBackupDownloadUrl,
  restoreFromBackup,
  uploadAndRestore,
  deleteBackup,
  getBackupStats,
  cleanupBackups,
};
