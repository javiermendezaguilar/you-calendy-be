const FeatureSuggestion = require("../models/featureSuggestion");
const SuccessHandler = require("../utils/SuccessHandler");
const ErrorHandler = require("../utils/ErrorHandler");

/**
 * @desc Create a new feature suggestion
 * @route POST /api/feature-suggestions
 * @access Private (Barber/Staff)
 */
const createFeatureSuggestion = async (req, res) => {
  // #swagger.tags = ['FeatureSuggestions']
  /* #swagger.description = 'Create a new feature suggestion.'
     #swagger.security = [{ "Bearer": [] }]
     #swagger.parameters['obj'] = {
        in: 'body',
        description: 'Feature suggestion details.',
        required: true,
        schema: {
          title: 'New Feature Title',
          description: 'Detailed description of the feature.'
        }
     }
  */
  try {
    const { title, description } = req.body;
    // Check for user or staff
    const suggestedBy = req.staff ? req.staff._id : req.user?._id;
    if (!title || !description) {
      return ErrorHandler("Title and description are required.", 400, req, res);
    }
    if (!suggestedBy) {
      return ErrorHandler("Unauthorized: User or staff not found.", 401, req, res);
    }
    const suggestion = await FeatureSuggestion.create({
      title,
      description,
      suggestedBy,
    });
    return SuccessHandler(suggestion, 201, res);
  } catch (error) {
    return ErrorHandler(error.message, 500, req, res);
  }
};

/**
 * @desc Get all feature suggestions
 * @route GET /api/feature-suggestions
 * @access Private (Barber/Staff, Admin)
 */
const getAllFeatureSuggestions = async (req, res) => {
  // #swagger.tags = ['FeatureSuggestions']
  /* #swagger.description = 'Get all feature suggestions.'
     #swagger.security = [{ "Bearer": [] }]
  */
  try {
    const suggestions = await FeatureSuggestion.find()
      .populate("suggestedBy", "firstName lastName email")
      .sort({ createdAt: -1 });
    return SuccessHandler(suggestions, 200, res);
  } catch (error) {
    return ErrorHandler(error.message, 500, req, res);
  }
};

/**
 * @desc Get a single feature suggestion by ID
 * @route GET /api/feature-suggestions/:id
 * @access Private (Barber/Staff, Admin)
 */
const getFeatureSuggestionById = async (req, res) => {
  // #swagger.tags = ['FeatureSuggestions']
  /* #swagger.description = 'Get a single feature suggestion by its ID.'
     #swagger.security = [{ "Bearer": [] }]
     #swagger.parameters['id'] = { in: 'path', description: 'Feature suggestion ID', required: true, type: 'string' }
  */
  try {
    const { id } = req.params;
    const suggestion = await FeatureSuggestion.findById(id).populate(
      "suggestedBy",
      "firstName lastName email"
    );
    if (!suggestion) {
      return ErrorHandler("Feature suggestion not found.", 404, req, res);
    }
    return SuccessHandler(suggestion, 200, res);
  } catch (error) {
    return ErrorHandler(error.message, 500, req, res);
  }
};

/**
 * @desc Update a feature suggestion
 * @route PUT /api/feature-suggestions/:id
 * @access Private (Barber/Staff)
 */
const updateFeatureSuggestion = async (req, res) => {
  // #swagger.tags = ['FeatureSuggestions']
  /* #swagger.description = 'Update a feature suggestion.'
     #swagger.security = [{ "Bearer": [] }]
     #swagger.parameters['id'] = { in: 'path', description: 'Feature suggestion ID', required: true, type: 'string' }
     #swagger.parameters['obj'] = {
        in: 'body',
        description: 'Fields to update.',
        required: true,
        schema: {
          title: 'Updated Feature Title',
          description: 'Updated description.'
        }
     }
  */
  try {
    const { id } = req.params;
    const { title, description } = req.body;
    const suggestion = await FeatureSuggestion.findById(id);
    if (!suggestion) {
      return ErrorHandler("Feature suggestion not found.", 404, req, res);
    }
    if (title) suggestion.title = title;
    if (description) suggestion.description = description;
    await suggestion.save();
    return SuccessHandler(suggestion, 200, res);
  } catch (error) {
    return ErrorHandler(error.message, 500, req, res);
  }
};

/**
 * @desc Delete a feature suggestion
 * @route DELETE /api/feature-suggestions/:id
 * @access Private (Barber/Staff)
 */
const deleteFeatureSuggestion = async (req, res) => {
  // #swagger.tags = ['FeatureSuggestions']
  /* #swagger.description = 'Delete a feature suggestion.'
     #swagger.security = [{ "Bearer": [] }]
     #swagger.parameters['id'] = { in: 'path', description: 'Feature suggestion ID', required: true, type: 'string' }
  */
  try {
    const { id } = req.params;
    const suggestion = await FeatureSuggestion.findByIdAndDelete(id);
    if (!suggestion) {
      return ErrorHandler("Feature suggestion not found.", 404, req, res);
    }
    return SuccessHandler({ message: "Feature suggestion deleted." }, 200, res);
  } catch (error) {
    return ErrorHandler(error.message, 500, req, res);
  }
};

module.exports = {
  createFeatureSuggestion,
  getAllFeatureSuggestions,
  getFeatureSuggestionById,
  updateFeatureSuggestion,
  deleteFeatureSuggestion,
};
