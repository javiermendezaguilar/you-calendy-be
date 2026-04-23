const mongoose = require("mongoose");
const HaircutGallery = require("../models/haircutGallery");
const Client = require("../models/client");
const Business = require("../models/User/business");
const SuccessHandler = require("../utils/SuccessHandler");
const ErrorHandler = require("../utils/ErrorHandler");
const { uploadToCloudinary, deleteImage } = require("../functions/cloudinary");

const toValidatedObjectId = (value) => {
  if (value instanceof mongoose.Types.ObjectId) return value;
  if (!mongoose.Types.ObjectId.isValid(value)) return null;
  return new mongoose.Types.ObjectId(value);
};

const getAuthenticatedClientActorId = (req) => {
  if (req.user?.type !== "client" || !req.client?._id) {
    return null;
  }

  return req.client._id.toString();
};

const ensureClientGalleryActor = (req, res) => {
  const clientActorId = getAuthenticatedClientActorId(req);
  if (!clientActorId) {
    ErrorHandler(
      "Only authenticated clients can manage client gallery entries.",
      403,
      req,
      res
    );
    return null;
  }

  return clientActorId;
};

const getOwnerBusiness = async (req, res) => {
  const business = await Business.findOne({ owner: req.user.id });
  if (!business) {
    ErrorHandler("Business not found for this user.", 404, req, res);
    return null;
  }

  return business;
};

const getBusinessClient = async (req, res, businessId, clientId) => {
  const validatedBusinessId = toValidatedObjectId(businessId);
  const validatedClientId = toValidatedObjectId(clientId);
  if (!validatedBusinessId || !validatedClientId) {
    ErrorHandler("Client not found.", 404, req, res);
    return null;
  }

  const businessClients = await Client.find({ business: validatedBusinessId });
  const client =
    businessClients.find(
      (candidate) => candidate._id.toString() === validatedClientId.toString()
    ) || null;

  if (!client || !client.business) {
    ErrorHandler("Client not found.", 404, req, res);
    return null;
  }

  return client;
};

const getBusinessGalleryEntry = async (
  req,
  res,
  businessId,
  galleryId,
  requireActive = true
) => {
  const validatedBusinessId = toValidatedObjectId(businessId);
  const validatedGalleryId = toValidatedObjectId(galleryId);
  if (!validatedBusinessId || !validatedGalleryId) {
    ErrorHandler("Gallery entry not found.", 404, req, res);
    return null;
  }

  const businessGalleryEntries = await HaircutGallery.find({
    business: validatedBusinessId,
    ...(requireActive ? { isActive: true } : {}),
  });
  const galleryEntry =
    businessGalleryEntries.find(
      (candidate) => candidate._id.toString() === validatedGalleryId.toString()
    ) || null;

  if (!galleryEntry || !galleryEntry.business) {
    ErrorHandler("Gallery entry not found.", 404, req, res);
    return null;
  }

  return galleryEntry;
};

const getOwnerGalleryContext = async (
  req,
  res,
  galleryId,
  clientId,
  requireActive = true
) => {
  const business = await getOwnerBusiness(req, res);
  if (!business) {
    return null;
  }

  const galleryEntry = await getBusinessGalleryEntry(
    req,
    res,
    business._id,
    galleryId,
    requireActive
  );
  if (!galleryEntry) {
    return null;
  }

  const client = await getBusinessClient(req, res, business._id, clientId);
  if (!client) {
    return null;
  }

  return { business, galleryEntry, client };
};

const getOwnedActiveGalleryEntry = async (req, res, galleryId, ownershipMessage) => {
  const clientActorId = getAuthenticatedClientActorId(req);
  const validatedBusinessId = toValidatedObjectId(req.client?.business);
  if (!clientActorId || !validatedBusinessId) {
    ErrorHandler(ownershipMessage, 403, req, res);
    return null;
  }

  const validatedGalleryId = toValidatedObjectId(galleryId);
  if (!validatedGalleryId) {
    ErrorHandler("Gallery entry not found.", 404, req, res);
    return null;
  }

  const businessActiveEntries = await HaircutGallery.find({
    business: validatedBusinessId,
    isActive: true,
  });
  const galleryEntry =
    businessActiveEntries.find(
      (candidate) => candidate._id.toString() === validatedGalleryId.toString()
    ) || null;

  if (!galleryEntry) {
    ErrorHandler("Gallery entry not found.", 404, req, res);
    return null;
  }

  if (galleryEntry.client.toString() !== clientActorId) {
    ErrorHandler(ownershipMessage, 403, req, res);
    return null;
  }

  return galleryEntry;
};

const uploadOptionalGalleryImage = async (req, folder, failureMessage) => {
  if (!req.file) {
    return { imageUrl: null, imagePublicId: null };
  }

  try {
    const uploadResult = await uploadToCloudinary(req.file.buffer, folder);
    return {
      imageUrl: uploadResult.secure_url,
      imagePublicId: uploadResult.public_id,
    };
  } catch (uploadError) {
    console.error(failureMessage, uploadError.message);
    throw new Error(failureMessage);
  }
};

const addSuggestionToGallery = async (galleryEntry, note, createdBy, imageData) => {
  const suggestionData = {
    note,
    createdBy,
  };

  if (imageData.imageUrl) {
    suggestionData.imageUrl = imageData.imageUrl;
    suggestionData.imagePublicId = imageData.imagePublicId;
  }

  galleryEntry.suggestions.push(suggestionData);
  await galleryEntry.save();

  return galleryEntry;
};

const addReportToGallery = async (
  galleryEntry,
  note,
  reportType,
  createdBy,
  rating,
  imageData
) => {
  const reportData = {
    note,
    reportType,
    createdBy,
  };

  if (imageData.imageUrl) {
    reportData.imageUrl = imageData.imageUrl;
    reportData.imagePublicId = imageData.imagePublicId;
  }

  if (rating !== undefined) {
    reportData.rating = parseInt(rating);
  }

  galleryEntry.reports.push(reportData);
  await galleryEntry.save();

  return galleryEntry;
};

const softDeleteGalleryEntry = async (galleryEntry) => {
  if (galleryEntry.imagePublicId) {
    try {
      await deleteImage(galleryEntry.imagePublicId);
    } catch (cloudinaryError) {
      console.error(
        "Failed to delete image from Cloudinary:",
        cloudinaryError
      );
    }
  }

  galleryEntry.isActive = false;
  await galleryEntry.save();
};

const deleteGalleryEntryAndRespond = async (galleryEntry, res) => {
  await softDeleteGalleryEntry(galleryEntry);
  return SuccessHandler(
    { message: "Gallery image deleted successfully." },
    200,
    res
  );
};

const validateOptionalRating = (req, res, rating) => {
  if (rating === undefined) {
    return true;
  }

  const ratingNum = parseInt(rating);
  if (isNaN(ratingNum) || ratingNum < 1 || ratingNum > 5) {
    ErrorHandler("Rating must be a number between 1 and 5.", 400, req, res);
    return false;
  }

  return true;
};

const handleGalleryUploadFailure = (error, req, res, fallbackMessage) => {
  const isUploadFailure = error.message === fallbackMessage;
  return ErrorHandler(
    isUploadFailure ? `${fallbackMessage} Please try again.` : error.message,
    500,
    req,
    res
  );
};

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
    const business = await getOwnerBusiness(req, res);
    if (!business) {
      return;
    }

    // Check if client exists and belongs to this business
    const client = await getBusinessClient(req, res, business._id, clientId);
    if (!client) {
      return;
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
    const clientActorId = ensureClientGalleryActor(req, res);
    if (!clientActorId) {
      return;
    }

    if (clientActorId !== String(clientId)) {
      return ErrorHandler(
        "You can only upload photos to your own gallery.",
        403,
        req,
        res
      );
    }

    // Validate file
    if (!req.file) {
      return ErrorHandler("Image file is required.", 400, req, res);
    }

    // Validate client exists and is active
    const client = await Client.findOne({ _id: clientActorId, isActive: true });
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
    const business = await getOwnerBusiness(req, res);
    if (!business) {
      return;
    }

    // Check if client exists and belongs to this business
    const client = await getBusinessClient(req, res, business._id, clientId);
    if (!client) {
      return;
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

    const ownerContext = await getOwnerGalleryContext(req, res, galleryId, clientId);
    if (!ownerContext) {
      return;
    }
    const { galleryEntry } = ownerContext;

    const { imageUrl, imagePublicId } = await uploadOptionalGalleryImage(
      req,
      "haircut-suggestions",
      "Failed to upload suggestion image."
    );

    const updatedGalleryEntry = await addSuggestionToGallery(
      galleryEntry,
      note,
      clientId,
      { imageUrl, imagePublicId }
    );

    return SuccessHandler(updatedGalleryEntry, 200, res);
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

    const ownerContext = await getOwnerGalleryContext(req, res, galleryId, clientId);
    if (!ownerContext) {
      return;
    }
    const { galleryEntry } = ownerContext;

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
        if (suggestionToEdit.imagePublicId) {
          await deleteImage(suggestionToEdit.imagePublicId);
        }

        const uploadResult = await uploadOptionalGalleryImage(
          req,
          "haircut-suggestions",
          "Failed to update suggestion image."
        );
        suggestionToEdit.imageUrl = uploadResult.imageUrl;
        suggestionToEdit.imagePublicId = uploadResult.imagePublicId;
      } catch (uploadError) {
        return ErrorHandler(uploadError.message, 500, req, res);
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

    if (!validateOptionalRating(req, res, rating)) {
      return;
    }

    const ownerContext = await getOwnerGalleryContext(req, res, galleryId, clientId);
    if (!ownerContext) {
      return;
    }
    const { galleryEntry } = ownerContext;

    const { imageUrl, imagePublicId } = await uploadOptionalGalleryImage(
      req,
      "haircut-reports",
      "Failed to upload report image."
    );

    const updatedGalleryEntry = await addReportToGallery(
      galleryEntry,
      note,
      reportType,
      clientId,
      rating,
      { imageUrl, imagePublicId }
    );

    return SuccessHandler(updatedGalleryEntry, 200, res);
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
    const business = await getOwnerBusiness(req, res);
    if (!business) {
      return;
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
    const business = await getOwnerBusiness(req, res);
    if (!business) {
      return;
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
    const business = await getOwnerBusiness(req, res);
    if (!business) {
      return;
    }

    // Check if gallery entry exists and belongs to this business
    const galleryEntry = await getBusinessGalleryEntry(
      req,
      res,
      business._id,
      galleryId,
      false
    );
    if (!galleryEntry) {
      return;
    }

    return deleteGalleryEntryAndRespond(galleryEntry, res);
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
    const clientActorId = ensureClientGalleryActor(req, res);
    if (!clientActorId) {
      return;
    }

    if (!note) {
      return ErrorHandler("Suggestion note is required.", 400, req, res);
    }

    const galleryEntry = await getOwnedActiveGalleryEntry(
      req,
      res,
      galleryId,
      "You can only suggest changes on your own photos."
    );
    if (!galleryEntry) {
      return;
    }

    const { imageUrl, imagePublicId } = await uploadOptionalGalleryImage(
      req,
      "haircut-suggestions",
      "Failed to upload suggestion image."
    );

    const updatedGalleryEntry = await addSuggestionToGallery(
      galleryEntry,
      note,
      clientActorId,
      { imageUrl, imagePublicId }
    );

    return SuccessHandler(updatedGalleryEntry, 200, res);
  } catch (error) {
    return handleGalleryUploadFailure(
      error,
      req,
      res,
      "Failed to upload suggestion image."
    );
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
    const clientActorId = ensureClientGalleryActor(req, res);
    if (!clientActorId) {
      return;
    }

    if (!note) {
      return ErrorHandler("Report note is required.", 400, req, res);
    }

    if (!validateOptionalRating(req, res, rating)) {
      return;
    }

    const galleryEntry = await getOwnedActiveGalleryEntry(
      req,
      res,
      galleryId,
      "You can only report your own photos."
    );
    if (!galleryEntry) {
      return;
    }

    const { imageUrl, imagePublicId } = await uploadOptionalGalleryImage(
      req,
      "haircut-reports",
      "Failed to upload report image."
    );

    const updatedGalleryEntry = await addReportToGallery(
      galleryEntry,
      note,
      reportType,
      clientActorId,
      rating,
      { imageUrl, imagePublicId }
    );

    return SuccessHandler(updatedGalleryEntry, 200, res);
  } catch (error) {
    return handleGalleryUploadFailure(
      error,
      req,
      res,
      "Failed to upload report image."
    );
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
    const clientActorId = ensureClientGalleryActor(req, res);
    if (!clientActorId) {
      return;
    }

    const galleryEntry = await getOwnedActiveGalleryEntry(
      req,
      res,
      galleryId,
      "You can only delete your own photos."
    );
    if (!galleryEntry) {
      return;
    }

    return deleteGalleryEntryAndRespond(galleryEntry, res);
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
