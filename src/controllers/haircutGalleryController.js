const HaircutGallery = require("../models/haircutGallery");
const Client = require("../models/client");
const Business = require("../models/User/business");
const SuccessHandler = require("../utils/SuccessHandler");
const ErrorHandler = require("../utils/ErrorHandler");
const { uploadToCloudinary, deleteImage } = require("../functions/cloudinary");

/**
 * @desc Upload a new haircut image to the gallery
 * @route POST /api/business/clients/:clientId/gallery
 * @access Private (Business Owner)
 */
const uploadHaircutImage = async (req, res) => {
  // #swagger.tags = ['Haircut Gallery']
  /* #swagger.description = 'Upload a new haircut image for a specific client.'
       #swagger.security = [{ "Bearer": [] }]
       #swagger.consumes = ['multipart/form-data']
       #swagger.parameters['image'] = { in: 'formData', type: 'file', required: true, description: 'Haircut image file' }
       #swagger.parameters['title'] = { in: 'formData', type: 'string', description: 'Image title' }
       #swagger.parameters['description'] = { in: 'formData', type: 'string', description: 'Image description' }
       #swagger.parameters['haircutStyle'] = { in: 'formData', type: 'string', description: 'Haircut style' }
       #swagger.parameters['appointment'] = { in: 'formData', type: 'string', description: 'Appointment ID (optional)' }
       #swagger.parameters['staff'] = { in: 'formData', type: 'string', description: 'Staff ID (optional)' }
    */
  try {
    const { clientId } = req.params;
    const { title, description, haircutStyle, appointment, staff } = req.body;

    // Check if business exists
    const business = await Business.findOne({ owner: req.user.id });
    if (!business) {
      return ErrorHandler("Business not found for this user.", 404, req, res);
    }

    // Check if client exists and belongs to this business
    const client = await Client.findOne({
      _id: clientId,
      business: business._id,
    });
    if (!client) {
      return ErrorHandler("Client not found.", 404, req, res);
    }

    // Check if image file exists
    if (!req.file) {
      return ErrorHandler("Image file is required.", 400, req, res);
    }

    // Upload image to Cloudinary
    const uploadResult = await uploadToCloudinary(
      req.file.buffer,
      "haircut-gallery"
    );

    // Create gallery entry
    const galleryData = {
      client: clientId,
      business: business._id,
      imageUrl: uploadResult.secure_url,
      imagePublicId: uploadResult.public_id,
      title: title || "Haircut Image",
      description,
      haircutStyle,
      appointment,
      staff,
    };

    const newGalleryEntry = await HaircutGallery.create(galleryData);

    return SuccessHandler(newGalleryEntry, 201, res);
  } catch (error) {
    return ErrorHandler(error.message, 500, req, res);
  }
};

/**
 * @desc Client uploads a single haircut image to their own gallery
 * @route POST /api/client/gallery/:clientId
 * @access Public (or client-authenticated if available)
 */
const uploadHaircutImageByClient = async (req, res) => {
  try {
    const { clientId } = req.params;
    const { title } = req.body; // Extract title from request body

    // Validate file
    if (!req.file) {
      return ErrorHandler("Image file is required.", 400, req, res);
    }

    // Validate client exists and is active
    const client = await Client.findById(clientId);
    if (!client || !client.isActive) {
      return ErrorHandler("Client not found or inactive.", 404, req, res);
    }

    // Upload image to Cloudinary
    const uploadResult = await uploadToCloudinary(
      req.file.buffer,
      "haircut-gallery"
    );

    // Create gallery entry with title
    const galleryData = {
      client: clientId,
      business: client.business,
      imageUrl: uploadResult.secure_url,
      imagePublicId: uploadResult.public_id,
      title: title || "New Haircut Photo", // Provide default title if not provided
    };

    const newGalleryEntry = await HaircutGallery.create(galleryData);
    return SuccessHandler(newGalleryEntry, 201, res);
  } catch (error) {
    return ErrorHandler(error.message, 500, req, res);
  }
};

/**
 * @desc Get all haircut images for a client
 * @route GET /api/business/clients/:clientId/gallery
 * @access Private (Business Owner)
 */
const getClientGallery = async (req, res) => {
  // #swagger.tags = ['Haircut Gallery']
  /* #swagger.description = 'Get all haircut images for a specific client.'
       #swagger.security = [{ "Bearer": [] }]
       #swagger.parameters['page'] = { in: 'query', description: 'Page number for pagination', type: 'integer' }
       #swagger.parameters['limit'] = { in: 'query', description: 'Number of items per page', type: 'integer' }
       #swagger.parameters['sort'] = { in: 'query', description: 'Sort by field (e.g., createdAt:desc)', type: 'string' }
    */
  try {
    const { clientId } = req.params;
    const { page = 1, limit = 10, sort = "createdAt:desc" } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Check if business exists
    const business = await Business.findOne({ owner: req.user.id });
    if (!business) {
      return ErrorHandler("Business not found for this user.", 404, req, res);
    }

    // Check if client exists and belongs to this business
    const client = await Client.findOne({
      _id: clientId,
      business: business._id,
    });
    if (!client) {
      return ErrorHandler("Client not found.", 404, req, res);
    }

    // Parse sort parameter
    const [sortField, sortOrder] = sort.split(":");
    const sortObj = { [sortField]: sortOrder === "desc" ? -1 : 1 };

    const gallery = await HaircutGallery.find({
      client: clientId,
      business: business._id,
      isActive: true,
    })
      .populate("staff", "firstName lastName")
      .populate("appointment", "date service")
      .sort(sortObj)
      .skip(skip)
      .limit(parseInt(limit));

    const total = await HaircutGallery.countDocuments({
      client: clientId,
      business: business._id,
      isActive: true,
    });

    return SuccessHandler(
      {
        gallery,
        pagination: {
          total,
          page: parseInt(page),
          pages: Math.ceil(total / parseInt(limit)),
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
 * @desc Add a suggestion to a specific haircut image
 * @route POST /api/business/gallery/:galleryId/suggestions
 * @access Private (Business Owner)
 */
const addSuggestion = async (req, res) => {
  // #swagger.tags = ['Haircut Gallery']
  /* #swagger.description = 'Add a suggestion note to a specific haircut image.'
       #swagger.security = [{ "Bearer": [] }]
       #swagger.consumes = ['multipart/form-data']
       #swagger.parameters['note'] = { in: 'formData', type: 'string', required: true, description: 'Suggestion note' }
       #swagger.parameters['clientId'] = { in: 'formData', type: 'string', required: true, description: 'Client ID' }
       #swagger.parameters['image'] = { in: 'formData', type: 'file', description: 'Suggestion image (optional)' }
    */
  try {
    const { galleryId } = req.params;
    const { note, clientId } = req.body;

    if (!note) {
      return ErrorHandler("Suggestion note is required.", 400, req, res);
    }

    // Check if business exists
    const business = await Business.findOne({ owner: req.user.id });
    if (!business) {
      return ErrorHandler("Business not found for this user.", 404, req, res);
    }

    // Check if gallery entry exists and belongs to this business
    const galleryEntry = await HaircutGallery.findOne({
      _id: galleryId,
      business: business._id,
      isActive: true,
    });
    if (!galleryEntry) {
      return ErrorHandler("Gallery entry not found.", 404, req, res);
    }

    // Check if client exists and belongs to this business
    const client = await Client.findOne({
      _id: clientId,
      business: business._id,
    });
    if (!client) {
      return ErrorHandler("Client not found.", 404, req, res);
    }

    // Handle image upload if provided
    let imageUrl = null;
    let imagePublicId = null;
    if (req.file) {
      try {
        const uploadResult = await uploadToCloudinary(
          req.file.buffer,
          "haircut-suggestions"
        );
        imageUrl = uploadResult.secure_url;
        imagePublicId = uploadResult.public_id;
      } catch (uploadError) {
        console.error(
          "Failed to upload suggestion image:",
          uploadError.message
        );
        return ErrorHandler(
          "Failed to upload suggestion image. Please try again.",
          500,
          req,
          res
        );
      }
    }

    // Add suggestion with image if provided
    const suggestionData = {
      note,
      createdBy: clientId,
    };

    if (imageUrl) {
      suggestionData.imageUrl = imageUrl;
      suggestionData.imagePublicId = imagePublicId;
    }

    galleryEntry.suggestions.push(suggestionData);

    await galleryEntry.save();

    return SuccessHandler(galleryEntry, 200, res);
  } catch (error) {
    return ErrorHandler(error.message, 500, req, res);
  }
};

/**
 * @desc Edit an existing suggestion on a haircut image
 * @route PUT /api/business/gallery/:galleryId/suggestions/:suggestionId
 * @access Private (Business Owner)
 */
const editSuggestion = async (req, res) => {
  // #swagger.tags = ['Haircut Gallery']
  /* #swagger.description = 'Edit an existing suggestion on a specific haircut image.'
       #swagger.security = [{ "Bearer": [] }]
       #swagger.consumes = ['multipart/form-data']
       #swagger.parameters['note'] = { in: 'formData', type: 'string', description: 'Updated suggestion note' }
       #swagger.parameters['clientId'] = { in: 'formData', type: 'string', required: true, description: 'Client ID' }
       #swagger.parameters['image'] = { in: 'formData', type: 'file', description: 'Updated suggestion image (optional)' }
    */
  try {
    const { galleryId, suggestionId } = req.params;
    const { note, clientId } = req.body;

    // Check if business exists
    const business = await Business.findOne({ owner: req.user.id });
    if (!business) {
      return ErrorHandler("Business not found for this user.", 404, req, res);
    }

    // Check if gallery entry exists and belongs to this business
    const galleryEntry = await HaircutGallery.findOne({
      _id: galleryId,
      business: business._id,
      isActive: true,
    });
    if (!galleryEntry) {
      return ErrorHandler("Gallery entry not found.", 404, req, res);
    }

    // Check if client exists and belongs to this business
    const client = await Client.findOne({
      _id: clientId,
      business: business._id,
    });
    if (!client) {
      return ErrorHandler("Client not found.", 404, req, res);
    }

    // Find the suggestion to edit
    const suggestionToEdit = galleryEntry.suggestions.id(suggestionId);
    if (!suggestionToEdit) {
      return ErrorHandler("Suggestion not found.", 404, req, res);
    }

    // Update note if provided
    if (note) {
      suggestionToEdit.note = note;
    }

    // Handle image update if provided
    if (req.file) {
      try {
        // Delete old image if exists
        if (suggestionToEdit.imagePublicId) {
          await deleteImage(suggestionToEdit.imagePublicId);
        }

        // Upload new image
        const uploadResult = await uploadToCloudinary(
          req.file.buffer,
          "haircut-suggestions"
        );
        suggestionToEdit.imageUrl = uploadResult.secure_url;
        suggestionToEdit.imagePublicId = uploadResult.public_id;
      } catch (uploadError) {
        console.error(
          "Failed to update suggestion image:",
          uploadError.message
        );
        return ErrorHandler(
          "Failed to update suggestion image. Please try again.",
          500,
          req,
          res
        );
      }
    }

    // Mark suggestion as updated
    suggestionToEdit.updatedAt = new Date();

    await galleryEntry.save();

    return SuccessHandler(galleryEntry, 200, res);
  } catch (error) {
    return ErrorHandler(error.message, 500, req, res);
  }
};

/**
 * @desc Report a haircut image
 * @route POST /api/business/gallery/:galleryId/reports
 * @access Private (Business Owner)
 */
const reportImage = async (req, res) => {
  // #swagger.tags = ['Haircut Gallery']
  /* #swagger.description = 'Report an issue with a specific haircut image.'
       #swagger.security = [{ "Bearer": [] }]
       #swagger.consumes = ['multipart/form-data']
       #swagger.parameters['note'] = { in: 'formData', type: 'string', required: true, description: 'Report note' }
       #swagger.parameters['reportType'] = { in: 'formData', type: 'string', description: 'Report type (default: other)' }
       #swagger.parameters['clientId'] = { in: 'formData', type: 'string', required: true, description: 'Client ID' }
       #swagger.parameters['rating'] = { in: 'formData', type: 'number', description: 'Rating (1-5)' }
       #swagger.parameters['image'] = { in: 'formData', type: 'file', description: 'Report image (optional)' }
    */
  try {
    const { galleryId } = req.params;
    const { note, reportType = "other", clientId, rating } = req.body;

    if (!note) {
      return ErrorHandler("Report note is required.", 400, req, res);
    }

    // Validate rating if provided
    if (rating !== undefined) {
      const ratingNum = parseInt(rating);
      if (isNaN(ratingNum) || ratingNum < 1 || ratingNum > 5) {
        return ErrorHandler(
          "Rating must be a number between 1 and 5.",
          400,
          req,
          res
        );
      }
    }

    // Check if business exists
    const business = await Business.findOne({ owner: req.user.id });
    if (!business) {
      return ErrorHandler("Business not found for this user.", 404, req, res);
    }

    // Check if gallery entry exists and belongs to this business
    const galleryEntry = await HaircutGallery.findOne({
      _id: galleryId,
      business: business._id,
      isActive: true,
    });
    if (!galleryEntry) {
      return ErrorHandler("Gallery entry not found.", 404, req, res);
    }

    // Check if client exists and belongs to this business
    const client = await Client.findOne({
      _id: clientId,
      business: business._id,
    });
    if (!client) {
      return ErrorHandler("Client not found.", 404, req, res);
    }

    // Handle image upload if provided
    let imageUrl = null;
    let imagePublicId = null;
    if (req.file) {
      try {
        const uploadResult = await uploadToCloudinary(
          req.file.buffer,
          "haircut-reports"
        );
        imageUrl = uploadResult.secure_url;
        imagePublicId = uploadResult.public_id;
      } catch (uploadError) {
        console.error("Failed to upload report image:", uploadError.message);
        return ErrorHandler(
          "Failed to upload report image. Please try again.",
          500,
          req,
          res
        );
      }
    }

    // Add report with image and rating if provided
    const reportData = {
      note,
      reportType,
      createdBy: clientId,
    };

    if (imageUrl) {
      reportData.imageUrl = imageUrl;
      reportData.imagePublicId = imagePublicId;
    }

    if (rating !== undefined) {
      reportData.rating = parseInt(rating);
    }

    galleryEntry.reports.push(reportData);

    await galleryEntry.save();

    return SuccessHandler(galleryEntry, 200, res);
  } catch (error) {
    return ErrorHandler(error.message, 500, req, res);
  }
};

/**
 * @desc Get all reported images for business review
 * @route GET /api/business/gallery/reports
 * @access Private (Business Owner)
 */
const getReportedImages = async (req, res) => {
  // #swagger.tags = ['Haircut Gallery']
  /* #swagger.description = 'Get all reported images for business review.'
       #swagger.security = [{ "Bearer": [] }]
       #swagger.parameters['status'] = { in: 'query', description: 'Filter by report status (pending, reviewed, resolved, dismissed)', type: 'string' }
       #swagger.parameters['page'] = { in: 'query', description: 'Page number for pagination', type: 'integer' }
       #swagger.parameters['limit'] = { in: 'query', description: 'Number of items per page', type: 'integer' }
    */
  try {
    const { status, page = 1, limit = 10 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Check if business exists
    const business = await Business.findOne({ owner: req.user.id });
    if (!business) {
      return ErrorHandler("Business not found for this user.", 404, req, res);
    }

    let query = {
      business: business._id,
      isActive: true,
      "reports.0": { $exists: true }, // Has at least one report
    };

    if (status) {
      query["reports.status"] = status;
    }

    const reportedImages = await HaircutGallery.find(query)
      .populate("client", "firstName lastName email")
      .populate("staff", "firstName lastName")
      .populate("reports.createdBy", "firstName lastName")
      .sort({ "reports.createdAt": -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await HaircutGallery.countDocuments(query);

    return SuccessHandler(
      {
        reportedImages,
        pagination: {
          total,
          page: parseInt(page),
          pages: Math.ceil(total / parseInt(limit)),
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
 * @desc Review and update report status
 * @route PUT /api/business/gallery/reports/:galleryId/:reportId
 * @access Private (Business Owner)
 */
const reviewReport = async (req, res) => {
  // #swagger.tags = ['Haircut Gallery']
  /* #swagger.description = 'Review and update the status of a specific report.'
       #swagger.security = [{ "Bearer": [] }]
       #swagger.parameters['obj'] = {
          in: 'body',
          description: 'Review details.',
          required: true,
          schema: {
            status: 'resolved',
            reviewNote: 'Image has been reviewed and is appropriate.'
          }
       }
    */
  try {
    const { galleryId, reportId } = req.params;
    const { status, reviewNote } = req.body;

    if (!status) {
      return ErrorHandler("Status is required.", 400, req, res);
    }

    // Check if business exists
    const business = await Business.findOne({ owner: req.user.id });
    if (!business) {
      return ErrorHandler("Business not found for this user.", 404, req, res);
    }

    // Update the specific report
    const result = await HaircutGallery.updateOne(
      {
        _id: galleryId,
        business: business._id,
        "reports._id": reportId,
      },
      {
        $set: {
          "reports.$.status": status,
          "reports.$.reviewNote": reviewNote,
          "reports.$.reviewedBy": req.user.id,
          "reports.$.reviewedAt": new Date(),
        },
      }
    );

    if (result.matchedCount === 0) {
      return ErrorHandler("Report not found.", 404, req, res);
    }

    // If status is resolved or dismissed, remove the report
    if (status === "resolved" || status === "dismissed") {
      await HaircutGallery.updateOne(
        { _id: galleryId },
        { $pull: { reports: { _id: reportId } } }
      );
    }

    return SuccessHandler(
      { message: "Report status updated successfully." },
      200,
      res
    );
  } catch (error) {
    return ErrorHandler(error.message, 500, req, res);
  }
};

/**
 * @desc Delete a haircut image from gallery
 * @route DELETE /api/business/gallery/:galleryId
 * @access Private (Business Owner)
 */
const deleteGalleryImage = async (req, res) => {
  // #swagger.tags = ['Haircut Gallery']
  /* #swagger.description = 'Delete a haircut image from the gallery.'
       #swagger.security = [{ "Bearer": [] }]
    */
  try {
    const { galleryId } = req.params;

    // Check if business exists
    const business = await Business.findOne({ owner: req.user.id });
    if (!business) {
      return ErrorHandler("Business not found for this user.", 404, req, res);
    }

    // Check if gallery entry exists and belongs to this business
    const galleryEntry = await HaircutGallery.findOne({
      _id: galleryId,
      business: business._id,
    });
    if (!galleryEntry) {
      return ErrorHandler("Gallery entry not found.", 404, req, res);
    }

    // Delete image from Cloudinary if exists
    if (galleryEntry.imagePublicId) {
      try {
        await deleteImage(galleryEntry.imagePublicId);
      } catch (cloudinaryError) {
        console.error(
          "Failed to delete image from Cloudinary:",
          cloudinaryError
        );
        // Continue with deletion even if Cloudinary deletion fails
      }
    }

    // Soft delete
    await HaircutGallery.findByIdAndUpdate(galleryId, { isActive: false });

    return SuccessHandler(
      { message: "Gallery image deleted successfully." },
      200,
      res
    );
  } catch (error) {
    return ErrorHandler(error.message, 500, req, res);
  }
};

/**
 * @desc Add a suggestion to a specific haircut image (Client-side)
 * @route POST /api/client/gallery/:galleryId/suggestions
 * @access Public (Client with client-id header)
 */
const addSuggestionByClient = async (req, res) => {
  // #swagger.tags = ['Client Gallery']
  /* #swagger.description = 'Add a suggestion note to a specific haircut image by client.'
       #swagger.parameters['x-client-id'] = { in: 'header', type: 'string', description: 'Client ID (optional if invitationToken provided)' }
       #swagger.parameters['invitationToken'] = { in: 'query', type: 'string', description: 'Invitation token (optional if x-client-id provided)' }
       #swagger.consumes = ['multipart/form-data']
       #swagger.parameters['note'] = { in: 'formData', type: 'string', required: true, description: 'Suggestion note' }
       #swagger.parameters['image'] = { in: 'formData', type: 'file', description: 'Suggestion image (optional)' }
    */
  try {
    const { galleryId } = req.params;
    const { note } = req.body;
    const { invitationToken } = req.query;
    let clientId = req.headers["x-client-id"];

    if (!note) {
      return ErrorHandler("Suggestion note is required.", 400, req, res);
    }

    // If no client ID in header, try to get it from invitation token
    if (!clientId && invitationToken) {
      const client = await Client.findOne({ invitationToken });
      if (client) {
        clientId = client._id.toString();
      }
    }

    if (!clientId) {
      return ErrorHandler(
        "Client ID is required in headers or invitation token in query.",
        400,
        req,
        res
      );
    }

    // Check if gallery entry exists and is active
    const galleryEntry = await HaircutGallery.findOne({
      _id: galleryId,
      isActive: true,
    });
    if (!galleryEntry) {
      return ErrorHandler("Gallery entry not found.", 404, req, res);
    }

    // Check if client exists and belongs to the same business as the gallery
    const client = await Client.findOne({
      _id: clientId,
      business: galleryEntry.business,
    });
    if (!client) {
      return ErrorHandler("Client not found or not authorized.", 404, req, res);
    }

    // Handle image upload if provided
    let imageUrl = null;
    let imagePublicId = null;
    if (req.file) {
      try {
        const uploadResult = await uploadToCloudinary(
          req.file.buffer,
          "haircut-suggestions"
        );
        imageUrl = uploadResult.secure_url;
        imagePublicId = uploadResult.public_id;
      } catch (uploadError) {
        console.error(
          "Failed to upload suggestion image:",
          uploadError.message
        );
        return ErrorHandler(
          "Failed to upload suggestion image. Please try again.",
          500,
          req,
          res
        );
      }
    }

    // Add suggestion with image if provided
    const suggestionData = {
      note,
      createdBy: clientId,
    };

    if (imageUrl) {
      suggestionData.imageUrl = imageUrl;
      suggestionData.imagePublicId = imagePublicId;
    }

    galleryEntry.suggestions.push(suggestionData);

    await galleryEntry.save();

    return SuccessHandler(galleryEntry, 200, res);
  } catch (error) {
    return ErrorHandler(error.message, 500, req, res);
  }
};

/**
 * @desc Report a haircut image (Client-side)
 * @route POST /api/client/gallery/:galleryId/reports
 * @access Public (Client with client-id header)
 */
const reportImageByClient = async (req, res) => {
  // #swagger.tags = ['Client Gallery']
  /* #swagger.description = 'Report an issue with a specific haircut image by client.'
       #swagger.parameters['x-client-id'] = { in: 'header', type: 'string', description: 'Client ID (optional if invitationToken provided)' }
       #swagger.parameters['invitationToken'] = { in: 'query', type: 'string', description: 'Invitation token (optional if x-client-id provided)' }
       #swagger.consumes = ['multipart/form-data']
       #swagger.parameters['note'] = { in: 'formData', type: 'string', required: true, description: 'Report note' }
       #swagger.parameters['reportType'] = { in: 'formData', type: 'string', description: 'Report type (default: other)' }
       #swagger.parameters['rating'] = { in: 'formData', type: 'number', description: 'Rating (1-5)' }
       #swagger.parameters['image'] = { in: 'formData', type: 'file', description: 'Report image (optional)' }
    */
  try {
    const { galleryId } = req.params;
    const { note, reportType = "other", rating } = req.body;
    const { invitationToken } = req.query;
    let clientId = req.headers["x-client-id"];

    if (!note) {
      return ErrorHandler("Report note is required.", 400, req, res);
    }

    // If no client ID in header, try to get it from invitation token
    if (!clientId && invitationToken) {
      const client = await Client.findOne({ invitationToken });
      if (client) {
        clientId = client._id.toString();
      }
    }

    if (!clientId) {
      return ErrorHandler(
        "Client ID is required in headers or invitation token in query.",
        400,
        req,
        res
      );
    }

    // Validate rating if provided
    if (rating !== undefined) {
      const ratingNum = parseInt(rating);
      if (isNaN(ratingNum) || ratingNum < 1 || ratingNum > 5) {
        return ErrorHandler(
          "Rating must be a number between 1 and 5.",
          400,
          req,
          res
        );
      }
    }

    // Check if gallery entry exists and is active
    const galleryEntry = await HaircutGallery.findOne({
      _id: galleryId,
      isActive: true,
    });
    if (!galleryEntry) {
      return ErrorHandler("Gallery entry not found.", 404, req, res);
    }

    // Check if client exists and belongs to the same business as the gallery
    const client = await Client.findOne({
      _id: clientId,
      business: galleryEntry.business,
    });
    if (!client) {
      return ErrorHandler("Client not found or not authorized.", 404, req, res);
    }

    // Handle image upload if provided
    let imageUrl = null;
    let imagePublicId = null;
    if (req.file) {
      try {
        const uploadResult = await uploadToCloudinary(
          req.file.buffer,
          "haircut-reports"
        );
        imageUrl = uploadResult.secure_url;
        imagePublicId = uploadResult.public_id;
      } catch (uploadError) {
        console.error("Failed to upload report image:", uploadError.message);
        return ErrorHandler(
          "Failed to upload report image. Please try again.",
          500,
          req,
          res
        );
      }
    }

    // Add report with image and rating if provided
    const reportData = {
      note,
      reportType,
      createdBy: clientId,
    };

    if (imageUrl) {
      reportData.imageUrl = imageUrl;
      reportData.imagePublicId = imagePublicId;
    }

    if (rating !== undefined) {
      reportData.rating = parseInt(rating);
    }

    galleryEntry.reports.push(reportData);

    await galleryEntry.save();

    return SuccessHandler(galleryEntry, 200, res);
  } catch (error) {
    return ErrorHandler(error.message, 500, req, res);
  }
};

/**
 * @desc Delete a haircut image from gallery (Client-side)
 * @route DELETE /api/client/gallery/:galleryId
 * @access Public (Client with client-id header or invitationToken)
 */
const deleteGalleryImageByClient = async (req, res) => {
  // #swagger.tags = ['Client Gallery']
  /* #swagger.description = 'Delete a haircut image from the gallery by client.'
       #swagger.parameters['x-client-id'] = { in: 'header', type: 'string', description: 'Client ID (optional if invitationToken provided)' }
       #swagger.parameters['invitationToken'] = { in: 'query', type: 'string', description: 'Invitation token (optional if x-client-id provided)' }
    */
  try {
    const { galleryId } = req.params;
    const { invitationToken } = req.query;
    let clientId = req.headers["x-client-id"];

    // If no client ID in header, try to get it from invitation token
    if (!clientId && invitationToken) {
      const client = await Client.findOne({ invitationToken });
      if (client) {
        clientId = client._id.toString();
      }
    }

    if (!clientId) {
      return ErrorHandler(
        "Client ID is required in headers or invitation token in query.",
        400,
        req,
        res
      );
    }

    // Check if gallery entry exists and is active
    const galleryEntry = await HaircutGallery.findOne({
      _id: galleryId,
      isActive: true,
    });
    if (!galleryEntry) {
      return ErrorHandler("Gallery entry not found.", 404, req, res);
    }

    // Check if client exists and belongs to the same business as the gallery
    const client = await Client.findOne({
      _id: clientId,
      business: galleryEntry.business,
    });
    if (!client) {
      return ErrorHandler("Client not found or not authorized.", 404, req, res);
    }

    // Verify that the gallery entry belongs to this client
    if (galleryEntry.client.toString() !== clientId) {
      return ErrorHandler(
        "You can only delete your own photos.",
        403,
        req,
        res
      );
    }

    // Delete image from Cloudinary if exists
    if (galleryEntry.imagePublicId) {
      try {
        await deleteImage(galleryEntry.imagePublicId);
      } catch (cloudinaryError) {
        console.error(
          "Failed to delete image from Cloudinary:",
          cloudinaryError
        );
        // Continue with deletion even if Cloudinary deletion fails
      }
    }

    // Soft delete
    await HaircutGallery.findByIdAndUpdate(galleryId, { isActive: false });

    return SuccessHandler(
      { message: "Gallery image deleted successfully." },
      200,
      res
    );
  } catch (error) {
    return ErrorHandler(error.message, 500, req, res);
  }
};

module.exports = {
  uploadHaircutImage,
  getClientGallery,
  addSuggestion,
  reportImage,
  getReportedImages,
  reviewReport,
  deleteGalleryImage,
  uploadHaircutImageByClient,
  addSuggestionByClient,
  reportImageByClient,
  deleteGalleryImageByClient,
  editSuggestion,
};
