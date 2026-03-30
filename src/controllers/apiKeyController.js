const ApiKey = require("../models/apiKey");
const SuccessHandler = require("../utils/SuccessHandler");
const ErrorHandler = require("../utils/ErrorHandler");

/**
 * @desc Update API keys configuration
 * @route PUT /api/admin/api-keys
 * @access Private (Admin only)
 */
const updateApiKeys = async (req, res) => {
  // #swagger.tags = ['Admin']
  /* #swagger.description = 'Update API keys configuration (Admin only)'
     #swagger.security = [{ "Bearer": [] }]
     #swagger.parameters['obj'] = {
        in: 'body',
        description: 'API keys configuration',
        required: true,
        schema: {
          googleAnalyticsApiKey: 'your-google-analytics-api-key',
          nodemailerApiKey: 'your-nodemailer-api-key',
          metadata: {
            description: 'Optional metadata about the keys'
          }
        }
     }
     #swagger.responses[200] = {
        description: 'API keys updated successfully',
        schema: {
          success: true,
          data: {
            googleAnalyticsApiKey: 'your-google-analytics-api-key',
            nodemailerApiKey: 'your-nodemailer-api-key',
            maskedGoogleAnalyticsApiKey: 'your****key',
            maskedNodemailerApiKey: 'your****key',
            isActive: true,
            createdBy: 'user-id',
            updatedBy: 'user-id',
            lastUsed: null,
            usageCount: 0,
            metadata: {},
            createdAt: '2024-01-01T00:00:00.000Z',
            updatedAt: '2024-01-01T00:00:00.000Z'
          }
        }
     }
     #swagger.responses[400] = {
        description: 'Invalid key values or missing required fields'
     }
  */
  try {
    const { googleAnalyticsApiKey, nodemailerApiKey, metadata = {} } = req.body;

    // Validate that at least one API key is provided
    if (!googleAnalyticsApiKey && !nodemailerApiKey) {
      return ErrorHandler(
        "At least one API key (googleAnalyticsApiKey or nodemailerApiKey) is required.",
        400,
        req,
        res
      );
    }

    // Prepare configuration data
    const configData = {};

    if (googleAnalyticsApiKey !== undefined) {
      if (
        typeof googleAnalyticsApiKey !== "string" ||
        googleAnalyticsApiKey.trim().length === 0
      ) {
        return ErrorHandler(
          "Google Analytics API key must be a non-empty string.",
          400,
          req,
          res
        );
      }
      configData.googleAnalyticsApiKey = googleAnalyticsApiKey.trim();
    }

    if (nodemailerApiKey !== undefined) {
      if (
        typeof nodemailerApiKey !== "string" ||
        nodemailerApiKey.trim().length === 0
      ) {
        return ErrorHandler(
          "Nodemailer API key must be a non-empty string.",
          400,
          req,
          res
        );
      }
      configData.nodemailerApiKey = nodemailerApiKey.trim();
    }

    // Create or update the API key configuration
    const apiKeyConfig = await ApiKey.createOrUpdateConfig(
      configData,
      req.user._id
    );

    // Add metadata if provided
    if (Object.keys(metadata).length > 0) {
      apiKeyConfig.metadata = { ...apiKeyConfig.metadata, ...metadata };
      await apiKeyConfig.save();
    }

    return SuccessHandler(
      {
        message: "API keys updated successfully",
        data: apiKeyConfig,
      },
      200,
      res
    );
  } catch (error) {
    return ErrorHandler(error.message, 500, req, res);
  }
};

/**
 * @desc Get API keys configuration
 * @route GET /api/admin/api-keys
 * @access Private (Admin only)
 */
const getApiKeys = async (req, res) => {
  // #swagger.tags = ['Admin']
  /* #swagger.description = 'Get current API keys configuration (Admin only)'
     #swagger.security = [{ "Bearer": [] }]
     #swagger.responses[200] = {
        description: 'API keys configuration retrieved successfully',
        schema: {
          success: true,
          data: {
            googleAnalyticsApiKey: 'your-google-analytics-api-key',
            nodemailerApiKey: 'your-nodemailer-api-key',
            maskedGoogleAnalyticsApiKey: 'your****key',
            maskedNodemailerApiKey: 'your****key',
            isActive: true,
            createdBy: 'user-id',
            updatedBy: 'user-id',
            lastUsed: null,
            usageCount: 0,
            metadata: {},
            createdAt: '2024-01-01T00:00:00.000Z',
            updatedAt: '2024-01-01T00:00:00.000Z'
          }
        }
     }
  */
  try {
    const apiKeyConfig = await ApiKey.getActiveConfig();
    
    if (!apiKeyConfig) {
      return SuccessHandler(
        {
          message: "No API keys configuration found",
          data: null,
        },
        200,
        res
      );
    }

    return SuccessHandler(
      {
        message: "API keys configuration retrieved successfully",
        data: apiKeyConfig,
      },
      200,
      res
    );
  } catch (error) {
    return ErrorHandler(error.message, 500, req, res);
  }
};

module.exports = {
  updateApiKeys,
  getApiKeys,
};
