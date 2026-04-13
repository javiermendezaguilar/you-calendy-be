const mongoose = require("mongoose");
const Client = require("../models/client");
const Business = require("../models/User/business");
const HaircutGallery = require("../models/haircutGallery");
const Appointment = require("../models/appointment");
const SuccessHandler = require("../utils/SuccessHandler");
const ErrorHandler = require("../utils/ErrorHandler");
const { generateInvitationToken, normalizePhone } = require("../utils/index");
const { parse } = require("csv-parse");
const uploader = require("../utils/uploader");
const {
  uploadFileToCloudinary,
  uploadToCloudinary,
  deleteImage,
} = require("../functions/cloudinary");
const { sendSMS } = require("../utils/twilio");
const jwt = require("jsonwebtoken");
const Note = require("../models/note");
const Auditing = require("../models/auditing");
const { sendSMSWithCredits } = require("../utils/creditAwareMessaging");

const normalizeLegacyNoteItem = (note) => ({
  _id: note._id,
  content: note.content,
  images: Array.isArray(note.images) ? note.images.filter(Boolean) : [],
  createdAt: note.createdAt,
  clientId: note.clientId,
  createdBy: note.createdBy,
  galleryId: null,
  galleryImage: null,
  galleryTitle: null,
  response: note.response || note.reviewNote,
  respondedBy: note.respondedBy || note.reviewedBy,
  respondedAt: note.respondedAt || note.reviewedAt,
  reportType: note.reportType,
  status: note.status,
  rating: note.rating,
  source: "note",
});

const normalizeGallerySuggestionItem = (gallery, suggestion) => ({
  _id: suggestion._id,
  content: suggestion.note,
  images: suggestion.imageUrl ? [suggestion.imageUrl] : [],
  createdAt: suggestion.createdAt,
  clientId: gallery.client,
  createdBy: suggestion.createdBy,
  galleryId: gallery._id,
  galleryImage: gallery.imageUrl,
  galleryTitle: gallery.title,
  response: suggestion.response,
  respondedBy: suggestion.respondedBy,
  respondedAt: suggestion.respondedAt,
  source: "gallery",
});

const normalizeGalleryReportItem = (gallery, report) => ({
  _id: report._id,
  content: report.note,
  reportType: report.reportType,
  status: report.status,
  rating: report.rating,
  images: report.imageUrl ? [report.imageUrl] : [],
  createdAt: report.createdAt,
  clientId: gallery.client,
  createdBy: report.createdBy,
  galleryId: gallery._id,
  galleryImage: gallery.imageUrl,
  galleryTitle: gallery.title,
  reviewNote: report.reviewNote,
  reviewedBy: report.reviewedBy,
  reviewedAt: report.reviewedAt,
  response: report.reviewNote,
  respondedBy: report.reviewedBy,
  respondedAt: report.reviewedAt,
  source: "gallery",
});

const sortByCreatedAtDesc = (a, b) =>
  new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();

const ALLOWED_REPORT_STATUSES = new Set([
  "pending",
  "reviewed",
  "resolved",
  "dismissed",
]);

/**
 * @desc Add a new client to a business (phone number only)
 * @route POST /api/business/clients
 * @access Private (Business Owner)
 */
const addClient = async (req, res) => {
  // #swagger.tags = ['Clients']
  /* #swagger.description = 'Add a new client to the currently logged-in user\'s business with phone number only. An SMS will be sent with invitation link.'
       #swagger.security = [{ "Bearer": [] }]
       #swagger.parameters['obj'] = {
          in: 'body',
          description: 'Client phone number.',
          required: true,
          schema: {
            phone: '+1234567890'
          }
       }
    */
  try {
    const { phone, staffId } = req.body;

    // Validate phone number
    if (!phone) {
      return ErrorHandler("Phone number is required", 400, req, res);
    }

    const userId = req.user._id || req.user.id;
    const business = await Business.findOne({ owner: userId });
    if (!business) {
      return ErrorHandler("Business not found for this user.", 404, req, res);
    }

    const { getCountryCode } = require("../utils/index");
    const countryHint = getCountryCode(business.contactInfo?.phone);
    const normalizedPhone = normalizePhone(phone, countryHint);

    // Check if client already exists for this business
    let existingClient = await Client.findOne({
      business: business._id,
      phone: normalizedPhone
    });

    if (existingClient && existingClient.registrationStatus === 'registered') {
      return ErrorHandler("A registered client with this phone number already exists for your business.", 400, req, res);
    }

    // Generate invitation token
    const invitationToken = generateInvitationToken();

    let client;
    if (existingClient) {
      // Update existing unregistered/pending client
      existingClient.invitationToken = invitationToken;
      existingClient.registrationStatus = 'pending';
      if (staffId) existingClient.staff = staffId;
      client = await existingClient.save();
    } else {
      // Create new client
      client = await Client.create({
        phone: normalizedPhone,
        business: business._id,
        staff: staffId || null,
        invitationToken: invitationToken,
        registrationStatus: 'pending',
        isProfileComplete: false,
      });
    }

    const newClient = client; // for compatibility with following code

    // Generate invitation link with business information
    const baseUrl = process.env.FRONTEND_URL || "http://localhost:5173";
    const invitationLink = `${baseUrl}/client/invitation/${invitationToken}?business=${business._id}`;

    // Send SMS with invitation link
    let smsSent = false;
    let smsError = null;

    try {
      const businessName =
        business.businessName || business.name || "Our Business";
      const smsMessage = `Hello! You've been invited to ${businessName}. Please complete your profile by clicking this link: ${invitationLink}`;

      console.log(
        `Attempting to send SMS to ${phone} for business ${business._id}`
      );


      // Send SMS with credit validation
      const smsResult = await sendSMSWithCredits(
        phone,
        smsMessage,
        business._id,
        req,
        res
      );

      // Check if credit validation failed
      if (smsResult && smsResult.error) {
        console.error(
          "Insufficient SMS credits for invitation:",
          smsResult.message
        );
        smsError = smsResult.message;
      } else if (smsResult && smsResult.success) {
        console.log(
          `SMS sent successfully to ${phone}. Message ID: ${smsResult.messageId}`
        );
        smsSent = true;
      }
    } catch (smsError) {
      console.error("Failed to send invitation SMS:", smsError.message);
      smsError = smsError.message;
    }

    return SuccessHandler(
      {
        message: smsSent
          ? "Client created successfully. Invitation SMS sent."
          : "Client created successfully. SMS could not be sent.",
        client: newClient,
        invitationLink: invitationLink,
        smsStatus: {
          sent: smsSent,
          error: smsError,
          businessCredits: business.smsCredits || 0,
        },
      },
      201,
      res
    );
  } catch (error) {
    return ErrorHandler(error.message, 500, req, res);
  }
};

/**
 * @desc Get all clients for a business (with search, sorting, and filtering)
 * @route GET /api/business/clients
 * @access Private (Business Owner)
 */
const getClients = async (req, res) => {
  // #swagger.tags = ['Clients']
  /* #swagger.description = 'Get all clients for the currently logged-in user\'s business, with search, sorting, and filtering.'
       #swagger.security = [{ "Bearer": [] }]
       #swagger.parameters['search'] = { in: 'query', description: 'Search by name, email, or phone', type: 'string' }
       #swagger.parameters['sort'] = { in: 'query', description: 'Sort by field (e.g., firstName:asc, email:desc)', type: 'string' }
       #swagger.parameters['isActive'] = { in: 'query', description: 'Filter by active status (true/false)', type: 'boolean' }
       #swagger.parameters['isProfileComplete'] = { in: 'query', description: 'Filter by profile completion status (true/false)', type: 'boolean' }
       #swagger.parameters['page'] = { in: 'query', description: 'Page number for pagination', type: 'integer' }
       #swagger.parameters['limit'] = { in: 'query', description: 'Number of items per page', type: 'integer' }
    */
  try {
    const userId = req.user._id || req.user.id;
    const business = await Business.findOne({ owner: userId });
    if (!business) {
      return ErrorHandler("Business not found for this user.", 404, req, res);
    }

    const {
      search,
      sort,
      isActive,
      isProfileComplete,
      page = 1,
      limit = 10,
    } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    let baseQuery = { business: business._id };

    // Filter by active status
    if (isActive !== undefined) {
      baseQuery.isActive = isActive === "true";
    }

    // Filter by profile completion status
    if (isProfileComplete !== undefined) {
      baseQuery.isProfileComplete = isProfileComplete === "true";
    }

    // Sorting
    let sortObj = {};
    if (sort) {
      const [field, direction] = sort.split(":");
      if (
        ["firstName", "lastName", "email", "phone", "createdAt"].includes(field)
      ) {
        sortObj[field] = direction === "desc" ? -1 : 1;
      }
    } else {
      sortObj["firstName"] = 1; // Default sort by firstName ascending
    }

    // If search is provided, use aggregation for search
    if (search) {
      const matchStage = [
        { $match: baseQuery },
        {
          $lookup: {
            from: "users",
            localField: "staff",
            foreignField: "_id",
            as: "staff",
            pipeline: [{ $project: { firstName: 1, lastName: 1 } }],
          },
        },
        {
          $unwind: {
            path: "$staff",
            preserveNullAndEmptyArrays: true,
          },
        },
        {
          $addFields: {
            searchFullName: {
              $concat: [
                { $ifNull: ["$firstName", ""] },
                " ",
                { $ifNull: ["$lastName", ""] }
              ]
            }
          }
        },
        {
          $match: {
            $or: [
              { firstName: { $regex: search, $options: "i" } },
              { lastName: { $regex: search, $options: "i" } },
              { searchFullName: { $regex: search, $options: "i" } },
              { email: { $regex: search, $options: "i" } },
              { phone: { $regex: search, $options: "i" } },
            ],
          },
        },
        { $sort: sortObj },
        { $skip: skip },
        { $limit: parseInt(limit) },
      ];
      const clients = await Client.aggregate(matchStage);

      // For total count
      const totalAgg = await Client.aggregate([
        { $match: baseQuery },
        {
          $lookup: {
            from: "users",
            localField: "staff",
            foreignField: "_id",
            as: "staff",
            pipeline: [{ $project: { firstName: 1, lastName: 1 } }],
          },
        },
        {
          $unwind: {
            path: "$staff",
            preserveNullAndEmptyArrays: true,
          },
        },
        {
          $addFields: {
            searchFullName: {
              $concat: [
                { $ifNull: ["$firstName", ""] },
                " ",
                { $ifNull: ["$lastName", ""] }
              ]
            }
          }
        },
        {
          $match: {
            $or: [
              { firstName: { $regex: search, $options: "i" } },
              { lastName: { $regex: search, $options: "i" } },
              { searchFullName: { $regex: search, $options: "i" } },
              { email: { $regex: search, $options: "i" } },
              { phone: { $regex: search, $options: "i" } },
            ],
          },
        },
        { $count: "total" },
      ]);
      const total = totalAgg[0] ? totalAgg[0].total : 0;
      return SuccessHandler(
        {
          clients,
          pagination: {
            total,
            page: parseInt(page),
            pages: Math.ceil(total / parseInt(limit)),
          },
        },
        200,
        res
      );
    }

    // If no search, use normal query
    const clients = await Client.find(baseQuery)
      .populate("staff")
      .sort(sortObj)
      .skip(skip)
      .limit(parseInt(limit));
    const total = await Client.countDocuments(baseQuery);
    return SuccessHandler(
      {
        clients,
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
 * @desc Send a custom message (email + SMS) to selected clients of the business owner
 * @route POST /api/business/clients/messages
 * @access Private (Business Owner)
 */
const sendCustomMessageToClients = async (req, res) => {
  // #swagger.tags = ['Clients']
  /* #swagger.description = 'Send a custom message to one or more selected clients (email + SMS).'
       #swagger.security = [{ "Bearer": [] }]
       #swagger.parameters['obj'] = {
          in: 'body',
          description: 'Selected client IDs and message text',
          required: true,
          schema: {
            clientIds: ['clientId1','clientId2'],
            message: 'Your custom message here'
          }
       }
    */
  try {
    const { clientIds, message } = req.body;

    if (!Array.isArray(clientIds) || clientIds.length === 0) {
      return ErrorHandler(
        "clientIds must be a non-empty array of client IDs",
        400,
        req,
        res
      );
    }
    if (
      !message ||
      typeof message !== "string" ||
      message.trim().length === 0
    ) {
      return ErrorHandler("Message text is required", 400, req, res);
    }

    // Use _id directly for ObjectId queries (more reliable than string conversion)
    const userId = req.user._id || req.user.id;
    const business = await Business.findOne({ owner: userId });
    if (!business) {
      return ErrorHandler("Business not found for this user.", 404, req, res);
    }

    const normalizedIds = clientIds.filter(Boolean);
    const clients = await Client.find({
      _id: { $in: normalizedIds },
      business: business._id,
      isActive: true,
    }).select("firstName lastName email phone");

    if (!clients || clients.length === 0) {
      return SuccessHandler(
        { message: "No matching clients found for this business", results: [] },
        200,
        res
      );
    }

    const sendMail = require("../utils/sendMail");
    const { sendSMS } = require("../utils/twilio");

    const businessName =
      business.businessName || business.name || "Your Business";
    const emailSubject = `Message from ${businessName}`;
    const smsBodyPrefix = `${businessName}: `;
    const messageText = message.trim();

    const results = [];

    for (const c of clients) {
      let emailSent = false;
      let emailError = null;
      let smsSent = false;
      let smsError = null;

      if (c.email) {
        try {
          await sendMail(c.email, emailSubject, messageText);
          emailSent = true;
        } catch (err) {
          emailError = err?.message || "Failed to send email";
        }
      }

      if (c.phone) {
        try {
          await sendSMS(c.phone, `${smsBodyPrefix}${messageText}`);
          smsSent = true;
        } catch (err) {
          smsError = err?.message || "Failed to send SMS";
        }
      }

      results.push({
        clientId: c._id,
        email: c.email || null,
        phone: c.phone || null,
        emailSent,
        emailError,
        smsSent,
        smsError,
      });
    }

    const summary = {
      totalTargets: clients.length,
      emailSent: results.filter((r) => r.emailSent).length,
      smsSent: results.filter((r) => r.smsSent).length,
    };

    return SuccessHandler({ summary, results }, 200, res);
  } catch (error) {
    return ErrorHandler(error.message, 500, req, res);
  }
};

/**
 * @desc Get phone numbers of clients for the authenticated business owner
 * @route GET /api/business/clients/phones-simple
 * @access Private (Business Owner)
 */
const getClientPhone = async (req, res) => {
  // #swagger.tags = ['Clients']
  /* #swagger.description = 'Retrieve phone numbers of clients for the current business owner (no pagination or filters).'
       #swagger.security = [{ "Bearer": [] }]
    */
  try {
    const userId = req.user._id || req.user.id;
    const business = await Business.findOne({ owner: userId });
    if (!business) {
      return ErrorHandler("Business not found for this user.", 404, req, res);
    }

    const clients = await Client.find({ business: business._id }).select(
      "_id phone firstName lastName email"
    );

    const phones = clients.map((c) => ({
      clientId: c._id,
      phone: c.phone,
      firstName: c.firstName,
      lastName: c.lastName,
      email: c.email,
    }));

    return SuccessHandler({ phones }, 200, res);
  } catch (error) {
    return ErrorHandler(error.message, 500, req, res);
  }
};

/**
 * @desc Get a single client by ID
 * @route GET /api/business/clients/:clientId
 * @access Private (Business Owner)
 */
const getClientById = async (req, res) => {
  // #swagger.tags = ['Clients']
  /* #swagger.description = 'Get a single client by their ID.'
         #swagger.security = [{ "Bearer": [] }]
      */
  try {
    const { clientId } = req.params;
    // Use _id directly for ObjectId queries (more reliable than string conversion)
    const userId = req.user._id || req.user.id;
    const business = await Business.findOne({ owner: userId });
    if (!business) {
      return ErrorHandler("Business not found for this user.", 404, req, res);
    }

    const client = await Client.findOne({
      _id: clientId,
      business: business._id,
    }).populate("staff", "firstName lastName");

    if (!client) {
      return ErrorHandler("Client not found.", 404, req, res);
    }

    // Include internalNotes and haircutPhotos in the response
    const clientData = client.toObject();
    return SuccessHandler(clientData, 200, res);
  } catch (error) {
    return ErrorHandler(error.message, 500, req, res);
  }
};

/**
 * @desc Update a client
 * @route PUT /api/business/clients/:clientId
 * @access Private (Business Owner)
 */
const updateClient = async (req, res) => {
  // #swagger.tags = ['Clients']
  /* #swagger.description = 'Update a client\'s information.'
       #swagger.security = [{ "Bearer": [] }]
       #swagger.parameters['obj'] = {
          in: 'body',
          description: 'Updated client details.',
          required: true,
          schema: {
            firstName: 'John',
            lastName: 'Doe',
            email: 'john.doe@example.com',
            phone: '+1234567890',
            notes: 'Updated general notes',
            privateNotes: 'Updated private notes',
            preferences: {
              haircutStyle: 'Fade',
              preferredStaff: 'staffId123',
              specialInstructions: 'Use clipper guard #2'
            },
            isActive: true
          }
       }
    */
  try {
    const { clientId } = req.params;
    // Use _id directly for ObjectId queries (more reliable than string conversion)
    const userId = req.user._id || req.user.id;
    const business = await Business.findOne({ owner: userId });
    if (!business) {
      return ErrorHandler("Business not found for this user.", 404, req, res);
    }

    const client = await Client.findOne({
      _id: clientId,
      business: business._id,
    });
    if (!client) {
      return ErrorHandler("Client not found.", 404, req, res);
    }

    const updateData = { ...req.body };
    if (updateData.phone) {
      const { getCountryCode } = require("../utils/index");
      const countryHint = getCountryCode(business.contactInfo?.phone);
      updateData.phone = normalizePhone(updateData.phone, countryHint);

      // check if another client already has this phone
      const duplicatedClient = await Client.findOne({
        business: business._id,
        phone: updateData.phone,
        _id: { $ne: clientId }
      });
      if (duplicatedClient) {
        return ErrorHandler("Another client already has this phone number.", 400, req, res);
      }
    }

    const updatedClient = await Client.findByIdAndUpdate(clientId, updateData, {
      new: true,
      runValidators: true,
    });

    return SuccessHandler(updatedClient, 200, res);
  } catch (error) {
    return ErrorHandler(error.message, 500, req, res);
  }
};

/**
 * @desc Update private notes for a client
 * @route PUT /api/business/clients/:clientId/private-notes
 * @access Private (Business Owner)
 */
const updatePrivateNotes = async (req, res) => {
  // #swagger.tags = ['Clients']
  /* #swagger.description = 'Update only the private notes for a specific client.'
       #swagger.security = [{ "Bearer": [] }]
       #swagger.parameters['obj'] = {
          in: 'body',
          description: 'Private notes to update.',
          required: true,
          schema: {
            privateNotes: 'Updated private notes about the client'
          }
       }
    */
  try {
    const { clientId } = req.params;
    const { privateNotes } = req.body;

    // Use _id directly for ObjectId queries (more reliable than string conversion)
    const userId = req.user._id || req.user.id;
    const business = await Business.findOne({ owner: userId });
    if (!business) {
      return ErrorHandler("Business not found for this user.", 404, req, res);
    }

    const client = await Client.findOne({
      _id: clientId,
      business: business._id,
    });
    if (!client) {
      return ErrorHandler("Client not found.", 404, req, res);
    }

    const updatedClient = await Client.findByIdAndUpdate(
      clientId,
      { privateNotes },
      { new: true, runValidators: true }
    );

    return SuccessHandler(updatedClient, 200, res);
  } catch (error) {
    return ErrorHandler(error.message, 500, req, res);
  }
};

/**
 * @desc Delete a client (soft delete by setting isActive to false)
 * @route DELETE /api/business/clients/:clientId
 * @access Private (Business Owner)
 */
const deleteClient = async (req, res) => {
  // #swagger.tags = ['Clients']
  /* #swagger.description = 'Delete a client by their ID.'
         #swagger.security = [{ "Bearer": [] }]
      */
  try {
    const { clientId } = req.params;
    const { reason } = req.body; // Get reason from request body

    if (!reason || typeof reason !== "string" || reason.trim().length === 0) {
      return ErrorHandler("Deletion reason is required.", 400, req, res);
    }
    // Use _id directly for ObjectId queries (more reliable than string conversion)
    const userId = req.user._id || req.user.id;
    const business = await Business.findOne({ owner: userId });
    if (!business) {
      return ErrorHandler("Business not found for this user.", 404, req, res);
    }

    const client = await Client.findOneAndDelete({
      _id: clientId,
      business: business._id,
    });

    if (!client) {
      return ErrorHandler(
        "Client not found or not authorized to delete.",
        404,
        req,
        res
      );
    }

    // Create audit note
    await Auditing.create({
      entityType: "Client",
      entityId: clientId,
      action: "deleted",
      reason: reason.trim(),
      createdBy: req.user.id,
      metadata: {
        clientName: `${client.firstName} ${client.lastName}`,
        businessId: business._id,
        businessName: business.name,
      },
    });

    return SuccessHandler("Client deleted successfully", 200, res);
  } catch (error) {
    return ErrorHandler(error.message, 500, req, res);
  }
};

/**
 * @desc Get client details by invitation token (public access)
 * @route GET /api/client/invitation/:token
 * @access Public
 */
const getClientByInvitationToken = async (req, res) => {
  // #swagger.tags = ['Clients']
  /* #swagger.description = 'Get client details using invitation token (public access).'
       #swagger.parameters['token'] = { in: 'path', description: 'Invitation token', required: true, type: 'string' }
    */
  try {
    const { token } = req.params;

    const client = await Client.findOne({
      invitationToken: token,
      isActive: true,
    })
      .populate({
        path: "business",
        populate: {
          path: "owner",
        },
      })
      .populate("staff", "_id firstName lastName email phone services");

    if (!client) {
      return ErrorHandler("Invalid or expired invitation link.", 404, req, res);
    }

    // Return comprehensive client and business information for frontend display
    // const publicClientData = {
    //   _id: client._id,
    //   firstName: client.firstName,
    //   lastName: client.lastName,
    //   email: client.email,
    //   phone: client.phone,
    //   notes: client.notes,
    //   preferences: client.preferences,
    //   isProfileComplete: client.isProfileComplete,
    //   createdAt: client.createdAt,
    //   business: {
    //     _id: client.business._id,
    //     name: client.business.name,
    //     businessName: client.business.businessName,
    //     personalName: client.business.personalName,
    //     surname: client.business.surname,
    //     contactInfo: client.business.contactInfo,
    //     address: client.business.address,
    //     location: client.business.location,
    //     businessHours: client.business.businessHours,
    //     services: client.business.services,
    //     profileImages: client.business.profileImages,
    //     socialMedia: client.business.socialMedia,
    //     owner: {
    //       _id: client.business.owner._id,
    //       name: client.business.owner.name,
    //       email: client.business.owner.email,
    //       phone: client.business.owner.phone,
    //       profileImage: client.business.owner.profileImage,
    //     },
    //   },
    // };

    return SuccessHandler(client, 200, res);
  } catch (error) {
    return ErrorHandler(error.message, 500, req, res);
  }
};

/**
 * @desc Get invitation link for a client
 * @route GET /api/business/clients/:clientId/invitation-link
 * @access Private (Business Owner)
 */
const getInvitationLink = async (req, res) => {
  // #swagger.tags = ['Clients']
  /* #swagger.description = 'Get the current invitation link for a specific client.'
       #swagger.security = [{ "Bearer": [] }]
    */
  try {
    const { clientId } = req.params;
    // Use _id directly for ObjectId queries (more reliable than string conversion)
    const userId = req.user._id || req.user.id;
    const business = await Business.findOne({ owner: userId });
    if (!business) {
      return ErrorHandler("Business not found for this user.", 404, req, res);
    }

    const client = await Client.findOne({
      _id: clientId,
      business: business._id,
    });
    if (!client) {
      return ErrorHandler("Client not found.", 404, req, res);
    }

    if (!client.invitationToken) {
      return ErrorHandler(
        "No invitation link found for this client.",
        404,
        req,
        res
      );
    }

    // Generate the invitation link with business information
    const baseUrl = process.env.FRONTEND_URL || "http://localhost:5173";
    const invitationLink = `${baseUrl}/client/invitation/${client.invitationToken}?business=${business._id}`;

    return SuccessHandler(
      {
        invitationLink,
        invitationToken: client.invitationToken,
      },
      200,
      res
    );
  } catch (error) {
    return ErrorHandler(error.message, 500, req, res);
  }
};

/**
 * @desc Generate invitation token for existing client (if missing)
 * @route POST /api/business/clients/:clientId/generate-token
 * @access Private (Business Owner)
 */
const updateClientInvitationToken = async (req, res) => {
  // #swagger.tags = ['Clients']
  /* #swagger.description = 'Generate invitation token for existing client if missing.'
       #swagger.security = [{ "Bearer": [] }]
    */
  try {
    const { clientId } = req.params;
    // Use _id directly for ObjectId queries (more reliable than string conversion)
    const userId = req.user._id || req.user.id;
    const business = await Business.findOne({ owner: userId });
    if (!business) {
      return ErrorHandler("Business not found for this user.", 404, req, res);
    }

    const client = await Client.findOne({
      _id: clientId,
      business: business._id,
    });
    if (!client) {
      return ErrorHandler("Client not found.", 404, req, res);
    }

    // Generate new invitation token
    const newInvitationToken = generateInvitationToken();

    // Update client with new token
    const updatedClient = await Client.findByIdAndUpdate(
      clientId,
      { invitationToken: newInvitationToken },
      { new: true, runValidators: true }
    );

    // Generate the invitation link with business information
    const baseUrl = process.env.FRONTEND_URL || "http://localhost:5173";
    const invitationLink = `${baseUrl}/client/invitation/${newInvitationToken}?business=${business._id}`;

    return SuccessHandler(
      {
        message: "Invitation token generated successfully",
        client: updatedClient,
        invitationLink,
        invitationToken: newInvitationToken,
      },
      200,
      res
    );
  } catch (error) {
    return ErrorHandler(error.message, 500, req, res);
  }
};

/**
 * @desc Get all clients (admin only) with filtering, sorting, and search
 * @route GET /api/client/all
 * @access Private (Admin)
 */
const getAllClient = async (req, res) => {
  // #swagger.tags = ['Clients']
  /* #swagger.description = 'Get all clients with filtering (by status), sorting (by name, email, phone), and search.'
     #swagger.security = [{ "Bearer": [] }]
     #swagger.parameters['status'] = { in: 'query', description: 'Filter by status (activated, deactivated)', type: 'string' }
     #swagger.parameters['sort'] = { in: 'query', description: 'Sort by field (e.g., firstName:asc, email:desc, phone:asc)', type: 'string' }
     #swagger.parameters['search'] = { in: 'query', description: 'Search by name, email, or phone', type: 'string' }
     #swagger.parameters['page'] = { in: 'query', description: 'Page number for pagination', type: 'integer' }
     #swagger.parameters['limit'] = { in: 'query', description: 'Number of items per page', type: 'integer' }
  */
  try {
    const { status, sort, search, page = 1, limit = 10 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    let baseQuery = {};
    if (status && ["activated", "deactivated"].includes(status)) {
      baseQuery.status = status;
    }
    // Search
    if (search) {
      baseQuery.$or = [
        { firstName: { $regex: search, $options: "i" } },
        { lastName: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
        { phone: { $regex: search, $options: "i" } },
      ];
    }
    // Sorting
    let sortObj = {};
    if (sort) {
      const [field, direction] = sort.split(":");
      if (["firstName", "lastName", "email", "phone"].includes(field)) {
        sortObj[field] = direction === "desc" ? -1 : 1;
      }
    } else {
      sortObj["firstName"] = 1; // Default sort by firstName ascending
    }
    // Query with staff population
    const clients = await Client.find(baseQuery)
      .populate("staff", "firstName lastName email phone")
      .sort(sortObj)
      .skip(skip)
      .limit(parseInt(limit));
    const total = await Client.countDocuments(baseQuery);
    return SuccessHandler(
      {
        clients,
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
 * @desc Update the status of a client (admin only)
 * @route PATCH /api/client/:id/status
 * @access Private (Admin)
 */
const updateClientStatus = async (req, res) => {
  // #swagger.tags = ['Clients']
  /* #swagger.description = 'Update the status of a client (activated/deactivated). Only admin can perform this action.'
     #swagger.security = [{ "Bearer": [] }]
     #swagger.parameters['id'] = { in: 'path', description: 'Client ID', required: true, type: 'string' }
     #swagger.parameters['obj'] = {
        in: 'body',
        description: 'Status update',
        required: true,
        schema: { status: 'activated' }
     }
  */
  try {
    const { id } = req.params;
    const { status } = req.body;
    if (!id) {
      return ErrorHandler("Client ID is required.", 400, req, res);
    }
    if (!status || !["activated", "deactivated"].includes(status)) {
      return ErrorHandler(
        'Status must be "activated" or "deactivated".',
        400,
        req,
        res
      );
    }
    const client = await Client.findById(id);
    if (!client) {
      return ErrorHandler("Client not found.", 404, req, res);
    }
    client.status = status;
    await client.save();
    return SuccessHandler(client, 200, res);
  } catch (error) {
    return ErrorHandler(error.message, 500, req, res);
  }
};

/**
 * @desc Upload clients via CSV file
 * @route POST /api/business/clients/upload-csv
 * @access Private (Business Owner)
 */
const uploadClientsCSV = async (req, res) => {
  // #swagger.tags = ['Clients']
  /* #swagger.description = 'Upload a CSV file to bulk add clients to the business.'
       #swagger.security = [{ "Bearer": [] }]
       #swagger.consumes = ['multipart/form-data']
       #swagger.parameters['file'] = {
          in: 'formData',
          name: 'file',
          type: 'file',
          required: true,
          description: 'CSV file containing client data.'
       }
    */
  try {
    if (!req.file) {
      return ErrorHandler("No file uploaded.", 400, req, res);
    }
    // Use _id directly for ObjectId queries (more reliable than string conversion)
    const userId = req.user._id || req.user.id;
    const business = await Business.findOne({ owner: userId });
    if (!business) {
      return ErrorHandler("Business not found for this user.", 404, req, res);
    }
    // Upload CSV to Cloudinary first
    let cloudinaryResult;
    try {
      cloudinaryResult = await uploadFileToCloudinary(
        req.file.buffer,
        "client-csv-uploads",
        req.file.originalname
      );
    } catch (cloudErr) {
      return ErrorHandler(
        "Failed to upload CSV to Cloudinary: " + cloudErr.message,
        500,
        req,
        res
      );
    }
    const clients = [];
    const errors = [];
    const parser = parse({ columns: true, trim: true });
    parser.write(req.file.buffer);
    parser.end();
    for await (const record of parser) {
      // Validate required fields - only phone is required for initial creation
      if (!record.phone) {
        errors.push({ record, error: "Phone number is required" });
        continue;
      }

      const { getCountryCode } = require("../utils/index");
      const countryHint = getCountryCode(business.contactInfo?.phone);
      const normalizedPhone = normalizePhone(record.phone, countryHint);

      // Check if client with this phone number already exists
      const existingClient = await Client.findOne({
        business: business._id,
        phone: normalizedPhone,
      });

      if (existingClient) {
        errors.push({
          record,
          error: `Client with phone number ${normalizedPhone} already exists`,
        });
        continue;
      }

      // Prepare client data - only phone initially, other fields will be completed later
      const clientData = {
        business: business._id,
        phone: normalizedPhone,
        firstName: record.firstName || null,
        lastName: record.lastName || null,
        email: record.email || null,
        isProfileComplete: !!(
          record.firstName &&
          record.lastName &&
          record.email
        ),
        invitationToken: generateInvitationToken(),
      };
      try {
        const newClient = await Client.create(clientData);
        clients.push(newClient);

        // Send SMS invitation if profile is not complete
        if (!newClient.isProfileComplete) {
          try {
            const baseUrl = process.env.FRONTEND_URL || "http://localhost:5173";
            const invitationLink = `${baseUrl}/client/invitation/${newClient.invitationToken}?business=${business._id}`;
            const businessName =
              business.businessName || business.name || "Our Business";
            const smsMessage = `Hello! You've been invited to ${businessName}. Please complete your profile by clicking this link: ${invitationLink}`;

            await sendSMS(newClient.phone, smsMessage);
          } catch (smsError) {
            console.error(
              `Failed to send invitation SMS to ${newClient.phone}:`,
              smsError.message
            );
            // Don't fail the CSV processing if SMS fails
          }
        }
      } catch (err) {
        if (err.code === 11000) {
          errors.push({
            record,
            error: "Duplicate email or phone for this business",
          });
        } else {
          errors.push({ record, error: err.message });
        }
      }
    }
    return SuccessHandler(
      {
        message: "CSV processed and uploaded to Cloudinary",
        cloudinaryUrl: cloudinaryResult.secure_url,
        inserted: clients.length,
        errors,
        clients,
      },
      201,
      res
    );
  } catch (error) {
    return ErrorHandler(error.message, 500, req, res);
  }
};

/**
 * @desc Client login using clientId to get JWT token
 * @route POST /api/client/login
 * @access Public
 */
const clientLogin = async (req, res) => {
  // #swagger.tags = ['Clients']
  /* #swagger.description = 'Client login using clientId to get JWT token'
       #swagger.parameters['obj'] = {
          in: 'body',
          description: 'Client login data.',
          required: true,
          schema: {
            clientId: 'client_id_here'
          }
       }
    */
  try {
    const { clientId } = req.body;

    if (!clientId) {
      return ErrorHandler("Client ID is required.", 400, req, res);
    }

    // Find client by ID
    const client = await Client.findById(clientId)
      .populate("business", "name businessName")
      .populate("staff", "_id firstName lastName email phone");

    if (!client) {
      return ErrorHandler("Client not found.", 404, req, res);
    }

    if (!client.isActive) {
      return ErrorHandler("Client account is deactivated.", 403, req, res);
    }

    if (!client.isProfileComplete) {
      return ErrorHandler("Please complete your profile first.", 400, req, res);
    }

    const jwtToken = client.getJWTToken();

    return SuccessHandler(
      {
        message: "Login successful",
        client: client,
        token: jwtToken,
        clientId: client._id,
      },
      200,
      res,
      {
        cookieName: 'clientToken',
        cookieValue: jwtToken,
      }
    );
  } catch (error) {
    return ErrorHandler(error.message, 500, req, res);
  }
};

/**
 * @desc Client sign up with email and password
 * @route POST /api/client/signup
 * @access Public
 */
const clientSignUp = async (req, res) => {
  // #swagger.tags = ['Clients']
  /* #swagger.description = 'Client sign up with email and password. If an unregistered client exists with the same phone/email, they will be converted to a registered client and their history will be preserved.'
       #swagger.parameters['obj'] = {
          in: 'body',
          description: 'Client sign up data.',
          required: true,
          schema: {
            firstName: 'John',
            lastName: 'Doe',
            email: 'john.doe@example.com',
            phone: '+1234567890',
            password: 'password123',
            businessId: 'business_id_here'
          }
       }
    */
  try {
    const { firstName, lastName, email, phone: rawPhone, password, businessId, acceptedTerms } = req.body;
    // Fetch business for normalization context
    const business = await Business.findById(businessId);
    if (!business) {
      return ErrorHandler("Business not found", 404, req, res);
    }
    
    const { getCountryCode } = require("../utils/index");
    const countryHint = getCountryCode(business.contactInfo?.phone);
    const phone = normalizePhone(rawPhone, countryHint);

    // Validate required fields
    if (!firstName || !lastName || !email || !phone || !password || !businessId) {
      return ErrorHandler(
        "First name, last name, email, phone, password, and business ID are required.",
        400,
        req,
        res
      );
    }

    // Validate email format
    const emailRegex = /^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/;
    if (!emailRegex.test(email)) {
      return ErrorHandler("Please enter a valid email address", 400, req, res);
    }

    // Validate password length
    if (password.length < 6) {
      return ErrorHandler("Password must be at least 6 characters long", 400, req, res);
    }

    // Check if a FULLY REGISTERED client with this email already exists
    const existingRegisteredByEmail = await Client.findOne({
      business: businessId,
      email: email.toLowerCase(),
      registrationStatus: 'registered'
    }).select("+password");

    if (existingRegisteredByEmail) {
      return ErrorHandler(
        "A client with this email already exists for this business. Please sign in instead.",
        409,
        req,
        res
      );
    }

    const { getComparablePhone } = require("../utils/index");
    const comparablePhone = getComparablePhone(phone);
    
    // Check if a FULLY REGISTERED client with this phone already exists
    const existingRegisteredByPhone = await Client.findOne({
      business: businessId,
      phoneComparable: comparablePhone,
      registrationStatus: 'registered'
    });

    if (existingRegisteredByPhone) {
      return ErrorHandler(
        "A client with this phone number already exists for this business.",
        409,
        req,
        res
      );
    }

    // Check if an UNREGISTERED or PENDING client exists with this phone or email
    // Priority 1: Phone Match (using comparable phone)
    let matchingClients = await Client.find({
      business: businessId,
      phoneComparable: comparablePhone,
      registrationStatus: { $in: ['unregistered', 'pending'] }
    });

    // Priority 2: Fallback to current email matching logic if no phone match
    if (matchingClients.length === 0 && email) {
      matchingClients = await Client.find({
        business: businessId,
        email: email.toLowerCase(),
        registrationStatus: { $in: ['unregistered', 'pending'] }
      });
    }

    let client;
    let isConverted = false;

    if (matchingClients.length > 0) {
      try {
        // Use the first matching record as the base for conversion
        let clientToConvert = matchingClients[0];

        // If there are multiple matching records, merge them into the first one
        if (matchingClients.length > 1) {
          console.log(`Merging ${matchingClients.length} duplicate client records for business ${businessId}`);
          const otherClientIds = matchingClients.slice(1).map(c => c._id);

          // Move all associated data to the primary record
          await Promise.all([
            Appointment.updateMany({ client: { $in: otherClientIds } }, { client: clientToConvert._id }),
            HaircutGallery.updateMany({ client: { $in: otherClientIds } }, { client: clientToConvert._id }),
            Note.updateMany({ clientId: { $in: otherClientIds } }, { clientId: clientToConvert._id }),
            Auditing.updateMany({ entityId: { $in: otherClientIds }, entityType: "Client" }, { entityId: clientToConvert._id })
          ]);

          // Merge notes and haircut photos from duplicates if not present in primary
          for (let i = 1; i < matchingClients.length; i++) {
            const other = matchingClients[i];
            if (other.internalNotes && !clientToConvert.internalNotes) {
              clientToConvert.internalNotes = other.internalNotes;
            }
            if (other.notes && !clientToConvert.notes) {
              clientToConvert.notes = other.notes;
            }
            if (other.privateNotes && !clientToConvert.privateNotes) {
              clientToConvert.privateNotes = other.privateNotes;
            }
            if (other.haircutPhotos && other.haircutPhotos.length > 0) {
              clientToConvert.haircutPhotos = [...(clientToConvert.haircutPhotos || []), ...other.haircutPhotos];
            }
          }

          // Delete the duplicate client records
          await Client.deleteMany({ _id: { $in: otherClientIds } });
        }

        // Convert the merged unregistered/pending client to registered
        clientToConvert.firstName = firstName.trim();
        clientToConvert.lastName = lastName.trim();
        clientToConvert.email = email.toLowerCase().trim();
        clientToConvert.phone = phone.trim();
        clientToConvert.password = password;
        clientToConvert.registrationStatus = 'registered';
        clientToConvert.hasAcceptedTerms = acceptedTerms || true;
        clientToConvert.termsAcceptedAt = new Date();
        clientToConvert.isProfileComplete = true;
        clientToConvert.isActive = true;
        clientToConvert.status = "activated";

        if (!clientToConvert.invitationToken) {
          clientToConvert.invitationToken = generateInvitationToken();
        }

        client = await clientToConvert.save();
        isConverted = true;
      } catch (mergeError) {
        console.error("Merge process failed, falling back to new client creation:", mergeError);
        // If merge fails, reset matchingClients to continue with normal registration
        matchingClients = [];
      }
    }

    if (matchingClients.length === 0) {
      // Create new client with password (no prior unregistered record)
      const clientData = {
        business: business._id,
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        email: email.toLowerCase().trim(),
        phone: phone.trim(),
        password: password,
        registrationStatus: 'registered',
        hasAcceptedTerms: acceptedTerms || true,
        termsAcceptedAt: new Date(),
        isProfileComplete: true,
        isActive: true,
        status: "activated",
      };

      client = await Client.create(clientData);
    }

    // Generate JWT token for client authentication
    const jwtToken = client.getJWTToken();

    return SuccessHandler(
      {
        message: isConverted
          ? "Welcome! Your account has been created and all your appointment history has been preserved."
          : "Client account created successfully",
        client,
        token: jwtToken,
        clientId: client._id,
        isConverted,
      },
      201,
      res,
      {
        cookieName: 'clientToken',
        cookieValue: jwtToken,
      }
    );
  } catch (error) {
    console.error("Client sign up error:", error);

    // Handle duplicate key errors
    if (error.code === 11000) {
      const field = Object.keys(error.keyPattern)[0];
      return ErrorHandler(
        `A client with this ${field} already exists`,
        409,
        req,
        res
      );
    }

    return ErrorHandler(error.message, 500, req, res);
  }
};

/**
 * @desc Client sign in with email and password
 * @route POST /api/client/signin
 * @access Public
 */
const clientSignIn = async (req, res) => {
  // #swagger.tags = ['Clients']
  /* #swagger.description = 'Client sign in with email and password'
       #swagger.parameters['obj'] = {
          in: 'body',
          description: 'Client sign in data.',
          required: true,
          schema: {
            email: 'john.doe@example.com',
            password: 'password123',
            businessId: 'business_id_here'
          }
       }
    */
  try {
    const { email, password, businessId } = req.body;

    if (!email || !password || !businessId) {
      return ErrorHandler(
        "Email, password, and business ID are required.",
        400,
        req,
        res
      );
    }

    // Find client by email and business, including password field
    const client = await Client.findOne({
      business: businessId,
      email: email.toLowerCase(),
    })
      .select("+password")
      .populate("business", "name businessName")
      .populate("staff", "_id firstName lastName email phone");

    if (!client) {
      return ErrorHandler("Invalid email or password.", 401, req, res);
    }

    if (!client.isActive) {
      return ErrorHandler("Client account is deactivated.", 403, req, res);
    }

    // Check if client has a password set
    if (!client.password) {
      return ErrorHandler(
        "No password set for this account. Please use the forgot password option or contact support.",
        400,
        req,
        res
      );
    }

    // Compare password
    const isPasswordValid = await client.comparePassword(password);
    if (!isPasswordValid) {
      return ErrorHandler("Invalid email or password.", 401, req, res);
    }

    // Generate JWT token
    const jwtToken = client.getJWTToken();

    return SuccessHandler(
      {
        message: "Login successful",
        client: client,
        token: jwtToken,
        clientId: client._id,
      },
      200,
      res,
      {
        cookieName: 'clientToken',
        cookieValue: jwtToken,
      }
    );
  } catch (error) {
    return ErrorHandler(error.message, 500, req, res);
  }
};

/**
 * @desc Client forgot password - send reset token
 * @route POST /api/client/forgot-password
 * @access Public
 */
const clientForgotPassword = async (req, res) => {
  // #swagger.tags = ['Clients']
  /* #swagger.description = 'Send password reset token to client email'
       #swagger.parameters['obj'] = {
          in: 'body',
          description: 'Client email and business ID',
          required: true,
          schema: {
            email: 'john.doe@example.com',
            businessId: 'business_id_here'
          }
       }
    */
  try {
    const { email, businessId } = req.body;

    if (!email || !businessId) {
      return ErrorHandler("Email and business ID are required", 400, req, res);
    }

    // Validate email format
    const emailRegex = /^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/;
    if (!emailRegex.test(email)) {
      return ErrorHandler("Please enter a valid email address", 400, req, res);
    }

    // Find client by email and business
    const client = await Client.findOne({
      business: businessId,
      email: email.toLowerCase(),
    });

    if (!client) {
      // Don't reveal if email exists for security
      return SuccessHandler(
        "If an account exists with this email, a password reset token has been sent.",
        200,
        res
      );
    }

    if (!client.isActive) {
      return ErrorHandler("Client account is deactivated.", 403, req, res);
    }

    // Generate password reset token (6-digit number)
    const passwordResetToken = Math.floor(100000 + Math.random() * 900000);
    const passwordResetTokenExpires = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes

    client.passwordResetToken = passwordResetToken;
    client.passwordResetTokenExpires = passwordResetTokenExpires;
    await client.save();

    // Send email with reset token
    try {
      const path = require("path");
      const ejs = require("ejs");
      const sendMail = require("../utils/sendMail");

      // Populate business to get business name
      await client.populate("business", "name businessName");

      const ejTemp = await ejs.renderFile(
        `${path.join(__dirname, "../ejs")}/forgetPassword.ejs`,
        { otp: passwordResetToken }
      );
      const businessName = client.business?.businessName || client.business?.name || 'You-Calendy';
      const subject = `Password Reset Token - ${businessName}`;
      await sendMail(client.email, subject, ejTemp);
    } catch (emailError) {
      console.error("Error sending password reset email:", emailError);
      // Continue even if email fails - token is still generated
    }

    return SuccessHandler(
      `Password reset token sent to ${email}`,
      200,
      res
    );
  } catch (error) {
    return ErrorHandler(error.message, 500, req, res);
  }
};

/**
 * @desc Client reset password using token
 * @route POST /api/client/reset-password
 * @access Public
 */
const clientResetPassword = async (req, res) => {
  // #swagger.tags = ['Clients']
  /* #swagger.description = 'Reset client password using reset token'
       #swagger.parameters['obj'] = {
          in: 'body',
          description: 'Password reset information',
          required: true,
          schema: {
            email: 'john.doe@example.com',
            businessId: 'business_id_here',
            passwordResetToken: '123456',
            password: 'newpassword123'
          }
       }
    */
  try {
    const { email, businessId, passwordResetToken, password } = req.body;

    if (!email || !businessId || !passwordResetToken || !password) {
      return ErrorHandler(
        "Email, business ID, reset token, and new password are required",
        400,
        req,
        res
      );
    }

    // Validate password length
    if (password.length < 6) {
      return ErrorHandler("Password must be at least 6 characters long", 400, req, res);
    }

    // Find client by email and business, including password field
    const client = await Client.findOne({
      business: businessId,
      email: email.toLowerCase(),
    }).select("+password");

    if (!client) {
      return ErrorHandler("Invalid email or token", 400, req, res);
    }

    // Verify reset token
    if (
      !client.passwordResetToken ||
      client.passwordResetToken.toString() !== passwordResetToken.toString() ||
      !client.passwordResetTokenExpires ||
      client.passwordResetTokenExpires < Date.now()
    ) {
      return ErrorHandler("Invalid or expired reset token", 400, req, res);
    }

    // Update password
    client.password = password;
    client.passwordResetToken = null;
    client.passwordResetTokenExpires = null;
    await client.save();

    return SuccessHandler("Password reset successfully", 200, res);
  } catch (error) {
    return ErrorHandler(error.message, 500, req, res);
  }
};

/**
 * @desc Complete client profile using invitation token
 * @route POST /api/client/complete-profile
 * @access Public
 */
const completeClientProfile = async (req, res) => {
  // #swagger.tags = ['Clients']
  /* #swagger.description = 'Complete client profile with full details using invitation token'
       #swagger.consumes = ['multipart/form-data']
       #swagger.parameters['invitationToken'] = { in: 'formData', description: 'Invitation token', required: true, type: 'string' }
       #swagger.parameters['firstName'] = { in: 'formData', description: 'Client first name', required: true, type: 'string' }
       #swagger.parameters['lastName'] = { in: 'formData', description: 'Client last name', required: true, type: 'string' }
       #swagger.parameters['email'] = { in: 'formData', description: 'Client email address', required: true, type: 'string' }
       #swagger.parameters['profileImage'] = { in: 'formData', description: 'Client profile image (optional)', type: 'file' }
    */
  try {
    const { invitationToken, firstName, lastName, email } = req.body;

    // Validate required fields
    if (!invitationToken || !firstName || !lastName || !email) {
      return ErrorHandler(
        "Invitation token, first name, last name, and email are required",
        400,
        req,
        res
      );
    }

    // Validate email format
    const emailRegex = /^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/;
    if (!emailRegex.test(email)) {
      return ErrorHandler("Please enter a valid email address", 400, req, res);
    }

    // Find client by invitation token
    const client = await Client.findOne({
      invitationToken: invitationToken,
      isActive: true,
    });

    if (!client) {
      return ErrorHandler("Invalid or expired invitation link.", 404, req, res);
    }

    // Check if profile is already complete
    if (client.isProfileComplete) {
      return ErrorHandler(
        "Profile is already complete for this client.",
        400,
        req,
        res
      );
    }

    // Check if email is already used by another client in the same business
    const existingClientWithEmail = await Client.findOne({
      business: client.business,
      email: email.toLowerCase(),
      _id: { $ne: client._id }, // Exclude current client
    });

    if (existingClientWithEmail) {
      return ErrorHandler(
        "An email address is already registered for another client in this business.",
        400,
        req,
        res
      );
    }

    // Handle profile image upload if provided
    let profileImageUrl = null;
    if (req.file) {
      try {
        const cloudinaryResult = await uploadFileToCloudinary(
          req.file.buffer,
          "client-profiles",
          "image"
        );
        profileImageUrl = cloudinaryResult.secure_url;
      } catch (uploadError) {
        console.error("Failed to upload profile image:", uploadError.message);
        return ErrorHandler(
          "Failed to upload profile image. Please try again.",
          500,
          req,
          res
        );
      }
    }

    // Update client with complete profile
    const updateData = {
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      email: email.toLowerCase().trim(),
      isProfileComplete: true,
    };

    // Add profile image URL if uploaded
    if (profileImageUrl) {
      updateData.profileImage = profileImageUrl;
    }

    const updatedClient = await Client.findByIdAndUpdate(
      client._id,
      updateData,
      { new: true, runValidators: true }
    )
      .populate("business", "name businessName")
      .populate("staff", "_id firstName lastName email phone");

    // Generate JWT token for client authentication
    const jwtToken = updatedClient.getJWTToken();

    return SuccessHandler(
      {
        message: "Profile completed successfully",
        client: updatedClient,
        token: jwtToken,
        clientId: updatedClient._id,
      },
      200,
      res
    );
  } catch (error) {
    return ErrorHandler(error.message, 500, req, res);
  }
};

/**
 * @desc Resend invitation SMS for incomplete client
 * @route POST /api/business/clients/:clientId/resend-invitation
 * @access Private (Business Owner)
 */
const resendInvitationSMS = async (req, res) => {
  // #swagger.tags = ['Clients']
  /* #swagger.description = 'Resend invitation SMS for incomplete client'
       #swagger.security = [{ "Bearer": [] }]
    */
  try {
    const { clientId } = req.params;
    // Use _id directly for ObjectId queries (more reliable than string conversion)
    const userId = req.user._id || req.user.id;
    const business = await Business.findOne({ owner: userId });
    if (!business) {
      return ErrorHandler("Business not found for this user.", 404, req, res);
    }

    const client = await Client.findOne({
      _id: clientId,
      business: business._id,
    });
    if (!client) {
      return ErrorHandler("Client not found.", 404, req, res);
    }

    // Check if client profile is already complete
    if (client.isProfileComplete) {
      return ErrorHandler(
        "Cannot resend invitation for client with complete profile.",
        400,
        req,
        res
      );
    }

    // Generate new invitation token if not exists
    if (!client.invitationToken) {
      client.invitationToken = generateInvitationToken();
      await client.save();
    }

    // Generate invitation link with business information
    const baseUrl = process.env.FRONTEND_URL || "http://localhost:5173";
    const invitationLink = `${baseUrl}/client/invitation/${client.invitationToken}?business=${business._id}`;

    // Send SMS with invitation link
    let smsSent = false;
    let smsError = null;

    try {
      const businessName =
        business.businessName || business.name || "Our Business";
      const smsMessage = `Hello! You've been invited to ${businessName}. Please complete your profile by clicking this link: ${invitationLink}`;

      console.log(
        `Attempting to resend SMS to ${client.phone} for business ${business._id}`
      );


      // Send SMS with credit validation
      const smsResult = await sendSMSWithCredits(
        client.phone,
        smsMessage,
        business._id,
        req,
        res
      );

      // Check if credit validation failed
      if (smsResult && smsResult.error) {
        console.error(
          "Insufficient SMS credits for resend invitation:",
          smsResult.message
        );
        smsError = smsResult.message;
      } else if (smsResult && smsResult.success) {
        console.log(
          `SMS resent successfully to ${client.phone}. Message ID: ${smsResult.messageId}`
        );
        smsSent = true;
      }
    } catch (smsError) {
      console.error("Failed to resend invitation SMS:", smsError.message);
      smsError = smsError.message;
    }

    return SuccessHandler(
      {
        message: smsSent
          ? "Invitation SMS resent successfully."
          : "Invitation SMS could not be resent.",
        client: client,
        invitationLink: invitationLink,
        smsStatus: {
          sent: smsSent,
          error: smsError,
          businessCredits: business.smsCredits || 0,
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
 * @desc Get business details by business ID (public access)
 * @route GET /api/client/business/:businessId
 * @access Public
 */
const getBusinessDetails = async (req, res) => {
  // #swagger.tags = ['Clients']
  /* #swagger.description = 'Get business details by business ID (public access).'
       #swagger.parameters['businessId'] = { in: 'path', description: 'Business ID', required: true, type: 'string' }
    */
  try {
    const { businessId } = req.params;

    const business = await Business.findById(businessId).populate("owner");

    if (!business) {
      return ErrorHandler("Business not found.", 404, req, res);
    }

    if (!business.isActive) {
      return ErrorHandler("Business is not active.", 404, req, res);
    }

    // Return comprehensive business information for frontend display
    // const publicBusinessData = {
    //   _id: business._id,
    //   name: business.name,
    //   businessName: business.businessName,
    //   personalName: business.personalName,
    //   surname: business.surname,
    //   contactInfo: business.contactInfo,
    //   address: business.address,
    //   location: business.location,
    //   businessHours: business.businessHours,
    //   services: business.services,
    //   profileImages: business.profileImages,
    //   socialMedia: business.socialMedia,
    //   owner: {
    //     _id: business.owner._id,
    //     name: business.owner.name,
    //     email: business.owner.email,
    //     phone: business.owner.phone,
    //     profileImage: business.owner.profileImage,
    //   },
    // };

    return SuccessHandler(business, 200, res);
  } catch (error) {
    return ErrorHandler(error.message, 500, req, res);
  }
};

/**
 * @desc Get business gallery images (public access)
 * @route GET /api/clients/business/:businessId/gallery
 * @access Public
 */
const getBusinessGallery = async (req, res) => {
  // #swagger.tags = ['Clients']
  /* #swagger.description = 'Get business gallery images by business ID (public access).'
       #swagger.parameters['businessId'] = { in: 'path', description: 'Business ID', required: true, type: 'string' }
    */
  try {
    const { businessId } = req.params;

    const business = await Business.findById(businessId);
    if (!business) {
      return ErrorHandler("Business not found.", 404, req, res);
    }

    if (!business.isActive) {
      return ErrorHandler("Business is not active.", 404, req, res);
    }

    // Get all gallery images for this business
    const galleryImages = await HaircutGallery.find({
      business: businessId,
      isActive: true,
    })
      .populate("client", "firstName lastName")
      .populate("staff", "firstName lastName")
      .sort({ createdAt: -1 });

    return SuccessHandler(galleryImages, 200, res);
  } catch (error) {
    return ErrorHandler(error.message, 500, req, res);
  }
};

/**
 * @desc Add a suggestion note for a client
 * @route POST /api/business/clients/:clientId/suggestions
 * @access Private (Business Owner)
 */
const addClientSuggestion = async (req, res) => {
  // #swagger.tags = ['Clients']
  /* #swagger.description = 'Add a suggestion note for a specific client.'
       #swagger.security = [{ "Bearer": [] }]
       #swagger.parameters['obj'] = {
          in: 'body',
          description: 'Suggestion details.',
          required: true,
          schema: {
            note: 'Consider trying a shorter haircut style next time.',
            images: ['image1.jpg', 'image2.jpg']
          }
       }
    */
  try {
    const { clientId } = req.params;
    const { note, images = [] } = req.body;

    if (!note) {
      return ErrorHandler("Suggestion note is required.", 400, req, res);
    }

    // Use _id directly for ObjectId queries (more reliable than string conversion)
    const userId = req.user._id || req.user.id;
    const business = await Business.findOne({ owner: userId });
    if (!business) {
      return ErrorHandler("Business not found for this user.", 404, req, res);
    }

    const client = await Client.findOne({
      _id: clientId,
      business: business._id,
    });
    if (!client) {
      return ErrorHandler("Client not found.", 404, req, res);
    }

    // Create suggestion using the Note model
    const Note = require("../models/note");
    const suggestion = new Note({
      businessId: business._id,
      clientId: client._id,
      createdBy: req.user.id,
      content: note,
      type: "suggestion",
      images: images,
    });

    await suggestion.save();

    return SuccessHandler(suggestion, 201, res);
  } catch (error) {
    return ErrorHandler(error.message, 500, req, res);
  }
};

/**
 * @desc Get all suggestions for clients
 * @route GET /api/business/clients/suggestions
 * @access Private (Business Owner)
 */
const getClientSuggestions = async (req, res) => {
  // #swagger.tags = ['Clients']
  /* #swagger.description = 'Get all client suggestions for the business.'
       #swagger.security = [{ "Bearer": [] }]
       #swagger.parameters['page'] = { in: 'query', description: 'Page number for pagination', type: 'integer' }
       #swagger.parameters['limit'] = { in: 'query', description: 'Number of items per page', type: 'integer' }
    */
  try {
    const { page = 1, limit = 10 } = req.query;
    const pageNumber = parseInt(page);
    const limitNumber = parseInt(limit);
    const skip = (pageNumber - 1) * limitNumber;

    // Use _id directly for ObjectId queries (more reliable than string conversion)
    const userId = req.user._id || req.user.id;
    const business = await Business.findOne({ owner: userId });
    if (!business) {
      return ErrorHandler("Business not found for this user.", 404, req, res);
    }

    const galleryWithSuggestions = await HaircutGallery.find({
      business: business._id,
      isActive: true,
      "suggestions.0": { $exists: true },
    })
      .populate("client", "firstName lastName phone profileImage")
      .populate("suggestions.createdBy", "firstName lastName")
      .sort({ updatedAt: -1 });

    const legacyNotes = await Note.find({
      businessId: business._id,
      type: "suggestion",
    })
      .populate("clientId", "firstName lastName phone profileImage")
      .populate("createdBy", "firstName lastName")
      .sort({ createdAt: -1 });

    const combinedSuggestions = [];

    galleryWithSuggestions.forEach((gallery) => {
      gallery.suggestions.forEach((suggestion) => {
        combinedSuggestions.push(
          normalizeGallerySuggestionItem(gallery, suggestion)
        );
      });
    });

    legacyNotes.forEach((note) => {
      combinedSuggestions.push(normalizeLegacyNoteItem(note));
    });

    combinedSuggestions.sort(sortByCreatedAtDesc);

    const total = combinedSuggestions.length;
    const suggestions = combinedSuggestions.slice(skip, skip + limitNumber);

    return SuccessHandler(
      {
        suggestions,
        pagination: {
          total,
          page: pageNumber,
          pages: Math.ceil(total / limitNumber),
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
 * @desc Add an issue report for a client
 * @route POST /api/business/clients/:clientId/reports
 * @access Private (Business Owner)
 */
const addClientReport = async (req, res) => {
  // #swagger.tags = ['Clients']
  /* #swagger.description = 'Add an issue report for a specific client.'
       #swagger.security = [{ "Bearer": [] }]
       #swagger.parameters['obj'] = {
          in: 'body',
          description: 'Report details.',
          required: true,
          schema: {
            note: 'Client was unsatisfied with the service quality.',
            reportType: 'service_quality',
            images: ['image1.jpg']
          }
       }
    */
  try {
    const { clientId } = req.params;
    const { note, reportType = "other", images = [] } = req.body;

    if (!note) {
      return ErrorHandler("Report note is required.", 400, req, res);
    }

    // Use _id directly for ObjectId queries (more reliable than string conversion)
    const userId = req.user._id || req.user.id;
    const business = await Business.findOne({ owner: userId });
    if (!business) {
      return ErrorHandler("Business not found for this user.", 404, req, res);
    }

    const client = await Client.findOne({
      _id: clientId,
      business: business._id,
    });
    if (!client) {
      return ErrorHandler("Client not found.", 404, req, res);
    }

    // Create report using the Note model
    const Note = require("../models/note");
    const report = new Note({
      businessId: business._id,
      clientId: client._id,
      createdBy: req.user.id,
      content: note,
      type: "report",
      reportType: reportType,
      images: images,
      status: "pending",
    });

    await report.save();

    return SuccessHandler(report, 201, res);
  } catch (error) {
    return ErrorHandler(error.message, 500, req, res);
  }
};

/**
 * @desc Get all issue reports for clients
 * @route GET /api/business/clients/reports
 * @access Private (Business Owner)
 */
const getClientReports = async (req, res) => {
  // #swagger.tags = ['Clients']
  /* #swagger.description = 'Get all client issue reports for the business.'
       #swagger.security = [{ "Bearer": [] }]
       #swagger.parameters['status'] = { in: 'query', description: 'Filter by report status', type: 'string' }
       #swagger.parameters['page'] = { in: 'query', description: 'Page number for pagination', type: 'integer' }
       #swagger.parameters['limit'] = { in: 'query', description: 'Number of items per page', type: 'integer' }
    */
  try {
    const { status, page = 1, limit = 10 } = req.query;
    const pageNumber = parseInt(page);
    const limitNumber = parseInt(limit);
    const skip = (pageNumber - 1) * limitNumber;
    const normalizedStatus =
      typeof status === "string" && ALLOWED_REPORT_STATUSES.has(status)
        ? status
        : null;

    // Use _id directly for ObjectId queries (more reliable than string conversion)
    const userId = req.user._id || req.user.id;
    const business = await Business.findOne({ owner: userId });
    if (!business) {
      return ErrorHandler("Business not found for this user.", 404, req, res);
    }

    let query = {
      business: business._id,
      isActive: true,
      "reports.0": { $exists: true }, // Has at least one report
    };

    // If status filter is provided, add it to the query
    if (status && !normalizedStatus) {
      return ErrorHandler("Invalid report status filter.", 400, req, res);
    }

    if (normalizedStatus) {
      query["reports.status"] = normalizedStatus;
    }

    const galleryWithReports = await HaircutGallery.find(query)
      .populate("client", "firstName lastName phone profileImage")
      .populate("reports.createdBy", "firstName lastName")
      .sort({ updatedAt: -1 });

    const legacyReportQuery = {
      businessId: business._id,
      type: "report",
    };
    if (normalizedStatus) {
      legacyReportQuery.status = normalizedStatus;
    }

    const legacyReports = await Note.find(legacyReportQuery)
      .populate("clientId", "firstName lastName phone profileImage")
      .populate("createdBy", "firstName lastName")
      .sort({ createdAt: -1 });

    const combinedReports = [];
    galleryWithReports.forEach((gallery) => {
      gallery.reports.forEach((report) => {
        if (!normalizedStatus || report.status === normalizedStatus) {
          combinedReports.push(normalizeGalleryReportItem(gallery, report));
        }
      });
    });

    legacyReports.forEach((note) => {
      combinedReports.push(normalizeLegacyNoteItem(note));
    });

    combinedReports.sort(sortByCreatedAtDesc);

    const total = combinedReports.length;
    const reports = combinedReports.slice(skip, skip + limitNumber);

    return SuccessHandler(
      {
        reports,
        pagination: {
          total,
          page: pageNumber,
          pages: Math.ceil(total / limitNumber),
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
 * @desc Update report status
 * @route PUT /api/business/clients/reports/:reportId
 * @access Private (Business Owner)
 */
const updateReportStatus = async (req, res) => {
  // #swagger.tags = ['Clients']
  /* #swagger.description = 'Update the status of a client report.'
       #swagger.security = [{ "Bearer": [] }]
       #swagger.parameters['obj'] = {
          in: 'body',
          description: 'Report status update.',
          required: true,
          schema: {
            status: 'resolved',
            reviewNote: 'Issue has been addressed with the client.'
          }
       }
    */
  try {
    const { reportId } = req.params;
    const { status, reviewNote } = req.body;

    // Use _id directly for ObjectId queries (more reliable than string conversion)
    const userId = req.user._id || req.user.id;
    const business = await Business.findOne({ owner: userId });
    if (!business) {
      return ErrorHandler("Business not found for this user.", 404, req, res);
    }

    const Note = require("../models/note");
    const report = await Note.findOne({
      _id: reportId,
      businessId: business._id,
      type: "report",
    });

    if (!report) {
      return ErrorHandler("Report not found.", 404, req, res);
    }

    const updateData = {};
    if (status) updateData.status = status;
    if (reviewNote) updateData.reviewNote = reviewNote;
    updateData.reviewedBy = req.user.id;
    updateData.reviewedAt = new Date();

    const updatedReport = await Note.findByIdAndUpdate(reportId, updateData, {
      new: true,
    }).populate("clientId", "firstName lastName phone");

    return SuccessHandler(updatedReport, 200, res);
  } catch (error) {
    return ErrorHandler(error.message, 500, req, res);
  }
};

/**
 * @desc Send response to client suggestion or report tied to a haircut gallery entry
 *
 * Supports responding to:
 * - a suggestion: sets suggestions.$.response/By/At
 * - a report: sets reports.$.reviewNote/By/At and optionally updates status
 *
 * @route POST /api/business/clients/notes/:noteId/respond
 * @access Private (Business Owner)
 */
const respondToClientNote = async (req, res) => {
  // #swagger.tags = ['Clients']
  /* #swagger.description = 'Send a response to a client suggestion or report.'
       #swagger.security = [{ "Bearer": [] }]
       #swagger.parameters['obj'] = {
          in: 'body',
          description: 'Response details.',
          required: true,
          schema: {
            response: 'Thank you for your feedback. We will consider this for your next appointment.'
          }
       }
    */
  try {
    const { noteId } = req.params;
    const { response, status } = req.body;

    if (!response) {
      return ErrorHandler("Response message is required.", 400, req, res);
    }

    // Use _id directly for ObjectId queries (more reliable than string conversion)
    const userId = req.user._id || req.user.id;
    const business = await Business.findOne({ owner: userId });
    if (!business) {
      return ErrorHandler("Business not found for this user.", 404, req, res);
    }

    // NOTE: The legacy implementation wrote to Note model. Now align to HaircutGallery.
    // Try to update a suggestion first
    const suggestionUpdate = await HaircutGallery.findOneAndUpdate(
      {
        business: business._id,
        isActive: true,
        "suggestions._id": noteId,
      },
      {
        $set: {
          "suggestions.$.response": response,
          "suggestions.$.respondedBy": req.user.id,
          "suggestions.$.respondedAt": new Date(),
        },
      },
      { new: true }
    )
      .populate("client", "firstName lastName phone profileImage")
      .populate("suggestions.createdBy", "firstName lastName");

    if (suggestionUpdate) {
      return SuccessHandler(
        { message: "Response sent successfully", gallery: suggestionUpdate },
        200,
        res
      );
    }

    // If not a suggestion, try to update a report's review note/status
    const reportSet = {
      "reports.$.reviewNote": response,
      "reports.$.reviewedBy": req.user.id,
      "reports.$.reviewedAt": new Date(),
    };
    if (status) {
      reportSet["reports.$.status"] = status;
    }

    const reportUpdate = await HaircutGallery.findOneAndUpdate(
      {
        business: business._id,
        isActive: true,
        "reports._id": noteId,
      },
      { $set: reportSet },
      { new: true }
    )
      .populate("client", "firstName lastName phone profileImage")
      .populate("reports.createdBy", "firstName lastName");

    if (reportUpdate) {
      return SuccessHandler(
        { message: "Response sent successfully", gallery: reportUpdate },
        200,
        res
      );
    }

    const legacySuggestionUpdate = await Note.findOneAndUpdate(
      {
        _id: noteId,
        businessId: business._id,
        type: "suggestion",
      },
      {
        $set: {
          response,
          respondedBy: req.user.id,
          respondedAt: new Date(),
        },
      },
      { new: true }
    ).populate("clientId", "firstName lastName phone profileImage");

    if (legacySuggestionUpdate) {
      return SuccessHandler(
        { message: "Response sent successfully", note: legacySuggestionUpdate },
        200,
        res
      );
    }

    const legacyReportUpdate = await Note.findOneAndUpdate(
      {
        _id: noteId,
        businessId: business._id,
        type: "report",
      },
      {
        $set: {
          reviewNote: response,
          reviewedBy: req.user.id,
          reviewedAt: new Date(),
          ...(status ? { status } : {}),
        },
      },
      { new: true }
    ).populate("clientId", "firstName lastName phone profileImage");

    if (legacyReportUpdate) {
      return SuccessHandler(
        { message: "Response sent successfully", note: legacyReportUpdate },
        200,
        res
      );
    }

    return ErrorHandler("Note not found.", 404, req, res);
  } catch (error) {
    return ErrorHandler(error.message, 500, req, res);
  }
};

/**
 * @swagger
 * /api/business/clients/note-counts:
 *   get:
 *     summary: Get counts of client suggestions and reports
 *     tags: [Client Notes]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Note counts retrieved successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: object
 *                   properties:
 *                     suggestions:
 *                       type: number
 *                     reports:
 *                       type: number
 *       401:
 *         description: Unauthorized
 *       500:
 *         description: Server error
 */
const getClientNoteCounts = async (req, res) => {
  try {
    const userId = req.user._id || req.user.id;
    const business = await Business.findOne({ owner: userId });
    if (!business) {
      return ErrorHandler("Business not found for this user.", 404, req, res);
    }

    const galleryEntries = await HaircutGallery.find({
      business: business._id,
      isActive: true,
      $or: [
        { "suggestions.0": { $exists: true } },
        { "reports.0": { $exists: true } },
      ],
    });

    const [legacySuggestionsCount, legacyReportsCount] = await Promise.all([
      Note.countDocuments({ businessId: business._id, type: "suggestion" }),
      Note.countDocuments({ businessId: business._id, type: "report" }),
    ]);

    let suggestionsCount = legacySuggestionsCount;
    let reportsCount = legacyReportsCount;

    galleryEntries.forEach((gallery) => {
      suggestionsCount += gallery.suggestions.length;
      reportsCount += gallery.reports.length;
    });

    res.status(200).json({
      success: true,
      data: {
        suggestions: suggestionsCount,
        reports: reportsCount,
      },
    });
  } catch (error) {
    console.error("Error getting client note counts:", error);
    res.status(500).json({
      success: false,
      message: "Failed to get note counts",
      error: error.message,
    });
  }
};

/**
 * @desc Get client notification preferences
 * @route GET /api/business/clients/:clientId/notifications
 * @access Private (Business Owner)
 */
const getClientNotificationPreferences = async (req, res) => {
  // #swagger.tags = ['Clients']
  /* #swagger.description = 'Get notification preferences for a specific client.'
       #swagger.security = [{ "Bearer": [] }]
    */
  try {
    const { clientId } = req.params;

    // Check if business exists
    // Use _id directly for ObjectId queries (more reliable than string conversion)
    const userId = req.user._id || req.user.id;
    const business = await Business.findOne({ owner: userId });
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

    // Get notification preferences (default to enabled if not set)
    const notificationPrefs = {
      enabled:
        client.notificationsEnabled !== undefined
          ? client.notificationsEnabled
          : true,
      clientId: client._id,
      updatedAt: client.updatedAt,
    };

    return SuccessHandler(notificationPrefs, 200, res);
  } catch (error) {
    return ErrorHandler(error.message, 500, req, res);
  }
};

/**
 * @desc Toggle client notification preferences
 * @route PATCH /api/business/clients/:clientId/notifications
 * @access Private (Business Owner)
 */
const toggleClientNotifications = async (req, res) => {
  // #swagger.tags = ['Clients']
  /* #swagger.description = 'Toggle notification preferences for a specific client.'
       #swagger.security = [{ "Bearer": [] }]
       #swagger.parameters['obj'] = {
          in: 'body',
          description: 'Notification preference.',
          required: true,
          schema: {
            enabled: true
          }
       }
    */
  try {
    const { clientId } = req.params;
    const { enabled } = req.body;

    if (typeof enabled !== "boolean") {
      return ErrorHandler(
        "Enabled field must be a boolean value.",
        400,
        req,
        res
      );
    }

    // Check if business exists
    // Use _id directly for ObjectId queries (more reliable than string conversion)
    const userId = req.user._id || req.user.id;
    const business = await Business.findOne({ owner: userId });
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

    // Update notification preferences
    client.notificationsEnabled = enabled;
    await client.save();

    const notificationPrefs = {
      enabled: client.notificationsEnabled,
      clientId: client._id,
      updatedAt: client.updatedAt,
    };

    return SuccessHandler(notificationPrefs, 200, res);
  } catch (error) {
    return ErrorHandler(error.message, 500, req, res);
  }
};

/**
 * @desc Get public client profile (for client-side access)
 * @route GET /api/client/profile/:clientId
 * @access Public
 */
const getPublicClientProfile = async (req, res) => {
  // #swagger.tags = ['Clients']
  /* #swagger.description = 'Get public client profile information.'
   */
  try {
    const { clientId } = req.params;

    const client = await Client.findById(clientId)
      .select(
        "firstName lastName email profileImage staff business isProfileComplete"
      )
      .populate("staff", "_id firstName lastName email phone")
      .populate("business", "_id name businessName");

    if (!client) {
      return ErrorHandler("Client not found.", 404, req, res);
    }

    return SuccessHandler(client, 200, res);
  } catch (error) {
    return ErrorHandler(error.message, 500, req, res);
  }
};

/**
 * @desc Get client's own profile (authenticated client)
 * @route GET /api/client/profile
 * @access Private (Client)
 */
const getClientProfile = async (req, res) => {
  // #swagger.tags = ['Clients']
  /* #swagger.description = 'Get current authenticated client profile.'
       #swagger.security = [{ "Bearer": [] }]
    */
  try {
    // Assuming client authentication is implemented similar to business auth
    // For now, we'll use a client ID from request params or headers
    const clientId = req.headers["x-client-id"] || req.user?.clientId;

    if (!clientId) {
      return ErrorHandler("Client ID is required.", 400, req, res);
    }

    const client = await Client.findById(clientId).select(
      "firstName lastName email profileImage phone preferences isProfileComplete notificationsEnabled internalNotes haircutPhotos"
    );
    if (!client) {
      return ErrorHandler("Client not found.", 404, req, res);
    }

    return SuccessHandler(client, 200, res);
  } catch (error) {
    return ErrorHandler(error.message, 500, req, res);
  }
};

/**
 * @desc Update client profile (client-side)
 * @route PATCH /api/client/profile
 * @access Private (Client)
 */
const updateClientProfile = async (req, res) => {
  // #swagger.tags = ['Clients']
  /* #swagger.description = 'Update client profile including profile image (client-side).'
       #swagger.consumes = ['multipart/form-data']
       #swagger.parameters['profileImage'] = { in: 'formData', type: 'file', description: 'Profile image (optional)' }
       #swagger.parameters['removeProfileImage'] = { in: 'formData', type: 'boolean', description: 'Remove profile image if true' }
    */
  try {
    const clientId = req.headers["x-client-id"] || req.user?.clientId;
    const { invitationToken } = req.query;
    let finalClientId = clientId;

    // If no client ID in header, try to get it from invitation token
    if (!finalClientId && invitationToken) {
      const client = await Client.findOne({ invitationToken });
      if (client) {
        finalClientId = client._id.toString();
      }
    }

    if (!finalClientId) {
      return ErrorHandler(
        "Client ID is required in headers or invitation token in query.",
        400,
        req,
        res
      );
    }

    const client = await Client.findById(finalClientId);
    if (!client) {
      return ErrorHandler("Client not found.", 404, req, res);
    }

    const updateData = {};

    // Handle profile image removal
    if (req.body.removeProfileImage === 'true' || req.body.removeProfileImage === true) {
      if (client.profileImage) {
        try {
          // Extract public_id from URL if it's a Cloudinary URL
          const urlParts = client.profileImage.split('/');
          const publicIdWithExt = urlParts[urlParts.length - 1];
          const publicId = publicIdWithExt.split('.')[0];
          const folder = urlParts[urlParts.length - 2];
          const fullPublicId = folder ? `${folder}/${publicId}` : publicId;

          const { deleteImage } = require("../functions/cloudinary");
          await deleteImage(fullPublicId);
        } catch (deleteError) {
          console.error("Error deleting old profile image:", deleteError);
          // Continue with removal even if Cloudinary deletion fails
        }
      }
      updateData.profileImage = null;
    }
    // Handle profile image upload
    else if (req.file) {
      try {
        const { uploadFileToCloudinary, deleteImage } = require("../functions/cloudinary");

        // Delete old profile image if exists
        if (client.profileImage) {
          try {
            const urlParts = client.profileImage.split('/');
            const publicIdWithExt = urlParts[urlParts.length - 1];
            const publicId = publicIdWithExt.split('.')[0];
            const folder = urlParts[urlParts.length - 2];
            const fullPublicId = folder ? `${folder}/${publicId}` : publicId;
            await deleteImage(fullPublicId);
          } catch (deleteError) {
            console.error("Error deleting old profile image:", deleteError);
            // Continue with upload even if old image deletion fails
          }
        }

        const cloudinaryResult = await uploadFileToCloudinary(
          req.file.buffer,
          "client-profiles",
          "image"
        );
        updateData.profileImage = cloudinaryResult.secure_url;
      } catch (uploadError) {
        console.error("Failed to upload profile image:", uploadError.message);
        return ErrorHandler(
          "Failed to upload profile image. Please try again.",
          500,
          req,
          res
        );
      }
    }

    // Update client profile
    const updatedClient = await Client.findByIdAndUpdate(
      finalClientId,
      updateData,
      { new: true, runValidators: true }
    ).select("firstName lastName email profileImage phone preferences isProfileComplete notificationsEnabled");

    return SuccessHandler(
      {
        message: "Profile updated successfully",
        client: updatedClient,
      },
      200,
      res
    );
  } catch (error) {
    return ErrorHandler(error.message, 500, req, res);
  }
};

/**
 * @desc Delete client account (client-side) - Permanently deletes all client data including photos
 * @route DELETE /api/client/profile
 * @access Private (Client)
 */
const deleteClientProfile = async (req, res) => {
  // #swagger.tags = ['Clients']
  /* #swagger.description = 'Permanently delete client account and all associated data including photos (client-side). This action cannot be undone and complies with data protection regulations.'
       #swagger.security = [{ "Bearer": [] }]
    */
  try {
    const clientId = req.headers["x-client-id"] || req.user?.clientId;

    if (!clientId) {
      return ErrorHandler("Client ID is required.", 400, req, res);
    }

    const client = await Client.findById(clientId);
    if (!client) {
      return ErrorHandler("Client not found.", 404, req, res);
    }

    // 1. Delete all gallery photos and their images from Cloudinary
    try {
      const galleryPhotos = await HaircutGallery.find({
        client: clientId,
      });

      for (const galleryPhoto of galleryPhotos) {
        // Delete main image from Cloudinary
        if (galleryPhoto.imagePublicId) {
          try {
            await deleteImage(galleryPhoto.imagePublicId);
          } catch (cloudinaryError) {
            console.error(
              `Failed to delete gallery image from Cloudinary (${galleryPhoto.imagePublicId}):`,
              cloudinaryError
            );
            // Continue with deletion even if Cloudinary deletion fails
          }
        }

        // Delete suggestion images from Cloudinary
        if (galleryPhoto.suggestions && Array.isArray(galleryPhoto.suggestions)) {
          for (const suggestion of galleryPhoto.suggestions) {
            if (suggestion.imagePublicId) {
              try {
                await deleteImage(suggestion.imagePublicId);
              } catch (cloudinaryError) {
                console.error(
                  `Failed to delete suggestion image from Cloudinary:`,
                  cloudinaryError
                );
              }
            }
          }
        }

        // Delete report images from Cloudinary
        if (galleryPhoto.reports && Array.isArray(galleryPhoto.reports)) {
          for (const report of galleryPhoto.reports) {
            if (report.imagePublicId) {
              try {
                await deleteImage(report.imagePublicId);
              } catch (cloudinaryError) {
                console.error(
                  `Failed to delete report image from Cloudinary:`,
                  cloudinaryError
                );
              }
            }
          }
        }
      }

      // Hard delete all gallery entries from database
      await HaircutGallery.deleteMany({ client: clientId });
    } catch (galleryError) {
      console.error("Error deleting gallery photos:", galleryError);
      // Continue with client deletion even if gallery deletion fails
    }

    // 2. Delete profile image from Cloudinary
    if (client.profileImage) {
      try {
        // Extract public_id from URL if it's a Cloudinary URL
        const urlParts = client.profileImage.split('/');
        const publicIdWithExt = urlParts[urlParts.length - 1];
        const publicId = publicIdWithExt.split('.')[0];
        const folder = urlParts[urlParts.length - 2];
        const fullPublicId = folder ? `${folder}/${publicId}` : publicId;

        await deleteImage(fullPublicId);
      } catch (profileImageError) {
        console.error("Failed to delete profile image from Cloudinary:", profileImageError);
        // Continue with deletion even if profile image deletion fails
      }
    }

    // 3. Delete all notes associated with the client
    try {
      await Note.deleteMany({ clientId: clientId });
    } catch (noteError) {
      console.error("Error deleting client notes:", noteError);
      // Continue with client deletion even if notes deletion fails
    }

    // 4. Hard delete the client record (permanent deletion for GDPR compliance)
    await Client.findByIdAndDelete(clientId);

    return SuccessHandler(
      { message: "Account and all associated data deleted successfully" },
      200,
      res
    );
  } catch (error) {
    return ErrorHandler(error.message, 500, req, res);
  }
};

/**
 * @desc Get client's gallery (client-side)
 * @route GET /api/client/gallery/:clientId
 * @access Public
 */
const getClientGalleryByClient = async (req, res) => {
  // #swagger.tags = ['Clients']
  /* #swagger.description = 'Get client gallery images (client-side access).'
   */
  try {
    const { clientId } = req.params;

    const client = await Client.findById(clientId);
    if (!client) {
      return ErrorHandler("Client not found.", 404, req, res);
    }

    const gallery = await HaircutGallery.find({
      client: clientId,
      isActive: true,
    }).sort({ createdAt: -1 });

    return SuccessHandler({ gallery }, 200, res);
  } catch (error) {
    return ErrorHandler(error.message, 500, req, res);
  }
};

/**
 * @desc Get client's own notification preferences (client-side)
 * @route GET /api/client/notifications
 * @access Private (Client)
 */
const getClientOwnNotificationPreferences = async (req, res) => {
  // #swagger.tags = ['Clients']
  /* #swagger.description = 'Get client\'s own notification preferences.'
   */
  try {
    const clientId = req.headers["x-client-id"];

    if (!clientId) {
      return ErrorHandler("Client ID is required.", 400, req, res);
    }

    const client = await Client.findById(clientId);
    if (!client) {
      return ErrorHandler("Client not found.", 404, req, res);
    }

    // Get notification preferences (default to enabled if not set)
    const notificationPrefs = {
      enabled:
        client.notificationsEnabled !== undefined
          ? client.notificationsEnabled
          : true,
      clientId: client._id,
      updatedAt: client.updatedAt,
    };

    return SuccessHandler(notificationPrefs, 200, res);
  } catch (error) {
    return ErrorHandler(error.message, 500, req, res);
  }
};

/**
 * @desc Toggle client's own notification preferences (client-side)
 * @route PATCH /api/client/notifications
 * @access Private (Client)
 */
const toggleClientOwnNotifications = async (req, res) => {
  // #swagger.tags = ['Clients']
  /* #swagger.description = 'Toggle client\'s own notification preferences.'
       #swagger.parameters['obj'] = {
          in: 'body',
          description: 'Notification preference.',
          required: true,
          schema: {
            enabled: true
          }
       }
    */
  try {
    const clientId = req.headers["x-client-id"];
    const { enabled } = req.body;

    if (!clientId) {
      return ErrorHandler("Client ID is required.", 400, req, res);
    }

    if (typeof enabled !== "boolean") {
      return ErrorHandler(
        "Enabled field must be a boolean value.",
        400,
        req,
        res
      );
    }

    const client = await Client.findById(clientId);
    if (!client) {
      return ErrorHandler("Client not found.", 404, req, res);
    }

    // Update notification preferences
    client.notificationsEnabled = enabled;
    await client.save();

    const notificationPrefs = {
      enabled: client.notificationsEnabled,
      clientId: client._id,
      updatedAt: client.updatedAt,
    };

    return SuccessHandler(notificationPrefs, 200, res);
  } catch (error) {
    return ErrorHandler(error.message, 500, req, res);
  }
};

/**
 * @desc Logout client by clearing authentication cookie
 * @route POST /api/client/logout
 * @access Public (works even with expired tokens)
 */
const clientLogout = async (req, res) => {
  // #swagger.tags = ['Clients']
  /* #swagger.description = 'Logout client by clearing authentication cookie. Works even with expired tokens.'
     #swagger.responses[200] = {
        description: 'Client logged out successfully'
     }
  */
  try {
    // Determine if we're in production (check multiple ways for reliability)
    const isProduction = process.env.NODE_ENV === 'production' ||
      process.env.VERCEL === '1' ||
      process.env.RAILWAY_ENVIRONMENT === 'production';

    // Cookie options must match the ones used when setting cookies
    const cookieOptions = {
      path: '/',
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? 'none' : 'lax'
    };

    // Clear client auth cookie (works even if token is expired)
    res.clearCookie('clientToken', cookieOptions);

    return SuccessHandler(
      { message: "Logged out successfully" },
      200,
      res
    );
  } catch (error) {
    return ErrorHandler(error.message, 500, req, res);
  }
};

/**
 * @desc Unblock a client from app booking
 * @route PUT /api/client/:id/unblock
 * @access Private (Business Owner)
 */
const unblockClient = async (req, res) => {
  // #swagger.tags = ['Clients']
  /* #swagger.description = 'Unblock a client from app booking. Recording the action in the audit trail.'
       #swagger.security = [{ "Bearer": [] }]
    */
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const { clientId } = req.params;
    const userId = req.user._id || req.user.id;
    const business = await Business.findOne({ owner: userId });
    
    if (!business) {
      await session.abortTransaction();
      session.endSession();
      return ErrorHandler("Business not found for this user.", 404, req, res);
    }

    const client = await Client.findOne({ _id: clientId, business: business._id }).session(session);
    if (!client) {
      await session.abortTransaction();
      session.endSession();
      return ErrorHandler("Client not found.", 404, req, res);
    }

    client.appBookingBlocked = false;
    await client.save({ session });

    // Record audit trail
    await Auditing.create([{
      entityType: "Client",
      entityId: client._id,
      action: "modified",
      reason: "Client unblocked from app booking by barber.",
      createdBy: userId,
      metadata: {
        actionType: 'unblock',
        businessId: business._id,
        businessName: business.name || business.businessName
      }
    }], { session });

    await session.commitTransaction();
    session.endSession();

    return SuccessHandler("Client unblocked successfully.", 200, res);
  } catch (error) {
    if (session) {
      await session.abortTransaction();
      session.endSession();
    }
    return ErrorHandler(error.message, 500, req, res);
  }
};

module.exports = {
  unblockClient,
  addClient,
  getClients,
  getClientById,
  updateClient,
  updatePrivateNotes,
  deleteClient,
  getClientByInvitationToken,
  getInvitationLink,
  updateClientInvitationToken,
  getAllClient,
  updateClientStatus,
  uploadClientsCSV,
  clientLogin,
  clientLogout,
  clientSignUp,
  clientSignIn,
  clientForgotPassword,
  clientResetPassword,
  completeClientProfile,
  resendInvitationSMS,
  getBusinessDetails,
  getBusinessGallery,
  addClientSuggestion,
  getClientSuggestions,
  addClientReport,
  getClientReports,
  updateReportStatus,
  respondToClientNote,
  getClientNoteCounts,
  getClientNotificationPreferences,
  toggleClientNotifications,
  getPublicClientProfile,
  getClientProfile,
  updateClientProfile,
  deleteClientProfile,
  getClientGalleryByClient,
  getClientOwnNotificationPreferences,
  toggleClientOwnNotifications,
  getClientPhone,
  sendCustomMessageToClients,
};
