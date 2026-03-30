const SuccessHandler = require("../utils/SuccessHandler");
const ErrorHandler = require("../utils/ErrorHandler");
const Auditing = require("../models/auditing");

/**
 * @desc Get all audit logs with pagination and search functionality
 * @route GET /api/admin/audit-logs
 * @access Private (Admin only)
 */
const getAuditLogs = async (req, res) => {
  // #swagger.tags = ['Audit']
  /* #swagger.security = [{ "Bearer": [] }] */
  /* #swagger.description = 'Get audit logs with pagination and search functionality'
     #swagger.parameters['page'] = {
        in: 'query',
        description: 'Page number for pagination (default: 1)',
        required: false,
        type: 'integer',
        minimum: 1
     }
     #swagger.parameters['limit'] = {
        in: 'query',
        description: 'Number of logs per page (default: 10, max: 100)',
        required: false,
        type: 'integer',
        minimum: 1,
        maximum: 100
     }
     #swagger.parameters['search'] = {
        in: 'query',
        description: 'Search term to filter logs by reason, entityType, staffName, or clientName',
        required: false,
        type: 'string'
     }
     #swagger.parameters['entityType'] = {
        in: 'query',
        description: 'Filter by entity type (Staff, Client, Business, Service, Appointment, Other)',
        required: false,
        type: 'string',
        enum: ['Staff', 'Client', 'Business', 'Service', 'Appointment', 'Other']
     }
     #swagger.parameters['action'] = {
        in: 'query',
        description: 'Filter by action type (deleted, updated, created, modified, other). If not provided, defaults to deleted actions only.',
        required: false,
        type: 'string',
        enum: ['deleted', 'updated', 'created', 'modified', 'other']
     }
     #swagger.parameters['startDate'] = {
        in: 'query',
        description: 'Start date for date range filter (ISO date string)',
        required: false,
        type: 'string',
        format: 'date'
     }
     #swagger.parameters['endDate'] = {
        in: 'query',
        description: 'End date for date range filter (ISO date string)',
        required: false,
        type: 'string',
        format: 'date'
     }
     #swagger.responses[200] = {
        description: 'Audit logs fetched successfully',
        schema: {
          success: true,
          message: 'Audit logs fetched successfully',
          logs: [{
            id: 'string',
            date: 'date',
            reason: 'string',
            entityType: 'string',
            entityName: 'string',
            actionBy: 'string',
            action: 'string',
            metadata: 'object'
          }],
          pagination: {
            currentPage: 'integer',
            totalPages: 'integer',
            totalLogs: 'integer',
            hasNextPage: 'boolean',
            hasPrevPage: 'boolean',
            limit: 'integer'
          },
          filters: {
            search: 'string|null',
            entityType: 'string|null',
            action: 'string|null',
            startDate: 'string|null',
            endDate: 'string|null'
          }
        }
     }
     #swagger.responses[400] = {
        description: 'Invalid pagination parameters'
     }
     #swagger.responses[500] = {
        description: 'Server error'
     }
  */
  try {
    // Extract query parameters for pagination and search
    const {
      page = 1,
      limit = 10,
      search = "",
      entityType = "",
      action = "",
      startDate = "",
      endDate = "",
    } = req.query;

    // Validate pagination parameters
    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);

    if (pageNum < 1 || limitNum < 1 || limitNum > 100) {
      return ErrorHandler(
        "Invalid pagination parameters. Page must be >= 1, limit must be between 1 and 100",
        400,
        req,
        res
      );
    }

    // Build the filter object
    const filter = {};

    // Default filter for deleted actions (maintaining existing functionality)
    filter.action = { $in: ["deleted"] };

    // Add entityType filter if provided
    if (entityType && entityType.trim()) {
      filter.entityType = entityType.trim();
    }

    // Add action filter if provided (overrides default deleted filter)
    if (action && action.trim()) {
      filter.action = action.trim();
    }

    // Add date range filter if provided
    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) {
        filter.createdAt.$gte = new Date(startDate);
      }
      if (endDate) {
        filter.createdAt.$lte = new Date(endDate);
      }
    }

    // Build search query if search term is provided
    let searchQuery = {};
    if (search && search.trim()) {
      const searchRegex = new RegExp(search.trim(), "i");
      searchQuery = {
        $or: [
          { reason: searchRegex },
          { entityType: searchRegex },
          { "metadata.staffName": searchRegex },
          { "metadata.clientName": searchRegex },
        ],
      };
    }

    // Combine filters
    const finalFilter = { ...filter, ...searchQuery };

    // Calculate skip value for pagination
    const skip = (pageNum - 1) * limitNum;

    // Execute query with pagination
    const logs = await Auditing.find(finalFilter)
      .sort({ createdAt: -1 })
      .populate("createdBy", "firstName lastName email")
      .skip(skip)
      .limit(limitNum)
      .lean();

    // Get total count for pagination metadata
    const totalLogs = await Auditing.countDocuments(finalFilter);
    const totalPages = Math.ceil(totalLogs / limitNum);

    // Format the response data
    const formattedLogs = logs.map((log) => ({
      id: log._id,
      date: log.createdAt,
      reason: log.reason,
      entityType: log.entityType,
      entityName:
        log.metadata?.staffName || log.metadata?.clientName || log.metadata?.serviceName || "Unknown",
      actionBy: log.createdBy && (log.createdBy.firstName || log.createdBy.lastName)
        ? `${log.createdBy.firstName || ''} ${log.createdBy.lastName || ''}`.trim()
        : log.createdBy?.email || "System",
      action: log.action,
      metadata: log.metadata,
    }));

    // Build pagination metadata
    const pagination = {
      currentPage: pageNum,
      totalPages,
      totalLogs,
      hasNextPage: pageNum < totalPages,
      hasPrevPage: pageNum > 1,
      limit: limitNum,
    };

    return SuccessHandler(
      {
        message: "Audit logs fetched successfully",
        logs: formattedLogs,
        pagination,
        filters: {
          search: search || null,
          entityType: entityType || null,
          action: action || null,
          startDate: startDate || null,
          endDate: endDate || null,
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
 * @desc Delete an audit log
 * @route DELETE /api/admin/audit-logs/:logId
 * @access Private (Admin only)
 */
const deleteAuditLog = async (req, res) => {
  // #swagger.tags = ['Audit']
  /* #swagger.security = [{ "Bearer": [] }] */
  /* #swagger.description = 'Delete an audit log'
     #swagger.parameters['logId'] = {
        in: 'path',
        description: 'The ID of the audit log to delete',
        required: true,
        type: 'string'
     }
     #swagger.responses[200] = {
        description: 'Audit log deleted successfully'
     }
     #swagger.responses[404] = {
        description: 'Audit log not found'
     }
  */
  try {
    const { logId } = req.params;
    const log = await Auditing.findByIdAndDelete(logId);
    if (!log) {
      return ErrorHandler("Audit log not found", 404, req, res);
    }
    return SuccessHandler("Audit log deleted successfully", 200, res);
  } catch (error) {
    return ErrorHandler(error.message, 500, req, res);
  }
};

module.exports = {
  getAuditLogs,
  deleteAuditLog,
};
