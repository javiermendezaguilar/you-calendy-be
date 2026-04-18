const Business = require("../models/User/business");
const ApiError = require("../utils/ApiError");
const SuccessHandler = require("../utils/SuccessHandler");
const mongoose = require("mongoose");
const Appointment = require("../models/appointment");
const User = require("../models/User/user");
const Note = require("../models/note");
const crypto = require("crypto");
const ErrorHandler = require("../utils/ErrorHandler");
const stripe = require("stripe")(process.env.STRIPE_SECRET);
const moment = require("moment");
const EmailCampaign = require("../models/emailCampaign");
const sendMail = require("../utils/sendMail");
const {
  sendNotificationToAdmins,
} = require("../utils/adminNotificationHelper");
const { uploadToCloudinary, deleteImage } = require("../functions/cloudinary");
const SmsCampaign = require("../models/smsCampaign");
const { sendSMS } = require("../utils/twilio");
const Client = require("../models/client");
const {
  sendBulkSMSWithCredits,
  sendBulkEmailWithCredits,
  checkBulkCredits,
} = require("../utils/creditAwareMessaging");
const { getBusinessCredits } = require("../utils/creditManager");
const BarberLink = require("../models/barberLink");
const { normalizePhone } = require("../utils/index");
const Service = require("../models/service");
const Staff = require("../models/staff");
const {
  getUserBusinessForOwner,
  getBusinessByIdPublic,
  updateBusinessInfoForOwner,
  updateBusinessAddressForOwner,
  updateBusinessLocationForOwner,
  updateBusinessHoursForOwner,
} = require("../services/business/coreService");
const {
  getBusinessServicesForOwner,
  addBusinessServiceForOwner,
  updateBusinessServiceForOwner,
  deleteBusinessServiceForOwner,
} = require("../services/business/serviceService");

const setPerfHeader = (res, timings) => {
  const value = Object.entries(timings)
    .map(([key, ms]) => `${key}=${ms}`)
    .join(";");
  res.set("X-Groomnest-Perf", value);
};

const resolveBusinessForRequest = async (req) => {
  if (req.business) {
    return { business: req.business, lookupMs: 0 };
  }

  const businessLookupStart = Date.now();
  const business = await Business.findOne({ owner: req.user.id });

  return {
    business,
    lookupMs: Date.now() - businessLookupStart,
  };
};

/**
 * @desc Get user's business
 * @route GET /api/business
 * @access Private
 */
const getUserBusiness = async (req, res) => {
  // #swagger.tags = ['Business']
  /* #swagger.description = 'Get current user\'s business details'
     #swagger.security = [{ "Bearer": [] }]
     #swagger.responses[200] = {
        description: 'Business retrieved successfully',
        schema: { $ref: '#/definitions/Business' }
     }
     #swagger.responses[404] = {
        description: 'Business not found'
     }
  */
  try {
    const payload = await getUserBusinessForOwner(req.user.id);
    return SuccessHandler(payload, 200, res);
  } catch (error) {
    console.error("Get business error:", error.message);
    return ErrorHandler(error.message, error.statusCode || 500, req, res);
  }
};

/**
 * @desc Get business by ID
 * @route GET /api/business/:id
 * @access Public
 */
const getBusinessById = async (req, res) => {
  // #swagger.tags = ['Business']
  /* #swagger.description = 'Get business details by ID (public endpoint)'
     #swagger.parameters['id'] = {
        in: 'path',
        description: 'Business ID',
        required: true,
        type: 'string'
     }
     #swagger.responses[200] = {
        description: 'Business retrieved successfully',
        schema: { $ref: '#/definitions/Business' }
     }
     #swagger.responses[404] = {
        description: 'Business not found'
     }
  */
  try {
    const payload = await getBusinessByIdPublic(req.params.id);
    return SuccessHandler(payload, 200, res);
  } catch (error) {
    console.error("Get business by ID error:", error.message);
    return ErrorHandler(error.message, error.statusCode || 500, req, res);
  }
};

/**
 * @desc Update business info
 * @route PUT /api/business/info
 * @access Private
 */
const updateBusinessInfo = async (req, res) => {
  // #swagger.tags = ['Business']
  /* #swagger.description = 'Update business basic information'
     #swagger.security = [{ "Bearer": [] }]
     #swagger.parameters['obj'] = {
        in: 'body',
        description: 'Business information',
        required: true,
        schema: {
          name: 'My Updated Business',
          email: 'business@example.com',
          phone: '+123456789',
          facebook: 'fb.com/mybusiness',
          instagram: 'instagram.com/mybusiness',
          twitter: 'twitter.com/mybusiness'
        }
     }
     #swagger.responses[200] = {
        description: 'Business information updated successfully',
        schema: { $ref: '#/definitions/Business' }
     }
     #swagger.responses[404] = {
        description: 'Business not found'
     }
  */
  try {
    const payload = await updateBusinessInfoForOwner(req.user.id, req.body);
    return SuccessHandler(payload, 200, res);
  } catch (error) {
    console.error("Update business info error:", error.message);
    return ErrorHandler(error.message, error.statusCode || 500, req, res);
  }
};

/**
 * @desc Update business address
 * @route PUT /api/business/address
 * @access Private
 */
const updateBusinessAddress = async (req, res) => {
  // #swagger.tags = ['Business']
  /* #swagger.description = 'Update business address details'
     #swagger.security = [{ "Bearer": [] }]
     #swagger.parameters['obj'] = {
        in: 'body',
        description: 'Business address information',
        required: true,
        schema: {
          streetName: 'Main Street',
          houseNumber: '123',
          city: 'New York',
          postalCode: '10001'
        }
     }
     #swagger.responses[200] = {
        description: 'Business address updated successfully',
        schema: { $ref: '#/definitions/Business' }
     }
     #swagger.responses[404] = {
        description: 'Business not found'
     }
  */
  try {
    const payload = await updateBusinessAddressForOwner(req.user.id, req.body);
    return SuccessHandler(payload, 200, res);
  } catch (error) {
    console.error("Update business address error:", error.message);
    return ErrorHandler(error.message, error.statusCode || 500, req, res);
  }
};

/**
 * @desc Update business location
 * @route PUT /api/business/location
 * @access Private
 */
const updateBusinessLocation = async (req, res) => {
  // #swagger.tags = ['Business']
  /* #swagger.description = 'Update business geo-location'
     #swagger.security = [{ "Bearer": [] }]
     #swagger.parameters['obj'] = {
        in: 'body',
        description: 'Business location information',
        required: true,
        schema: {
          longitude: -73.935242,
          latitude: 40.73061,
          address: '123 Main Street, New York, 10001'
        }
     }
     #swagger.responses[200] = {
        description: 'Business location updated successfully',
        schema: { $ref: '#/definitions/Business' }
     }
     #swagger.responses[400] = {
        description: 'Longitude and latitude are required'
     }
     #swagger.responses[404] = {
        description: 'Business not found'
     }
  */
  try {
    const payload = await updateBusinessLocationForOwner(req.user.id, req.body);
    return SuccessHandler(payload, 200, res);
  } catch (error) {
    console.error("Update business location error:", error.message);
    return ErrorHandler(error.message, error.statusCode || 500, req, res);
  }
};

/**
 * @desc Update business hours
 * @route PUT /api/business/hours
 * @access Private
 */
const updateBusinessHours = async (req, res) => {
  // #swagger.tags = ['Business']
  /* #swagger.description = 'Update business operating hours'
     #swagger.security = [{ "Bearer": [] }]
     #swagger.parameters['obj'] = {
        in: 'body',
        description: 'Business hours information',
        required: true,
        schema: {
          businessHours: {
            monday: { 
              enabled: true, 
              shifts: [{ start: '09:00', end: '17:00' }] 
            },
            tuesday: { 
              enabled: true, 
              shifts: [{ start: '09:00', end: '17:00' }] 
            }
          }
        }
     }
     #swagger.responses[200] = {
        description: 'Business hours updated successfully',
        schema: { $ref: '#/definitions/Business' }
     }
     #swagger.responses[400] = {
        description: 'Business hours data is required'
     }
     #swagger.responses[404] = {
        description: 'Business not found'
     }
  */
  try {
    const payload = await updateBusinessHoursForOwner(req.user.id, req.body);
    return SuccessHandler(payload, 200, res);
  } catch (error) {
    console.error("Update business hours error:", error.message);
    return ErrorHandler(error.message, error.statusCode || 500, req, res);
  }
};

/**
 * @desc Get business services
 * @route GET /api/business/services
 * @access Private
 */
const getBusinessServices = async (req, res) => {
  // #swagger.tags = ['Services']
  /* #swagger.description = 'Get all services offered by the business'
     #swagger.security = [{ "Bearer": [] }]
     #swagger.responses[200] = {
        description: 'Business services retrieved successfully',
        schema: {
          type: 'array',
          items: { $ref: '#/definitions/BusinessService' }
        }
     }
     #swagger.responses[404] = {
        description: 'Business not found'
     }
  */
  try {
    const payload = await getBusinessServicesForOwner(req.user.id);
    return SuccessHandler(payload, 200, res);
  } catch (error) {
    console.error("Get services error:", error.message);
    return ErrorHandler(error.message, error.statusCode || 500, req, res);
  }
};

/**
 * @desc Add business service
 * @route POST /api/business/services
 * @access Private
 */
const addBusinessService = async (req, res) => {
  // #swagger.tags = ['Services']
  /* #swagger.description = 'Add a new service to the business'
     #swagger.security = [{ "Bearer": [] }]
     #swagger.parameters['obj'] = {
        in: 'body',
        description: 'Service information',
        required: true,
        schema: {
          name: 'Haircut',
          type: 'Salon',
          price: 25,
          isFromEnabled: false
        }
     }
     #swagger.responses[201] = {
        description: 'Service added successfully',
        schema: { $ref: '#/definitions/BusinessService' }
     }
     #swagger.responses[400] = {
        description: 'Service name is required'
     }
     #swagger.responses[404] = {
        description: 'Business not found'
     }
  */
  try {
    const payload = await addBusinessServiceForOwner(req.user.id, req.body);
    return SuccessHandler(payload, 201, res);
  } catch (error) {
    console.error("Add service error:", error.message);
    return ErrorHandler(error.message, error.statusCode || 500, req, res);
  }
};

/**
 * @desc Update business service
 * @route PUT /api/business/services/:serviceId
 * @access Private
 */
const updateBusinessService = async (req, res) => {
  // #swagger.tags = ['Services']
  /* #swagger.description = 'Update an existing business service'
     #swagger.security = [{ "Bearer": [] }]
     #swagger.parameters['serviceId'] = {
        in: 'path',
        description: 'ID of the service to update',
        required: true,
        type: 'string'
     }
     #swagger.parameters['obj'] = {
        in: 'body',
        description: 'Updated service information',
        required: true,
        schema: {
          name: 'Premium Haircut',
          type: 'Salon',
          duration: '45min',
          price: 35,
          isFromEnabled: true
        }
     }
     #swagger.responses[200] = {
        description: 'Service updated successfully',
        schema: { $ref: '#/definitions/BusinessService' }
     }
     #swagger.responses[404] = {
        description: 'Business or service not found'
     }
  */
  try {
    const payload = await updateBusinessServiceForOwner(
      req.user.id,
      req.params.serviceId,
      req.body
    );
    return SuccessHandler(payload, 200, res);
  } catch (error) {
    console.error("Update service error:", error.message);
    return ErrorHandler(error.message, error.statusCode || 500, req, res);
  }
};

/**
 * @desc Delete business service
 * @route DELETE /api/business/services/:serviceId
 * @access Private
 */
const deleteBusinessService = async (req, res) => {
  // #swagger.tags = ['Services']
  /* #swagger.description = 'Delete a business service'
     #swagger.security = [{ "Bearer": [] }]
     #swagger.parameters['serviceId'] = {
        in: 'path',
        description: 'ID of the service to delete',
        required: true,
        type: 'string'
     }
     #swagger.responses[200] = {
        description: 'Service deleted successfully'
     }
     #swagger.responses[404] = {
        description: 'Business or service not found'
     }
  */
  try {
    const payload = await deleteBusinessServiceForOwner(
      req.user.id,
      req.params.serviceId
    );
    return SuccessHandler(payload, 200, res);
  } catch (error) {
    console.error("Delete service error:", error.message);
    return ErrorHandler(error.message, error.statusCode || 500, req, res);
  }
};

/**
 * @desc Update complete business profile
 * @route PUT /api/business
 * @access Private
 */
const updateBusinessProfile = async (req, res) => {
  // #swagger.tags = ['Business']
  /* #swagger.description = 'Update complete business profile information'
     #swagger.security = [{ "Bearer": [] }]
     #swagger.parameters['obj'] = {
        in: 'body',
        description: 'Complete business profile information',
        required: true,
        schema: {
          name: 'Updated Business',
          contactInfo: {
            email: 'updated@example.com',
            phone: '+987654321'
          },
          socialMedia: {
            facebook: 'fb.com/updated',
            instagram: 'instagram.com/updated',
            twitter: 'twitter.com/updated'
          },
          address: {
            streetName: 'New Street',
            houseNumber: '456',
            city: 'Boston',
            postalCode: '02101'
          },
          location: {
            coordinates: [-71.0589, 42.3601],
            address: '456 New Street, Boston, 02101'
          },
          businessHours: {
            monday: { enabled: true, shifts: [{ start: '08:00', end: '16:00' }] }
          }
        }
     }
     #swagger.responses[200] = {
        description: 'Business profile updated successfully',
        schema: { $ref: '#/definitions/Business' }
     }
     #swagger.responses[404] = {
        description: 'Business not found'
     }
  */
  try {
    const {
      name,
      contactInfo,
      socialMedia,
      address,
      location,
      businessHours,
      personalName,
      surname,
      timeFormatPreference,
    } = req.body;

    const business = await Business.findOne({ owner: req.user.id });

    if (!business) {
      return ErrorHandler("Business not found", 404, req, res);
    }

    // Update all fields if provided
    if (personalName !== undefined) business.personalName = personalName;
    if (surname !== undefined) business.surname = surname;
    if (name) business.name = name;

    if (contactInfo) {
      if (contactInfo.email) business.contactInfo.email = contactInfo.email;
      if (contactInfo.phone) business.contactInfo.phone = contactInfo.phone;
    }

    if (socialMedia) {
      if (socialMedia.facebook !== undefined)
        business.socialMedia.facebook = socialMedia.facebook;
      if (socialMedia.instagram !== undefined)
        business.socialMedia.instagram = socialMedia.instagram;
      if (socialMedia.twitter !== undefined)
        business.socialMedia.twitter = socialMedia.twitter;
    }

    if (address) {
      if (address.streetName !== undefined)
        business.address.streetName = address.streetName;
      if (address.houseNumber !== undefined)
        business.address.houseNumber = address.houseNumber;
      if (address.city !== undefined) business.address.city = address.city;
      if (address.postalCode !== undefined)
        business.address.postalCode = address.postalCode;
    }

    if (location) {
      if (location.coordinates && location.coordinates.length === 2) {
        business.location.coordinates = location.coordinates;
      }
      if (location.address !== undefined)
        business.location.address = location.address;
    }

    if (businessHours) {
      for (const day in businessHours) {
        if (business.businessHours[day]) {
          business.businessHours[day] = businessHours[day];
        }
      }
    }

    if (timeFormatPreference) {
      if (!VALID_TIME_FORMATS.includes(timeFormatPreference)) {
        return ErrorHandler("Invalid time format preference", 400, req, res);
      }
      business.timeFormatPreference = timeFormatPreference;
    }

    const updatedBusiness = await business.save();
    return SuccessHandler(updatedBusiness, 200, res);
  } catch (error) {
    console.error("Update business profile error:", error.message);
    return ErrorHandler(error.message, 500, req, res);
  }
};

/**
 * @desc Get all unique clients for a business
 * @route GET /api/business/clients
 * @access Private (Business Owner)
 */
const getBusinessClients = async (req, res) => {
  // #swagger.tags = ['Business']
  /* #swagger.description = 'Get a list of all unique clients for the business owner, with aggregated data like total appointments and last visit.'
     #swagger.security = [{ "Bearer": [] }]
  */
  try {
    const business = await Business.findOne({ owner: req.user.id });
    if (!business) {
      return ErrorHandler("Business not found for this user.", 404, req, res);
    }

    const clients = await Appointment.aggregate([
      // 1. Find all appointments for this business
      { $match: { business: business._id } },

      // 2. Sort by date to easily find the last visit
      { $sort: { date: -1 } },

      // 3. Group by client to get unique clients and their data
      {
        $group: {
          _id: "$client",
          totalAppointments: { $sum: 1 },
          lastVisit: { $first: "$date" },
        },
      },

      // 4. Populate client details from the User model
      {
        $lookup: {
          from: "users", // The actual collection name for the User model
          localField: "_id",
          foreignField: "_id",
          as: "clientInfo",
        },
      },

      // 5. Deconstruct the clientInfo array to a single object
      { $unwind: "$clientInfo" },

      // 6. Shape the final output
      {
        $project: {
          _id: 0,
          clientId: "$_id",
          name: "$clientInfo.name",
          email: "$clientInfo.email",
          phone: "$clientInfo.phone",
          profileImage: "$clientInfo.profileImage",
          totalAppointments: 1,
          lastVisit: 1,
        },
      },
    ]);

    return SuccessHandler(clients, 200, res);
  } catch (error) {
    return ErrorHandler(error.message, 500, req, res);
  }
};

/**
 * @desc Add a new client manually by the business owner
 * @route POST /api/business/clients
 * @access Private (Business Owner)
 */
const addClient = async (req, res) => {
  // #swagger.tags = ['Business']
  /* #swagger.description = 'Manually add a new client to the system. If the client already exists by email, they are not re-created.'
     #swagger.security = [{ "Bearer": [] }]
     #swagger.parameters['obj'] = {
        in: 'body',
        description: 'Client details.',
        required: true,
        schema: {
          firstName: 'Jane',
          lastName: 'Smith',
          email: 'jane.smith@example.com',
          phone: '+1987654321'
        }
     }
  */
  try {
    const { firstName, lastName, email, phone, privateNotes } = req.body;

    if (!firstName || !lastName || !email) {
      return ErrorHandler(
        "First name, last name, and email are required.",
        400,
        req,
        res
      );
    }

    // Check if a user with this email already exists
    let client = await User.findOne({ email });

    if (client) {
      // User already exists, maybe return a specific message
      return SuccessHandler(
        { message: "Client with this email already exists.", user: client },
        200,
        res
      );
    }

    // If user does not exist, create a new one
    const randomPassword = crypto.randomBytes(16).toString("hex");

    client = await User.create({
      name: `${firstName} ${lastName}`,
      email,
      phone,
      privateNotes: privateNotes || null,
      password: randomPassword,
      provider: "manual", // To indicate this user was added by a business
    });

    // Optionally, send an email to the new user to set their password
    // await sendMail(client.email, 'Welcome to You-Calendy!', 'Please set your password...');

    return SuccessHandler(
      { message: "Client added successfully.", user: client },
      201,
      res
    );
  } catch (error) {
    // Handle potential duplicate key error for phone number if it's unique
    if (error.code === 11000) {
      return ErrorHandler(
        "A user with this phone number already exists.",
        409,
        req,
        res
      );
    }
    return ErrorHandler(error.message, 500, req, res);
  }
};

/**
 * @desc Get details for a specific client of the business
 * @route GET /api/business/clients/:clientId
 * @access Private (Business Owner)
 */
const getClientDetails = async (req, res) => {
  // #swagger.tags = ['Business']
  /* #swagger.description = 'Retrieves detailed information about a specific client, including their appointment history with the business.'
     #swagger.security = [{ "Bearer": [] }]
     #swagger.parameters['clientId'] = {
        in: 'path',
        description: 'ID of the client to retrieve.',
        required: true,
        type: 'string'
     }
  */
  try {
    const { clientId } = req.params;
    const businessId = req.user.businessId;

    if (!mongoose.Types.ObjectId.isValid(clientId)) {
      return ErrorHandler("Invalid client ID.", 400, req, res);
    }

    const client = await User.findById(clientId).select("-password");
    if (!client) {
      return ErrorHandler("Client not found.", 404, req, res);
    }

    const appointments = await Appointment.find({
      businessId,
      "client.id": clientId,
    })
      .populate("service", "name duration")
      .populate("staff", "name")
      .sort({ date: -1 });

    const notes = await Note.find({ businessId, clientId })
      .populate("createdBy", "name")
      .sort({ createdAt: -1 });

    // We will add client notes later
    const clientData = {
      ...client.toObject(),
      appointments,
      notes,
    };

    return SuccessHandler(clientData, 200, res);
  } catch (error) {
    return ErrorHandler(error.message, 500, req, res);
  }
};

/**
 * @desc Add a note for a specific client
 * @route POST /api/business/clients/:clientId/notes
 * @access Private (Business Owner)
 */
const addClientNote = async (req, res) => {
  // #swagger.tags = ['Business']
  /* #swagger.description = 'Adds a private note to a specific client.'
     #swagger.security = [{ "Bearer": [] }]
     #swagger.parameters['clientId'] = { in: 'path', required: true, description: 'Client ID.' }
     #swagger.parameters['obj'] = {
        in: 'body',
        description: 'Note content.',
        required: true,
        schema: {
          content: 'This client prefers morning appointments.'
        }
     }
  */
  try {
    const { clientId } = req.params;
    const { content } = req.body;
    const businessId = req.user.businessId;
    const createdBy = req.user._id;

    if (!content) {
      return ErrorHandler("Note content cannot be empty.", 400, req, res);
    }

    if (!mongoose.Types.ObjectId.isValid(clientId)) {
      return ErrorHandler("Invalid client ID.", 400, req, res);
    }

    // Verify the client exists and is associated with the business in some way if needed.
    // For now, we trust that the business owner knows the client ID.

    const newNote = await Note.create({
      businessId,
      clientId,
      createdBy,
      content,
    });

    return SuccessHandler(
      { message: "Note added successfully.", note: newNote },
      201,
      res
    );
  } catch (error) {
    return ErrorHandler(error.message, 500, req, res);
  }
};

/**
 * @desc Update business settings (logo, workplace photos, gallery images)
 * @route PUT /api/business/settings
 * @access Private
 */
const updateBusinessSettings = async (req, res) => {
  // #swagger.tags = ['Business']
  /* #swagger.description = 'Update business settings including logo and workplace photos.'
     #swagger.security = [{ "Bearer": [] }]
     #swagger.consumes = ['multipart/form-data']
     #swagger.parameters['logo'] = { in: 'formData', description: 'Logo image file', type: 'file' }
     #swagger.parameters['workplacePhotos'] = { in: 'formData', description: 'Workplace photo files', type: 'array', items: { type: 'file' } }
     #swagger.parameters['deleteLogo'] = { in: 'formData', description: 'Flag to delete logo', type: 'boolean' }
     #swagger.parameters['existingWorkplacePhotos'] = { in: 'formData', description: 'Existing workplace photos to keep', type: 'array' }
     #swagger.responses[200] = { description: 'Business settings updated successfully' }
     #swagger.responses[404] = { description: 'Business not found' }
     #swagger.responses[500] = { description: 'Failed to update settings' }
  */
  try {
    const business = await Business.findOne({ owner: req.user.id });
    if (!business) {
      return ErrorHandler("Business not found", 404, req, res);
    }

    const { files, body } = req;

    // Handle logo deletion
    if (body.deleteLogo === 'true') {
      if (business.profileImages.logo) {
        try {
          console.log("Deleting logo:", business.profileImages.logo);
          await deleteImage(business.profileImages.logo);
          business.profileImages.logo = null;
          console.log("Successfully deleted logo");
        } catch (deleteError) {
          console.error("Failed to delete logo:", deleteError);
        }
      }
    }

    // Handle logo upload
    if (files.logo && files.logo[0]) {
      if (business.profileImages.logo) {
        try {
          console.log("Deleting existing logo:", business.profileImages.logo);
          await deleteImage(business.profileImages.logo);
          console.log("Successfully deleted existing logo");
        } catch (deleteError) {
          console.error("Failed to delete existing logo:", deleteError);
          // Continue with upload even if deletion fails
        }
      }
      console.log("Uploading new logo");
      const logoUrl = await uploadToCloudinary(
        files.logo[0].buffer,
        "business-logos"
      );
      business.profileImages.logo = logoUrl.secure_url;
      console.log("Successfully uploaded logo:", business.profileImages.logo);
    }

    // Handle existing workplace photos (for keeping specific ones)
    if (body.existingWorkplacePhotos !== undefined) {
      const existingPhotos = Array.isArray(body.existingWorkplacePhotos)
        ? body.existingWorkplacePhotos
        : body.existingWorkplacePhotos ? [body.existingWorkplacePhotos] : [];

      // Delete photos that are not in the keep list
      if (business.profileImages.workspacePhotos && business.profileImages.workspacePhotos.length > 0) {
        const photosToDelete = business.profileImages.workspacePhotos.filter(
          url => !existingPhotos.includes(url)
        );

        if (photosToDelete.length > 0) {
          console.log("Deleting removed workplace photos:", photosToDelete);
          await Promise.allSettled(
            photosToDelete.map(async (url) => {
              try {
                await deleteImage(url);
                console.log("Successfully deleted workplace photo:", url);
              } catch (deleteError) {
                console.error("Failed to delete workplace photo:", url, deleteError);
              }
            })
          );
        }
      }

      business.profileImages.workspacePhotos = existingPhotos;
    }

    // Handle workplace photos upload
    if (files.workplacePhotos && files.workplacePhotos.length > 0) {
      // Upload new workplace photos
      console.log(
        "Uploading new workplace photos:",
        files.workplacePhotos.length
      );
      const photoUrls = await Promise.all(
        files.workplacePhotos.map((file) =>
          uploadToCloudinary(file.buffer, "workplace-photos")
        )
      );

      // Append to existing photos (if any)
      const newPhotoUrls = photoUrls.map((result) => result.secure_url);
      business.profileImages.workspacePhotos = [
        ...(business.profileImages.workspacePhotos || []),
        ...newPhotoUrls
      ];

      console.log(
        "Successfully uploaded workplace photos:",
        newPhotoUrls
      );
    }

    // Handle existing gallery images (for removal/update)
    if (req.body.existingGalleryImages !== undefined) {
      const existingImages = Array.isArray(req.body.existingGalleryImages)
        ? req.body.existingGalleryImages
        : req.body.existingGalleryImages ? [req.body.existingGalleryImages] : [];
      business.profileImages.galleryImages = existingImages;
    }

    // Handle gallery images upload
    if (files.galleryImages && files.galleryImages.length > 0) {
      const galleryUrls = await Promise.all(
        files.galleryImages.map((file) =>
          uploadToCloudinary(file.buffer, "gallery-images")
        )
      );
      business.profileImages.galleryImages = [
        ...(business.profileImages.galleryImages || []),
        ...galleryUrls.map((result) => result.secure_url),
      ];
    }

    const updatedBusiness = await business.save();

    return SuccessHandler(
      {
        message: "Settings updated successfully",
        business: updatedBusiness.profileImages,
      },
      200,
      res
    );
  } catch (error) {
    console.error("Update business settings error:", error);
    return ErrorHandler("Failed to update settings", 500, req, res);
  }
};

/**
 * @desc Get business settings (logo, workplace photos, gallery images)
 * @route GET /api/business/settings
 * @access Private
 */
const getBusinessSettings = async (req, res) => {
  // #swagger.tags = ['Business']
  /* #swagger.description = 'Get business settings including logo, workplace photos, and gallery images'
     #swagger.security = [{ "Bearer": [] }]
     #swagger.responses[200] = {
        description: 'Business settings retrieved successfully',
        schema: {
          logo: 'https://example.com/logo.png',
          workplacePhotos: ['https://example.com/workplace1.png'],
          galleryImages: ['https://example.com/gallery1.png']
        }
     }
     #swagger.responses[404] = {
        description: 'Business not found'
     }
  */
  try {
    const business = await Business.findOne({ owner: req.user.id });

    if (!business) {
      return ErrorHandler("Business not found", 404, req, res);
    }

    const settings = {
      logo: business.profileImages.logo || null,
      workplacePhotos: business.profileImages.workspacePhotos || [],
      galleryImages: business.profileImages.galleryImages || [],
    };

    return SuccessHandler(settings, 200, res);
  } catch (error) {
    console.error("Get business settings error:", error.message);
    return ErrorHandler(error.message, 500, req, res);
  }
};

/**
 * @desc Start a free trial for the business (only once, after setup)
 * @route POST /api/business/start-trial
 * @access Private
 */
const startFreeTrial = async (req, res) => {
  try {
    const business = await Business.findOne({ owner: req.user.id });
    if (!business) return ErrorHandler("Business not found", 404, req, res);
    if (business.trialUsed)
      return ErrorHandler("Trial already used", 400, req, res);
    // Check if business and at least one service are set up
    if (
      !business.name ||
      !business.services ||
      business.services.length === 0
    ) {
      return ErrorHandler(
        "Complete business and service setup first",
        400,
        req,
        res
      );
    }
    // Set trial period
    const now = new Date();
    business.trialStart = now;
    business.trialEnd = moment(now).add(14, "days").toDate();
    business.trialUsed = true;
    business.subscriptionStatus = "trialing";
    await business.save();
    return SuccessHandler(
      { message: "Trial started", trialEnd: business.trialEnd },
      200,
      res
    );
  } catch (err) {
    return ErrorHandler(err.message, 500, req, res);
  }
};

/**
 * @desc Get trial/subscription status for frontend messages
 * @route GET /api/business/subscription-status
 * @access Private
 */
const getSubscriptionStatus = async (req, res) => {
  try {
    const totalStart = Date.now();
    const { business, lookupMs: businessLookupMs } =
      await resolveBusinessForRequest(req);
    if (!business) return ErrorHandler("Business not found", 404, req, res);
    let status = business.subscriptionStatus;
    let daysLeft = null;
    let trialCalcMs = 0;
    let saveMs = 0;

    // Calculate days left for trialing status
    if (status === "trialing" && business.trialEnd) {
      const trialCalcStart = Date.now();
      daysLeft = Math.max(0, moment(business.trialEnd).diff(moment(), "days"));
      trialCalcMs = Date.now() - trialCalcStart;

      // If trial has ended, update status to incomplete_expired
      if (daysLeft === 0) {
        status = "incomplete_expired";
        business.subscriptionStatus = "incomplete_expired";
        const saveStart = Date.now();
        await business.save();
        saveMs = Date.now() - saveStart;
      }
    }

    let message = "";
    if (status === "trialing" && daysLeft > 0) {
      message = `Your trial ends in ${daysLeft} day${daysLeft === 1 ? "" : "s"
        }.`;
    } else if (
      status === "incomplete_expired" ||
      (status === "trialing" && daysLeft === 0)
    ) {
      message = "Your trial has ended. Please upgrade to continue.";
    } else if (status === "active") {
      message = "Your subscription is active.";
    } else {
      message = "Your trial has ended. Please upgrade to continue.";
    }
    setPerfHeader(res, {
      businessLookup: businessLookupMs,
      trialCalc: trialCalcMs,
      save: saveMs,
      total: Date.now() - totalStart,
    });
    return SuccessHandler({ status, daysLeft, message }, 200, res);
  } catch (err) {
    return ErrorHandler(err.message, 500, req, res);
  }
};

/**
 * @desc Helper function to update business subscription status
 * @param {Object} business - Business document
 * @param {Object} subscription - Stripe subscription object
 * @returns {Promise<void>}
 */
const updateBusinessSubscriptionStatus = async (business, subscription) => {
  try {
    console.log(
      `Updating business subscription status from '${business.subscriptionStatus}' to '${subscription.status}'`
    );

    // Update subscription details
    business.stripeSubscriptionId = subscription.id;
    business.subscriptionStatus = subscription.status;

    // Clear trial data if subscription is active (webhook behavior)
    if (subscription.status === "active") {
      business.trialEnd = null;
      business.trialStart = null;
    }

    await business.save();
    console.log(
      `Successfully updated business subscription status to '${subscription.status}'`
    );
  } catch (error) {
    console.error("Error updating business subscription status:", error);
    throw error;
  }
};

/**
 * @desc Create Stripe subscription for the business (with or without trial based on trial status)
 * @route POST /api/business/create-subscription
 * @access Private
 */
const createStripeSubscription = async (req, res) => {
  try {
    const { priceId } = req.body;

    // Validate input
    if (!priceId || typeof priceId !== "string") {
      return ErrorHandler("Valid price ID is required", 400, req, res);
    }

    // Find business and validate
    const business = await Business.findOne({ owner: req.user.id });
    if (!business) {
      return ErrorHandler("Business not found", 404, req, res);
    }

    if (!business.trialUsed) {
      return ErrorHandler("Start your free trial first", 400, req, res);
    }

    // Check if business already has an active subscription
    if (
      business.subscriptionStatus === "active" &&
      business.stripeSubscriptionId
    ) {
      return ErrorHandler(
        "Business already has an active subscription",
        400,
        req,
        res
      );
    }

    // Check if trial has ended
    // Handle both 'trialing' and 'incomplete_expired' statuses
    // Note: 'incomplete_expired' status is set by getSubscriptionStatus when trial ends
    let daysLeft = 0;
    if (
      (business.subscriptionStatus === "trialing" ||
        business.subscriptionStatus === "incomplete_expired") &&
      business.trialEnd
    ) {
      daysLeft = Math.max(0, moment(business.trialEnd).diff(moment(), "days"));
    }

    console.log(
      `Business subscription status: ${business.subscriptionStatus}, Trial days left: ${daysLeft}`
    );

    // Create Stripe customer if not exists
    let customerId = business.stripeCustomerId;
    if (!customerId) {
      try {
        const customer = await stripe.customers.create({
          email: req.user.email,
          metadata: { businessId: business._id.toString() },
        });
        customerId = customer.id;
        business.stripeCustomerId = customerId;
        await business.save();
      } catch (stripeError) {
        console.error("Error creating Stripe customer:", stripeError);
        return ErrorHandler("Failed to create customer account", 500, req, res);
      }
    }

    // If trial has ended, create a Stripe Checkout Session for payment
    if (daysLeft === 0) {
      try {
        const session = await stripe.checkout.sessions.create({
          customer: customerId,
          payment_method_types: ["card"],
          line_items: [
            {
              price: priceId,
              quantity: 1,
            },
          ],
          mode: "subscription",
          success_url: `${process.env.FRONTEND_URL}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
          cancel_url: `${process.env.FRONTEND_URL}/payment/failure`,
          metadata: { businessId: business._id.toString() },
        });

        // business.subscriptionStatus = "active";
        // await business.save();

        return SuccessHandler(
          {
            requiresPayment: true,
            checkoutUrl: session.url,
            sessionId: session.id,
          },
          200,
          res
        );
      } catch (stripeError) {
        console.error("Error creating Stripe checkout session:", stripeError);
        return ErrorHandler("Failed to create payment session", 500, req, res);
      }
    }

    // If trial is still active, create subscription with remaining trial days
    const subscriptionParams = {
      customer: customerId,
      items: [{ price: priceId }],
      trial_period_days: daysLeft,
      metadata: { businessId: business._id.toString() },
    };

    try {
      const subscription = await stripe.subscriptions.create(
        subscriptionParams
      );

      // Update business with subscription details using helper function
      await updateBusinessSubscriptionStatus(business, subscription);

      // Send notification to admins
      await sendNotificationToAdmins(
        "New Subscription Created",
        `Business "${business.name || business.businessName
        }" has created a new subscription (ID: ${subscription.id
        }) with status: ${subscription.status}`,
        "admin",
        {
          businessId: business._id,
          businessName: business.name || business.businessName,
          subscriptionId: subscription.id,
          subscriptionStatus: subscription.status,
          ownerId: business.owner,
        }
      );

      return SuccessHandler(
        { subscriptionId: subscription.id, status: subscription.status },
        200,
        res
      );
    } catch (stripeError) {
      console.error("Error creating Stripe subscription:", stripeError);
      return ErrorHandler("Failed to create subscription", 500, req, res);
    }
  } catch (err) {
    console.error("Create Stripe subscription error:", err);
    return ErrorHandler(err.message, 500, req, res);
  }
};

/**
 * @desc Stripe webhook handler (to be used in a separate route, not directly exposed)
 */
const handleStripeWebhook = async (req, res) => {
  const sig = req.headers["stripe-signature"];
  let event;
  try {
    event = stripe.webhooks.constructEvent(
      req.rawBody,
      sig,
      process.env.WEBHOOK_SECRET_TWO
    );
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    // Handle checkout session completed (when user completes payment)
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      console.log(
        `Processing checkout.session.completed event for session: ${session.id}`
      );

      // Handle subscription payments (when trial has ended and user pays)
      if (
        session.metadata &&
        session.metadata.businessId &&
        session.mode === "subscription"
      ) {
        const businessId = session.metadata.businessId;
        const business = await Business.findById(businessId);
        if (!business) {
          console.log(`Business not found for ID: ${businessId}`);
          return res.status(200).send("Business not found, skipping");
        }

        // Get the subscription from the session
        const subscription = await stripe.subscriptions.retrieve(
          session.subscription
        );

        console.log(
          `Retrieved subscription: ${subscription.id}, status: ${subscription.status}`
        );

        // Update business with subscription details using helper function
        await updateBusinessSubscriptionStatus(business, subscription);

        // Send notification to admins
        await sendNotificationToAdmins(
          "Subscription Activated",
          `Business "${business.name || business.businessName
          }" subscription has been activated (ID: ${subscription.id})`,
          "admin",
          {
            businessId: business._id,
            businessName: business.name || business.businessName,
            subscriptionId: subscription.id,
            subscriptionStatus: subscription.status,
            ownerId: business.owner,
          }
        );

        return res.status(200).send("Subscription activated");
      }
    }

    // Handle subscription lifecycle events
    if (
      event.type === "customer.subscription.updated" ||
      event.type === "customer.subscription.created"
    ) {
      const subscription = event.data.object;
      const businessId = subscription.metadata.businessId;
      if (businessId) {
        const business = await Business.findById(businessId);
        if (business) {
          console.log(
            `Processing subscription event: ${event.type}, status: ${subscription.status}, current business status: ${business.subscriptionStatus}`
          );

          // Only update if the subscription status is more advanced than current status
          // This prevents downgrading from 'trialing' to 'incomplete_expired' etc.
          const statusPriority = {
            none: 0,
            incomplete: 1,
            incomplete_expired: 2,
            trialing: 3,
            active: 4,
            past_due: 5,
            canceled: 6,
            unpaid: 7,
            paused: 8,
          };

          const currentPriority =
            statusPriority[business.subscriptionStatus] || 0;
          const newPriority = statusPriority[subscription.status] || 0;

          if (newPriority >= currentPriority) {
            await updateBusinessSubscriptionStatus(business, subscription);
          } else {
            console.log(
              `Skipping status update: ${subscription.status} is lower priority than ${business.subscriptionStatus}`
            );
          }
        }
      }
      return res.status(200).send("Subscription updated");
    }

    if (event.type === "customer.subscription.deleted") {
      const subscription = event.data.object;
      const businessId = subscription.metadata.businessId;
      if (businessId) {
        const business = await Business.findById(businessId);
        if (business) {
          business.subscriptionStatus = "canceled";
          await business.save();
        }
      }
      return res.status(200).send("Subscription canceled");
    }

    return res.status(200).send("Unhandled event");
  } catch (error) {
    console.error("Webhook error:", error);
    return res.status(500).send("Webhook processing error");
  }
};

/**
 * @desc Test webhook endpoint for debugging
 * @route POST /api/business/test-webhook
 * @access Private
 */
// const testWebhook = async (req, res) => {
//   try {
//     const business = await Business.findOne({ owner: req.user.id });
//     if (!business) {
//       return ErrorHandler("Business not found", 404, req, res);
//     }

//     console.log("Current business status:", {
//       subscriptionStatus: business.subscriptionStatus,
//       stripeSubscriptionId: business.stripeSubscriptionId,
//       trialUsed: business.trialUsed,
//     });

//     return SuccessHandler(
//       {
//         message: "Webhook test successful",
//         business: {
//           subscriptionStatus: business.subscriptionStatus,
//           stripeSubscriptionId: business.stripeSubscriptionId,
//           trialUsed: business.trialUsed,
//         },
//       },
//       200,
//       res
//     );
//   } catch (error) {
//     console.error("Test webhook error:", error);
//     return ErrorHandler(error.message, 500, req, res);
//   }
// };

/**
 * @desc Create email campaign
 * @route POST /api/business/email-campaigns
 * @access Private
 */
const createEmailCampaign = async (req, res) => {
  // #swagger.tags = ['Business']
  /* #swagger.description = 'Create a new email campaign with image upload, content, and delivery options'
     #swagger.security = [{ "Bearer": [] }]
     #swagger.consumes = ['multipart/form-data']
     #swagger.parameters['content'] = { in: 'formData', description: 'Email content (HTML supported)', type: 'string', required: true }
     #swagger.parameters['image'] = { in: 'formData', description: 'Campaign image', type: 'file' }
     #swagger.parameters['deliveryType'] = { in: 'formData', description: 'send_now, send_later, or recurring', type: 'string', required: true }
     #swagger.parameters['scheduledDate'] = { in: 'formData', description: 'Scheduled date (for send_later)', type: 'string' }
     #swagger.parameters['recurringInterval'] = { in: 'formData', description: 'Days after last visit (for recurring)', type: 'number' }
     #swagger.responses[201] = { description: 'Email campaign created successfully' }
     #swagger.responses[400] = { description: 'Validation error' }
     #swagger.responses[404] = { description: 'Business not found' }
  */
  try {
    const business = await Business.findOne({ owner: req.user.id });
    if (!business) {
      return ErrorHandler("Business not found", 404, req, res);
    }

    const { content, deliveryType, scheduledDate, recurringInterval } =
      req.body;

    // Validate required fields
    if (!content || !deliveryType) {
      return ErrorHandler(
        "Content and delivery type are required",
        400,
        req,
        res
      );
    }

    if (!["send_now", "send_later", "recurring"].includes(deliveryType)) {
      return ErrorHandler("Invalid delivery type", 400, req, res);
    }

    if (deliveryType === "send_later" && !scheduledDate) {
      return ErrorHandler(
        "Scheduled date is required for send_later campaigns",
        400,
        req,
        res
      );
    }

    if (deliveryType === "recurring") {
      if (!recurringInterval || recurringInterval < 1) {
        return ErrorHandler(
          "Valid recurring interval is required for recurring campaigns",
          400,
          req,
          res
        );
      }
    }

    // Handle image upload
    let imageUrl = null;
    if (req.files && req.files.image && req.files.image[0]) {
      const imageFile = req.files.image[0];
      const result = await uploadToCloudinary(
        imageFile.buffer,
        "email-campaigns"
      );
      imageUrl = result.secure_url;
    }

    // Fetch all active clients for this business
    let clientEmails = [];
    if (deliveryType === "send_now") {
      const clients = await Client.find(
        { business: business._id, isActive: true, status: "activated" },
        "email"
      );
      clientEmails = clients.map((c) => c.email).filter(Boolean);
      if (clientEmails.length === 0) {
        return ErrorHandler(
          "No active clients with email addresses found.",
          400,
          req,
          res
        );
      }
    }

    // Create campaign
    const campaignData = {
      business: business._id,
      content,
      imageUrl,
      deliveryType,
      createdBy: req.user.id,
    };
    if (deliveryType === "send_later") {
      campaignData.scheduledDate = new Date(scheduledDate);
      campaignData.status = "scheduled";
    } else if (deliveryType === "recurring") {
      campaignData.recurringInterval = parseInt(recurringInterval);
      campaignData.status = "scheduled";
    } else {
      campaignData.status = "draft";
    }

    const campaign = await EmailCampaign.create(campaignData);

    // If it's a send_now campaign, send immediately to all client emails
    if (deliveryType === "send_now") {
      // Prepare recipients for bulk email sending
      const recipients = clientEmails.map((email) => ({ email }));
      const emailContent = imageUrl
        ? `<img src="${imageUrl}" style="max-width: 100%; height: auto; margin-bottom: 20px;"><br>${content}`
        : content;

      // Send bulk emails with credit validation
      const results = await sendBulkEmailWithCredits(
        recipients,
        "Email from " + business.name,
        emailContent,
        business._id,
        req,
        res
      );

      // Check if credit validation failed
      if (results && results.error) {
        return ErrorHandler(
          results.message,
          402, // Payment Required
          req,
          res
        );
      }

      campaign.status = results.successCount > 0 ? "sent" : "failed";
      campaign.sentAt = new Date();
      campaign.sentTo = clientEmails.join(",");
      campaign.metadata.totalSent = results.successCount;
      campaign.metadata.totalFailed = results.failedCount;
      campaign.metadata.creditsUsed = results.creditsUsed;
      if (results.failedRecipients.length > 0) {
        campaign.errorMessage = JSON.stringify(results.failedRecipients);
      }
      await campaign.save();

      if (results.successCount === 0) {
        return ErrorHandler(
          `Campaign created but all emails failed to send.`,
          500,
          req,
          res
        );
      }
    }

    return SuccessHandler(
      {
        message: "Email campaign created successfully",
        campaign,
      },
      201,
      res
    );
  } catch (error) {
    console.error("Create email campaign error:", error);
    return ErrorHandler(error.message, 500, req, res);
  }
};

/**
 * @desc Get all email campaigns for business
 * @route GET /api/business/email-campaigns
 * @access Private
 */
const getEmailCampaigns = async (req, res) => {
  // #swagger.tags = ['Business']
  /* #swagger.description = 'Get all email campaigns for the business'
     #swagger.security = [{ "Bearer": [] }]
     #swagger.responses[200] = { description: 'Email campaigns retrieved successfully' }
     #swagger.responses[404] = { description: 'Business not found' }
  */
  try {
    const business = await Business.findOne({ owner: req.user.id });
    if (!business) {
      return ErrorHandler("Business not found", 404, req, res);
    }

    const campaigns = await EmailCampaign.find({ business: business._id }).sort(
      { createdAt: -1 }
    );

    return SuccessHandler(campaigns, 200, res);
  } catch (error) {
    console.error("Get email campaigns error:", error);
    return ErrorHandler(error.message, 500, req, res);
  }
};

/**
 * @desc Update email campaign
 * @route PUT /api/business/email-campaigns/:campaignId
 * @access Private
 */
const updateEmailCampaign = async (req, res) => {
  // #swagger.tags = ['Business']
  /* #swagger.description = 'Update email campaign details'
     #swagger.security = [{ "Bearer": [] }]
     #swagger.consumes = ['multipart/form-data']
     #swagger.parameters['campaignId'] = { in: 'path', description: 'Campaign ID', type: 'string', required: true }
     #swagger.parameters['content'] = { in: 'formData', description: 'Email content', type: 'string' }
     #swagger.parameters['image'] = { in: 'formData', description: 'Campaign image', type: 'file' }
     #swagger.responses[200] = { description: 'Email campaign updated successfully' }
     #swagger.responses[404] = { description: 'Campaign not found' }
  */
  try {
    const business = await Business.findOne({ owner: req.user.id });
    if (!business) {
      return ErrorHandler("Business not found", 404, req, res);
    }

    const campaign = await EmailCampaign.findOne({
      _id: req.params.campaignId,
      business: business._id,
    });

    if (!campaign) {
      return ErrorHandler("Email campaign not found", 404, req, res);
    }

    // Only allow updates for draft or failed campaigns
    if (!["draft", "failed"].includes(campaign.status)) {
      return ErrorHandler(
        "Cannot update campaigns that are already sent or scheduled",
        400,
        req,
        res
      );
    }

    const { content } = req.body;

    // Update fields
    if (content) campaign.content = content;

    // Handle image upload if provided
    if (req.files && req.files.image && req.files.image[0]) {
      const imageFile = req.files.image[0];

      // Delete old image if exists
      if (campaign.imageUrl) {
        try {
          await deleteImage(campaign.imageUrl);
        } catch (deleteError) {
          console.error("Failed to delete old image:", deleteError);
          // Continue with upload even if deletion fails
        }
      }

      const result = await uploadToCloudinary(
        imageFile.buffer,
        "email-campaigns"
      );
      campaign.imageUrl = result.secure_url;
    }

    const updatedCampaign = await campaign.save();

    return SuccessHandler(
      {
        message: "Email campaign updated successfully",
        campaign: updatedCampaign,
      },
      200,
      res
    );
  } catch (error) {
    console.error("Update email campaign error:", error);
    return ErrorHandler(error.message, 500, req, res);
  }
};

/**
 * @desc Delete email campaign
 * @route DELETE /api/business/email-campaigns/:campaignId
 * @access Private
 */
const deleteEmailCampaign = async (req, res) => {
  // #swagger.tags = ['Business']
  /* #swagger.description = 'Delete email campaign'
     #swagger.security = [{ "Bearer": [] }]
     #swagger.parameters['campaignId'] = { in: 'path', description: 'Campaign ID', type: 'string', required: true }
     #swagger.responses[200] = { description: 'Email campaign deleted successfully' }
     #swagger.responses[404] = { description: 'Campaign not found' }
  */
  try {
    const business = await Business.findOne({ owner: req.user.id });
    if (!business) {
      return ErrorHandler("Business not found", 404, req, res);
    }

    const campaign = await EmailCampaign.findOne({
      _id: req.params.campaignId,
      business: business._id,
    });

    if (!campaign) {
      return ErrorHandler("Email campaign not found", 404, req, res);
    }

    // Delete campaign image from Cloudinary if exists
    if (campaign.imageUrl) {
      try {
        await deleteImage(campaign.imageUrl);
      } catch (deleteError) {
        console.error("Failed to delete image from Cloudinary:", deleteError);
        // Continue with campaign deletion even if image deletion fails
      }
    }

    await EmailCampaign.findByIdAndDelete(req.params.campaignId);

    return SuccessHandler(
      {
        message: "Email campaign deleted successfully",
      },
      200,
      res
    );
  } catch (error) {
    console.error("Delete email campaign error:", error);
    return ErrorHandler(error.message, 500, req, res);
  }
};

/**
 * @desc Send scheduled email campaign immediately
 * @route POST /api/business/email-campaigns/:campaignId/send
 * @access Private
 */
const sendEmailCampaign = async (req, res) => {
  // #swagger.tags = ['Business']
  /* #swagger.description = 'Send a scheduled email campaign immediately'
     #swagger.security = [{ "Bearer": [] }]
     #swagger.parameters['campaignId'] = { in: 'path', description: 'Campaign ID', type: 'string', required: true }
     #swagger.responses[200] = { description: 'Email campaign sent successfully' }
     #swagger.responses[404] = { description: 'Campaign not found' }
  */
  try {
    const business = await Business.findOne({ owner: req.user.id });
    if (!business) {
      return ErrorHandler("Business not found", 404, req, res);
    }

    const campaign = await EmailCampaign.findOne({
      _id: req.params.campaignId,
      business: business._id,
    });

    if (!campaign) {
      return ErrorHandler("Email campaign not found", 404, req, res);
    }

    if (campaign.status === "sent") {
      return ErrorHandler("Campaign has already been sent", 400, req, res);
    }

    if (!campaign.targetEmail) {
      return ErrorHandler("No target email found for campaign", 400, req, res);
    }

    // Fetch all active clients for this business
    const clients = await Client.find(
      { business: business._id, isActive: true, status: "activated" },
      "email"
    );
    const clientEmails = clients.map((c) => c.email).filter(Boolean);

    if (clientEmails.length === 0) {
      return ErrorHandler(
        "No active clients with email addresses found.",
        400,
        req,
        res
      );
    }

    // Send email with credit validation
    try {
      const emailContent = campaign.imageUrl
        ? `<img src="${campaign.imageUrl}" style="max-width: 100%; height: auto; margin-bottom: 20px;"><br>${campaign.content}`
        : campaign.content;

      // Prepare recipients for bulk email sending
      const recipients = clientEmails.map((email) => ({ email }));

      // Send bulk emails with credit validation
      const results = await sendBulkEmailWithCredits(
        recipients,
        "Email from " + business.name,
        emailContent,
        business._id,
        req,
        res
      );

      // Check if credit validation failed
      if (results && results.error) {
        return ErrorHandler(
          results.message,
          402, // Payment Required
          req,
          res
        );
      }

      campaign.status = results.successCount > 0 ? "sent" : "failed";
      campaign.sentAt = new Date();
      campaign.sentTo = clientEmails.join(",");
      campaign.metadata.totalSent = results.successCount;
      campaign.metadata.totalFailed = results.failedCount;
      campaign.metadata.creditsUsed = results.creditsUsed;
      if (results.failedRecipients.length > 0) {
        campaign.errorMessage = JSON.stringify(results.failedRecipients);
      }
      await campaign.save();

      if (results.successCount === 0) {
        return ErrorHandler(
          `Campaign created but all emails failed to send.`,
          500,
          req,
          res
        );
      }

      return SuccessHandler(
        {
          message: "Email campaign sent successfully",
          campaign,
        },
        200,
        res
      );
    } catch (emailError) {
      campaign.status = "failed";
      campaign.errorMessage = emailError.message;
      await campaign.save();

      return ErrorHandler(
        `Failed to send email: ${emailError.message}`,
        500,
        req,
        res
      );
    }
  } catch (error) {
    console.error("Send email campaign error:", error);
    return ErrorHandler(error.message, 500, req, res);
  }
};

/**
 * @desc Manually trigger email campaign processing
 * @route POST /api/business/email-campaigns/process
 * @access Private
 */
const triggerEmailCampaignProcessing = async (req, res) => {
  // #swagger.tags = ['Business']
  /* #swagger.description = 'Manually trigger email campaign processing'
     #swagger.security = [{ "Bearer": [] }]
     #swagger.responses[200] = { description: 'Email campaign processing triggered successfully' }
     #swagger.responses[404] = { description: 'Business not found' }
  */
  try {
    const business = await Business.findOne({ owner: req.user.id });
    if (!business) {
      return ErrorHandler("Business not found", 404, req, res);
    }

    const { emailCampaignScheduler } = require("../utils/scheduler");
    const result =
      await emailCampaignScheduler.triggerEmailCampaignProcessing();

    if (result.success) {
      return SuccessHandler(
        {
          message: result.message,
        },
        200,
        res
      );
    } else {
      return ErrorHandler(result.error, 500, req, res);
    }
  } catch (error) {
    console.error("Trigger email campaign processing error:", error);
    return ErrorHandler(error.message, 500, req, res);
  }
};

/**
 * @desc Get email campaign scheduler status
 * @route GET /api/business/email-campaigns/scheduler-status
 * @access Private
 */
const getEmailCampaignSchedulerStatus = async (req, res) => {
  // #swagger.tags = ['Business']
  /* #swagger.description = 'Get email campaign scheduler status'
     #swagger.security = [{ "Bearer": [] }]
     #swagger.responses[200] = { description: 'Scheduler status retrieved successfully' }
     #swagger.responses[404] = { description: 'Business not found' }
  */
  try {
    const business = await Business.findOne({ owner: req.user.id });
    if (!business) {
      return ErrorHandler("Business not found", 404, req, res);
    }

    const { emailCampaignScheduler } = require("../utils/scheduler");
    const status = emailCampaignScheduler.getStatus();

    return SuccessHandler(
      {
        scheduler: status,
        isInitialized: emailCampaignScheduler.isInitialized,
      },
      200,
      res
    );
  } catch (error) {
    console.error("Get scheduler status error:", error);
    return ErrorHandler(error.message, 500, req, res);
  }
};

/**
 * @desc Create SMS campaign
 * @route POST /api/business/sms-campaigns
 * @access Private
 */
const createSmsCampaign = async (req, res) => {
  // #swagger.tags = ['Business']
  /* #swagger.description = 'Create a new SMS campaign with content and delivery options.'
     #swagger.security = [{ "Bearer": [] }]
     #swagger.parameters['content'] = { in: 'formData', description: 'SMS content', type: 'string', required: true }
     #swagger.parameters['deliveryType'] = { in: 'formData', description: 'send_now, send_later, or recurring', type: 'string', required: true }
     #swagger.parameters['scheduledDate'] = { in: 'formData', description: 'Scheduled date (for send_later)', type: 'string' }
     #swagger.parameters['scheduledTime'] = { in: 'formData', description: 'Scheduled time (for send_later)', type: 'string' }
     #swagger.parameters['recurringInterval'] = { in: 'formData', description: 'Days after last visit (for recurring)', type: 'number' }
     #swagger.responses[201] = { description: 'SMS campaign created successfully' }
     #swagger.responses[400] = { description: 'Validation error' }
     #swagger.responses[404] = { description: 'Business not found' }
  */
  try {
    const business = await Business.findOne({ owner: req.user.id });
    if (!business) {
      return ErrorHandler("Business not found", 404, req, res);
    }

    const {
      content,
      deliveryType,
      clientIds, // Optional: array of specific client IDs to send to
      scheduledDate,
      scheduledTime,
      recurringInterval,
    } = req.body;

    // Validate required fields
    if (!content || !deliveryType) {
      return ErrorHandler(
        "Content and delivery type are required",
        400,
        req,
        res
      );
    }

    if (!["send_now", "send_later", "recurring"].includes(deliveryType)) {
      return ErrorHandler("Invalid delivery type", 400, req, res);
    }

    if (deliveryType === "send_later" && (!scheduledDate || !scheduledTime)) {
      return ErrorHandler(
        "Scheduled date and time are required for send_later campaigns",
        400,
        req,
        res
      );
    }

    if (deliveryType === "recurring") {
      if (!recurringInterval || recurringInterval < 1) {
        return ErrorHandler(
          "Valid recurring interval is required for recurring campaigns",
          400,
          req,
          res
        );
      }
    }

    // Combine date and time for scheduled send
    let scheduledDateTime = null;
    if (deliveryType === "send_later") {
      scheduledDateTime = new Date(`${scheduledDate}T${scheduledTime}`);
      if (isNaN(scheduledDateTime.getTime())) {
        return ErrorHandler("Invalid scheduled date or time", 400, req, res);
      }
    }

    // Fetch clients for this business based on clientIds or all active clients
    let clientPhones = [];
    if (deliveryType === "send_now") {
      let clients = [];

      // If clientIds are provided, use those specific clients
      if (clientIds && Array.isArray(clientIds) && clientIds.length > 0) {
        clients = await Client.find({
          _id: { $in: clientIds },
          business: business._id,
          phone: { $exists: true, $ne: null, $ne: "" },
        }).select("phone");
      } else {
        // Otherwise, fetch all active clients (backward compatibility)
        clients = await Client.find(
          { business: business._id, isActive: true, status: "activated" },
          "phone"
        );
      }

      clientPhones = clients.map((c) => c.phone).filter(Boolean);
      if (clientPhones.length === 0) {
        return ErrorHandler(
          clientIds && clientIds.length > 0
            ? "No clients found with the provided client IDs that have phone numbers."
            : "No active clients with phone numbers found.",
          400,
          req,
          res
        );
      }
    }

    // Create campaign
    const campaignData = {
      business: business._id,
      content,
      deliveryType,
      createdBy: req.user.id,
    };
    if (deliveryType === "send_later") {
      campaignData.scheduledDate = scheduledDateTime;
      campaignData.status = "scheduled";
    } else if (deliveryType === "recurring") {
      campaignData.recurringInterval = parseInt(recurringInterval);
      campaignData.status = "scheduled";
    } else {
      campaignData.status = "draft";
    }

    const campaign = await SmsCampaign.create(campaignData);

    // If it's a send_now campaign, send immediately to all client phones
    if (deliveryType === "send_now") {
      // Prepare recipients for bulk SMS sending
      const recipients = clientPhones.map((phone) => ({ phone }));

      // Send bulk SMS with credit validation
      const results = await sendBulkSMSWithCredits(
        recipients,
        content,
        business._id,
        req,
        res
      );

      // Check if credit validation failed
      if (results && results.error) {
        return ErrorHandler(
          results.message,
          402, // Payment Required
          req,
          res
        );
      }

      campaign.status = results.successCount > 0 ? "sent" : "failed";
      campaign.sentAt = new Date();
      campaign.sentTo = clientPhones.join(",");
      campaign.metadata.totalSent = results.successCount;
      campaign.metadata.totalFailed = results.failedCount;
      campaign.metadata.creditsUsed = results.creditsUsed;
      if (results.failedRecipients.length > 0) {
        campaign.errorMessage = JSON.stringify(results.failedRecipients);
      }
      await campaign.save();

      if (results.successCount === 0) {
        return ErrorHandler(
          `Campaign created but all SMS failed to send.`,
          500,
          req,
          res
        );
      }
    }

    return SuccessHandler(
      {
        message: "SMS campaign created successfully",
        campaign,
      },
      201,
      res
    );
  } catch (error) {
    console.error("Create SMS campaign error:", error);
    return ErrorHandler(error.message, 500, req, res);
  }
};

/**
 * @desc Check credits for campaign operations
 * @route POST /api/business/check-campaign-credits
 * @access Private
 */
const checkCampaignCredits = async (req, res) => {
  // #swagger.tags = ['Business']
  /* #swagger.description = 'Check if business has sufficient credits for SMS and Email campaigns'
     #swagger.security = [{ "Bearer": [] }]
     #swagger.parameters['obj'] = {
        in: 'body',
        description: 'Campaign credit check parameters',
        required: true,
        schema: {
          smsRecipients: 10,
          emailRecipients: 5
        }
     }
     #swagger.responses[200] = {
        description: 'Credit check completed successfully',
        schema: {
          sms: {
            hasCredits: true,
            currentCredits: 50,
            requiredCredits: 10
          },
          email: {
            hasCredits: true,
            currentCredits: 25,
            requiredCredits: 5
          },
          allSufficient: true
        }
     }
     #swagger.responses[404] = {
        description: 'Business not found'
     }
  */
  try {
    const business = await Business.findOne({ owner: req.user.id });
    if (!business) {
      return ErrorHandler("Business not found", 404, req, res);
    }

    const { smsRecipients = 0, emailRecipients = 0 } = req.body;

    // Check credits for both SMS and Email
    const creditCheck = await checkBulkCredits(
      business._id,
      smsRecipients,
      emailRecipients
    );

    return SuccessHandler(creditCheck, 200, res);
  } catch (error) {
    console.error("Check campaign credits error:", error);
    return ErrorHandler(error.message, 500, req, res);
  }
};

/**
 * @desc Get barber profile by link token (public access)
 * @route GET /api/barber/profile/:linkToken
 * @access Public
 */
const getBarberProfileByLink = async (req, res) => {
  // #swagger.tags = ['Barber Profile']
  /* #swagger.description = 'Get comprehensive barber profile information using link token (public access)'
     #swagger.parameters['linkToken'] = {
        in: 'path',
        description: 'Barber link token',
        required: true,
        type: 'string'
     }
     #swagger.responses[200] = {
        description: 'Barber profile retrieved successfully',
        schema: {
          barber: {
            _id: 'barber_id',
            name: 'John Doe',
            email: 'john@example.com',
            phone: '+1234567890',
            profileImage: 'https://example.com/profile.jpg'
          },
          business: {
            _id: 'business_id',
            name: 'Barber Shop',
            personalName: 'John',
            surname: 'Doe',
            contactInfo: { email: 'john@example.com', phone: '+1234567890' },
            address: { streetName: 'Main St', city: 'New York' },
            businessHours: { monday: { enabled: true, shifts: [] } },
            services: [{ name: 'Haircut', price: 25 }],
            profileImages: { logo: 'https://example.com/logo.jpg' },
            socialMedia: { facebook: 'fb.com/barbershop' }
          },
          services: [{ name: 'Haircut', price: 25 }],
          staff: [{ name: 'Jane Smith', services: ['Haircut'] }],
          stats: {
            totalAppointments: 150,
            completedAppointments: 120,
            totalRevenue: 3000,
            averageRating: 4.5
          }
        }
     }
     #swagger.responses[404] = {
        description: 'Invalid or expired barber link'
     }
  */
  try {
    const { linkToken } = req.params;

    // Find barber link
    const barberLink = await BarberLink.findOne({
      linkToken: linkToken,
      isActive: true,
    });

    if (!barberLink) {
      return ErrorHandler("Invalid or expired barber link", 404, req, res);
    }

    // Check if link has expired
    // if (barberLink.expiresAt && barberLink.expiresAt < new Date()) {
    //   return ErrorHandler("Barber link has expired", 404, req, res);
    // }

    // Update access count
    barberLink.accessCount += 1;
    await barberLink.save();

    // Get business with owner details
    const business = await Business.findById(barberLink.business).populate(
      "owner",
      "name email phone profileImage"
    );

    if (!business) {
      return ErrorHandler("Business not found", 404, req, res);
    }

    // Get services (both from business.services and separate Service model)
    const businessServices = business.services || [];
    const separateServices = await Service.find({
      business: business._id,
      isActive: true,
    });
    const allServices = [...businessServices, ...separateServices];

    // Get staff members
    const staff = await Staff.find({
      business: business._id,
      isActive: true,
    }).populate("services", "name");

    // Get appointment statistics
    const appointmentStats = await Appointment.aggregate([
      { $match: { business: business._id } },
      {
        $group: {
          _id: null,
          totalAppointments: { $sum: 1 },
          completedAppointments: {
            $sum: { $cond: [{ $eq: ["$status", "Completed"] }, 1, 0] },
          },
          totalRevenue: {
            $sum: { $cond: [{ $eq: ["$status", "Completed"] }, "$price", 0] },
          },
        },
      },
    ]);

    const stats = appointmentStats[0] || {
      totalAppointments: 0,
      completedAppointments: 0,
      totalRevenue: 0,
    };

    // Calculate average rating (if you have a rating system)
    const averageRating = 4.5; // Placeholder - implement rating system if needed

    // Prepare comprehensive barber profile data
    const barberProfile = {
      barber: {
        _id: business.owner._id,
        name: business.owner.name,
        email: business.owner.email,
        phone: business.owner.phone,
        profileImage: business.owner.profileImage,
      },
      business: {
        _id: business._id,
        name: business.name,
        personalName: business.personalName,
        surname: business.surname,
        contactInfo: business.contactInfo,
        address: business.address,
        location: business.location,
        businessHours: business.businessHours,
        timeFormatPreference: business.timeFormatPreference || "12h",
        profileImages: business.profileImages,
        socialMedia: business.socialMedia,
        penaltySettings: business.penaltySettings,
        subscriptionStatus: business.subscriptionStatus,
        trialStart: business.trialStart,
        trialEnd: business.trialEnd,
        createdAt: business.createdAt,
      },
      services: allServices,
      staff: staff,
      stats: {
        ...stats,
        averageRating: averageRating,
      },
      linkInfo: {
        accessCount: barberLink.accessCount,
        lastAccessedAt: barberLink.lastAccessedAt,
        createdAt: barberLink.createdAt,
      },
    };

    return SuccessHandler(barberProfile, 200, res);
  } catch (error) {
    console.error("Get barber profile by link error:", error);
    return ErrorHandler(error.message, 500, req, res);
  }
};

/**
 * @desc Get barber link for current business
 * @route GET /api/business/barber-link
 * @access Private
 */
const getBarberLink = async (req, res) => {
  // #swagger.tags = ['Barber Profile']
  /* #swagger.description = 'Get the barber link for the current business'
     #swagger.security = [{ "Bearer": [] }]
     #swagger.responses[200] = {
        description: 'Barber link retrieved successfully',
        schema: {
          barberLink: 'https://example.com/barber/profile/abc123',
          linkToken: 'abc123',
          accessCount: 25,
          lastAccessedAt: '2024-01-15T10:30:00Z',
          createdAt: '2024-01-01T00:00:00Z'
        }
     }
     #swagger.responses[404] = {
        description: 'Barber link not found'
     }
  */
  try {
    const business = await Business.findOne({ owner: req.user.id });
    if (!business) {
      return ErrorHandler("Business not found", 404, req, res);
    }

    const barberLink = await BarberLink.findOne({
      business: business._id,
      isActive: true,
    });

    if (!barberLink) {
      return ErrorHandler("Barber link not found", 404, req, res);
    }

    const baseUrl = process.env.FRONTEND_URL || "http://localhost:5173";
    const barberLinkUrl = `${baseUrl}/barber/profile/${barberLink.linkToken}`;

    return SuccessHandler(
      {
        barberLink: barberLinkUrl,
        linkToken: barberLink.linkToken,
        accessCount: barberLink.accessCount,
        lastAccessedAt: barberLink.lastAccessedAt,
        createdAt: barberLink.createdAt,
        // expiresAt: barberLink.expiresAt,
      },
      200,
      res
    );
  } catch (error) {
    console.error("Get barber link error:", error);
    return ErrorHandler(error.message, 500, req, res);
  }
};

/**
 * @desc Regenerate barber link for current business
 * @route POST /api/business/barber-link/regenerate
 * @access Private
 */
const regenerateBarberLink = async (req, res) => {
  // #swagger.tags = ['Barber Profile']
  /* #swagger.description = 'Regenerate barber link for the current business'
     #swagger.security = [{ "Bearer": [] }]
     #swagger.responses[200] = {
        description: 'Barber link regenerated successfully',
        schema: {
          message: 'Barber link regenerated successfully',
          barberLink: 'https://example.com/barber/profile/xyz789',
          linkToken: 'xyz789'
        }
     }
     #swagger.responses[404] = {
        description: 'Business not found'
     }
  */
  try {
    const business = await Business.findOne({ owner: req.user.id });
    if (!business) {
      return ErrorHandler("Business not found", 404, req, res);
    }

    // Generate new link token
    const { generateInvitationToken } = require("../utils/index");
    const newLinkToken = generateInvitationToken();

    // Deactivate old link if exists
    await BarberLink.updateOne({ business: business._id }, { isActive: false });

    // Create new barber link
    const newBarberLink = await BarberLink.create({
      business: business._id,
      linkToken: newLinkToken,
      createdBy: req.user.id,
      isActive: true,
    });

    const baseUrl = process.env.FRONTEND_URL || "http://localhost:5173";
    const barberLinkUrl = `${baseUrl}/barber/profile/${newLinkToken}`;

    return SuccessHandler(
      {
        message: "Barber link regenerated successfully",
        barberLink: barberLinkUrl,
        linkToken: newLinkToken,
      },
      200,
      res
    );
  } catch (error) {
    console.error("Regenerate barber link error:", error);
    return ErrorHandler(error.message, 500, req, res);
  }
};

/**
 * @desc Check if client exists by email for a business
 * @route POST /api/business/client-check
 * @access Public
 */
const checkClientExists = async (req, res) => {
  // #swagger.tags = ['Client Profiles']
  /* #swagger.description = 'Check if a client with the given email exists for the specified business. Returns client data if found.'
     #swagger.parameters['obj'] = {
        in: 'body',
        description: 'Client email and business ID',
        required: true,
        schema: {
          email: 'john.doe@example.com',
          businessId: 'business_id'
        }
     }
     #swagger.responses[200] = {
        description: 'Client found',
        schema: {
          success: true,
          data: {
            exists: true,
            client: {
              _id: 'client_id',
              firstName: 'John',
              lastName: 'Doe',
              email: 'john.doe@example.com',
              phone: '+1234567890'
            },
            token: 'jwt_token',
            clientId: 'client_id'
          }
        }
     }
     #swagger.responses[404] = {
        description: 'Client not found',
        schema: {
          success: true,
          data: {
            exists: false,
            message: 'No client found with this email'
          }
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

    // Check if business exists
    const business = await Business.findById(businessId);
    if (!business) {
      return ErrorHandler("Business not found", 404, req, res);
    }

    // Check if client with this email exists for this business
    const existingClient = await Client.findOne({
      business: businessId,
      email: email.toLowerCase(),
    });

    if (existingClient) {
      // Generate JWT token for existing client
      const jwtToken = existingClient.getJWTToken();

      return SuccessHandler(
        {
          exists: true,
          client: existingClient,
          token: jwtToken,
          clientId: existingClient._id,
        },
        200,
        res
      );
    }

    return SuccessHandler(
      {
        exists: false,
        message: "No client found with this email",
      },
      200,
      res
    );
  } catch (error) {
    console.error("Check client exists error:", error);
    return ErrorHandler(error.message, 500, req, res);
  }
};

/**
 * @desc Create a new client profile
 * @route POST /api/business/client-profiles
 * @access Private
 */
const createClientProfile = async (req, res) => {
  // #swagger.tags = ['Client Profiles']
  /* #swagger.description = 'Create a new client profile with first name, last name, email, and phone number. If a client with the same email or phone already exists, returns the existing client profile.'
     #swagger.security = [{ "Bearer": [] }]
     #swagger.parameters['obj'] = {
        in: 'body',
        description: 'Client profile information',
        required: true,
        schema: {
          firstName: 'John',
          lastName: 'Doe',
          email: 'john.doe@example.com',
          phone: '+1234567890'
        }
     }
     #swagger.responses[201] = {
        description: 'Client profile created successfully',
        schema: {
          success: true,
          data: {
            message: 'Client profile created successfully',
            client: {
              _id: 'client_id',
              firstName: 'John',
              lastName: 'Doe',
              email: 'john.doe@example.com',
              phone: '+1234567890',
              business: 'business_id',
              isProfileComplete: true,
              createdAt: '2024-01-01T00:00:00Z'
            },
            isExisting: false
          }
        }
     }
     #swagger.responses[200] = {
        description: 'Client profile already exists - returns existing client',
        schema: {
          success: true,
          data: {
            message: 'Client profile already exists',
            client: {
              _id: 'existing_client_id',
              firstName: 'John',
              lastName: 'Doe',
              email: 'john.doe@example.com',
              phone: '+1234567890',
              business: 'business_id',
              isProfileComplete: true,
              createdAt: '2024-01-01T00:00:00Z'
            },
            isExisting: true
          }
        }
     }
     #swagger.responses[400] = {
        description: 'Validation error - missing required fields or invalid email format'
     }
     #swagger.responses[404] = {
        description: 'Business not found'
     }
  */
  try {
    const { firstName, lastName, email, phone, businessId } = req.body;

    // Get business by ID from request body (for public client creation) or by owner (for authenticated requests)
    let business;
    if (businessId) {
      business = await Business.findById(businessId);
    } else if (req.user && req.user.id) {
      business = await Business.findOne({ owner: req.user.id });
    } else {
      return ErrorHandler("Business ID is required", 400, req, res);
    }

    if (!business) {
      return ErrorHandler("Business not found", 404, req, res);
    }

    // Validate required fields
    if (!firstName || !lastName || !email || !phone) {
      return ErrorHandler(
        "First name, last name, email, and phone number are required",
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

    // Check if client with this email already exists for this business
    const existingClientByEmail = await Client.findOne({
      business: business._id,
      email: email.toLowerCase(),
    });

    if (existingClientByEmail) {
      // Generate JWT token for existing client
      const jwtToken = existingClientByEmail.getJWTToken();

      return SuccessHandler(
        {
          message: "Client profile already exists",
          client: existingClientByEmail,
          token: jwtToken,
          clientId: existingClientByEmail._id,
          isExisting: true,
        },
        200,
        res,
        {
          cookieName: 'clientToken',
          cookieValue: jwtToken,
        }
      );
    }

    const { getCountryCode, getComparablePhone } = require("../utils/index");
    const countryHint = getCountryCode(business.contactInfo?.phone);
    const normalizedPhone = normalizePhone(phone, countryHint);
    const comparablePhone = getComparablePhone(normalizedPhone);

    // Check if client with this phone already exists for this business
    const existingClientByPhone = await Client.findOne({
      business: business._id,
      phoneComparable: comparablePhone,
    });

    if (existingClientByPhone) {
      // Generate JWT token for existing client
      const jwtToken = existingClientByPhone.getJWTToken();

      return SuccessHandler(
        {
          message: "Client profile already exists",
          client: existingClientByPhone,
          token: jwtToken,
          clientId: existingClientByPhone._id,
          isExisting: true,
        },
        200,
        res,
        {
          cookieName: 'clientToken',
          cookieValue: jwtToken,
        }
      );
    }

    // Create new client profile
    const clientData = {
      business: business._id,
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      email: email.toLowerCase().trim(),
      phone: normalizedPhone,
      isProfileComplete: true, // All required fields are provided
      isActive: true,
      status: "activated",
    };

    const newClient = await Client.create(clientData);

    // Generate JWT token for client authentication
    const jwtToken = newClient.getJWTToken();

    return SuccessHandler(
      {
        message: "Client profile created successfully",
        client: newClient,
        token: jwtToken,
        clientId: newClient._id,
        isExisting: false,
      },
      201,
      res,
      {
        cookieName: 'clientToken',
        cookieValue: jwtToken,
      }
    );
  } catch (error) {
    console.error("Create client profile error:", error);

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
 * @desc Create or get an unregistered client (for walk-ins, phone bookings)
 * @route POST /api/business/unregistered-client
 * @access Private
 */
const createUnregisteredClient = async (req, res) => {
  // #swagger.tags = ['Client Profiles']
  /* #swagger.description = 'Create a new unregistered client for internal business use (walk-ins, phone bookings). If client with same phone/email exists, returns existing client.'
     #swagger.security = [{ "Bearer": [] }]
     #swagger.parameters['obj'] = {
        in: 'body',
        description: 'Unregistered client information',
        required: true,
        schema: {
          firstName: 'John',
          lastName: 'Doe',
          phone: '+1234567890',
          email: 'john.doe@example.com',
          internalNotes: 'Prefers morning appointments',
          haircutPhotos: [{ url: 'https://...', description: 'Style preference' }]
        }
     }
     #swagger.responses[201] = {
        description: 'Unregistered client created successfully',
        schema: {
          success: true,
          data: {
            message: 'Unregistered client created successfully',
            client: {
              _id: 'client_id',
              firstName: 'John',
              lastName: 'Doe',
              phone: '+1234567890',
              email: 'john.doe@example.com',
              registrationStatus: 'unregistered',
              internalNotes: 'Prefers morning appointments',
              haircutPhotos: []
            },
            isNew: true
          }
        }
     }
     #swagger.responses[200] = {
        description: 'Existing client found - returns existing client',
        schema: {
          success: true,
          data: {
            message: 'Client already exists',
            client: { ... },
            isNew: false
          }
        }
     }
  */
  try {
    const { firstName, lastName, phone, email, internalNotes, haircutPhotos, staffId } = req.body;

    // Get business for current user
    const business = await Business.findOne({ owner: req.user.id });
    if (!business) {
      return ErrorHandler("Business not found", 404, req, res);
    }

    // Validate required fields
    if (!phone) {
      return ErrorHandler("Phone number is required", 400, req, res);
    }

    const { getCountryCode } = require("../utils/index");
    const countryHint = getCountryCode(business.contactInfo?.phone);
    const normalizedPhone = normalizePhone(phone, countryHint);

    // Use the static method to find or create unregistered client
    const { client, isNew } = await Client.findOrCreateUnregistered(
      business._id,
      {
        firstName: firstName || '',
        lastName: lastName || '',
        phone: normalizedPhone,
        email: email || undefined,
      }
    );

    // Update additional fields if provided
    if (internalNotes) {
      client.internalNotes = internalNotes;
    }
    
    if (staffId) {
      client.staff = staffId;
    }

    // Handle haircut photos from files
    if (req.files && req.files.length > 0) {
      const uploadedPhotos = [];
      for (const file of req.files) {
        try {
          const uploadResult = await uploadToCloudinary(
            file.buffer,
            "haircut-photos"
          );
          uploadedPhotos.push({
            url: uploadResult.secure_url,
            description: req.body[`photoDescription_${uploadedPhotos.length}`] || '',
            uploadedAt: new Date()
          });
        } catch (uploadError) {
          console.error("Failed to upload haircut photo:", uploadError.message);
          // Continue with other photos if one fails
        }
      }
      
      if (uploadedPhotos.length > 0) {
        client.haircutPhotos = [...(client.haircutPhotos || []), ...uploadedPhotos];
      }
    } else if (haircutPhotos && Array.isArray(haircutPhotos)) {
      // Fallback for when photos are sent as URLs directly (legacy or other integrations)
      client.haircutPhotos = [...(client.haircutPhotos || []), ...haircutPhotos];
    }

    if (internalNotes || staffId || (req.files && req.files.length > 0) || haircutPhotos) {
      await client.save();
    }

    return SuccessHandler(
      {
        message: isNew
          ? "Unregistered client created successfully"
          : "Client already exists - using existing record",
        client,
        isNew,
      },
      isNew ? 201 : 200,
      res
    );
  } catch (error) {
    console.error("Create unregistered client error:", error);
    return ErrorHandler(error.message, 500, req, res);
  }
};

/**
 * @desc Convert unregistered client to registered
 * @route POST /api/business/client/:clientId/convert-to-registered
 * @access Private
 */
const convertClientToRegistered = async (req, res) => {
  // #swagger.tags = ['Client Profiles']
  /* #swagger.description = 'Convert an unregistered client to a registered client when they verify their data and accept terms'
     #swagger.security = [{ "Bearer": [] }]
     #swagger.parameters['clientId'] = { in: 'path', required: true, description: 'Client ID' }
     #swagger.parameters['obj'] = {
        in: 'body',
        description: 'Registration data',
        required: true,
        schema: {
          password: 'securePassword123',
          acceptedTerms: true
        }
     }
  */
  try {
    const { clientId } = req.params;
    const { password, acceptedTerms } = req.body;

    // Get business for current user
    const business = await Business.findOne({ owner: req.user.id });
    if (!business) {
      return ErrorHandler("Business not found", 404, req, res);
    }

    // Find the client
    const client = await Client.findOne({
      _id: clientId,
      business: business._id,
    });

    if (!client) {
      return ErrorHandler("Client not found", 404, req, res);
    }

    if (client.registrationStatus === 'registered') {
      return ErrorHandler("Client is already registered", 400, req, res);
    }

    // Convert to registered
    await client.convertToRegistered(password, acceptedTerms);

    // Generate JWT token
    const jwtToken = client.getJWTToken();

    return SuccessHandler(
      {
        message: "Client successfully converted to registered account",
        client,
        token: jwtToken,
      },
      200,
      res,
      {
        cookieName: 'clientToken',
        cookieValue: jwtToken,
      }
    );
  } catch (error) {
    console.error("Convert client to registered error:", error);
    return ErrorHandler(error.message, 500, req, res);
  }
};

/**
 * @desc Get all client profiles for the business
 * @route GET /api/business/client-profiles
 * @access Private
 */
// const getClientProfiles = async (req, res) => {
//   // #swagger.tags = ['Client Profiles']
//   /* #swagger.description = 'Get all client profiles for the business with pagination and filtering'
//      #swagger.security = [{ "Bearer": [] }]
//      #swagger.parameters['page'] = { in: 'query', description: 'Page number for pagination', type: 'integer', default: 1 }
//      #swagger.parameters['limit'] = { in: 'query', description: 'Number of items per page', type: 'integer', default: 10 }
//      #swagger.parameters['search'] = { in: 'query', description: 'Search by first name, last name, email, or phone', type: 'string' }
//      #swagger.parameters['sort'] = { in: 'query', description: 'Sort by field (firstName, lastName, email, phone, createdAt)', type: 'string', default: 'firstName:asc' }
//      #swagger.parameters['isActive'] = { in: 'query', description: 'Filter by active status', type: 'boolean' }
//      #swagger.responses[200] = {
//         description: 'Client profiles retrieved successfully',
//         schema: {
//           success: true,
//           data: {
//             clients: [
//               {
//                 _id: 'client_id',
//                 firstName: 'John',
//                 lastName: 'Doe',
//                 email: 'john.doe@example.com',
//                 phone: '+1234567890',
//                 isActive: true,
//                 createdAt: '2024-01-01T00:00:00Z'
//               }
//             ],
//             pagination: {
//               currentPage: 1,
//               totalPages: 1,
//               totalClients: 1,
//               hasNext: false,
//               hasPrev: false
//             }
//           }
//         }
//      }
//      #swagger.responses[404] = {
//         description: 'Business not found'
//      }
//   */
//   try {
//     const business = await Business.findOne({ owner: req.user.id });
//     if (!business) {
//       return ErrorHandler("Business not found", 404, req, res);
//     }

//     const {
//       page = 1,
//       limit = 10,
//       search,
//       sort = "firstName:asc",
//       isActive,
//     } = req.query;

//     const skip = (parseInt(page) - 1) * parseInt(limit);
//     let query = { business: business._id };

//     // Filter by active status
//     if (isActive !== undefined) {
//       query.isActive = isActive === "true";
//     }

//     // Handle search
//     if (search) {
//       query.$or = [
//         { firstName: { $regex: search, $options: "i" } },
//         { lastName: { $regex: search, $options: "i" } },
//         { email: { $regex: search, $options: "i" } },
//         { phone: { $regex: search, $options: "i" } },
//       ];
//     }

//     // Handle sorting
//     let sortObj = {};
//     if (sort) {
//       const [field, direction] = sort.split(":");
//       const validFields = [
//         "firstName",
//         "lastName",
//         "email",
//         "phone",
//         "createdAt",
//       ];
//       if (validFields.includes(field)) {
//         sortObj[field] = direction === "desc" ? -1 : 1;
//       }
//     }

//     // Get total count for pagination
//     const totalClients = await Client.countDocuments(query);

//     // Get clients with pagination
//     const clients = await Client.find(query)
//       .select("firstName lastName email phone isActive createdAt")
//       .sort(sortObj)
//       .skip(skip)
//       .limit(parseInt(limit));

//     const totalPages = Math.ceil(totalClients / parseInt(limit));

//     return SuccessHandler(
//       {
//         clients,
//         pagination: {
//           currentPage: parseInt(page),
//           totalPages,
//           totalClients,
//           hasNext: parseInt(page) < totalPages,
//           hasPrev: parseInt(page) > 1,
//         },
//       },
//       200,
//       res
//     );
//   } catch (error) {
//     console.error("Get client profiles error:", error);
//     return ErrorHandler(error.message, 500, req, res);
//   }
// };

/**
 * @desc Get a specific client profile by ID
 * @route GET /api/business/client-profiles/:clientId
 * @access Private
 */
// const getClientProfile = async (req, res) => {
//   // #swagger.tags = ['Client Profiles']
//   /* #swagger.description = 'Get a specific client profile by ID'
//      #swagger.security = [{ "Bearer": [] }]
//      #swagger.parameters['clientId'] = {
//         in: 'path',
//         description: 'Client ID',
//         required: true,
//         type: 'string'
//      }
//      #swagger.responses[200] = {
//         description: 'Client profile retrieved successfully',
//         schema: {
//           success: true,
//           data: {
//             _id: 'client_id',
//             firstName: 'John',
//             lastName: 'Doe',
//             email: 'john.doe@example.com',
//             phone: '+1234567890',
//             business: 'business_id',
//             isProfileComplete: true,
//             isActive: true,
//             status: 'activated',
//             createdAt: '2024-01-01T00:00:00Z',
//             updatedAt: '2024-01-01T00:00:00Z'
//           }
//         }
//      }
//      #swagger.responses[404] = {
//         description: 'Client profile or business not found'
//      }
//   */
//   try {
//     const business = await Business.findOne({ owner: req.user.id });
//     if (!business) {
//       return ErrorHandler("Business not found", 404, req, res);
//     }

//     const { clientId } = req.params;

//     if (!mongoose.Types.ObjectId.isValid(clientId)) {
//       return ErrorHandler("Invalid client ID", 400, req, res);
//     }

//     const client = await Client.findOne({
//       _id: clientId,
//       business: business._id,
//     });

//     if (!client) {
//       return ErrorHandler("Client profile not found", 404, req, res);
//     }

//     return SuccessHandler(client, 200, res);
//   } catch (error) {
//     console.error("Get client profile error:", error);
//     return ErrorHandler(error.message, 500, req, res);
//   }
// };

/**
 * @desc Update a client profile
 * @route PUT /api/business/client-profiles/:clientId
 * @access Private
 */
// const updateClientProfile = async (req, res) => {
//   // #swagger.tags = ['Client Profiles']
//   /* #swagger.description = 'Update a client profile with first name, last name, email, and phone number'
//      #swagger.security = [{ "Bearer": [] }]
//      #swagger.parameters['clientId'] = {
//         in: 'path',
//         description: 'Client ID',
//         required: true,
//         type: 'string'
//      }
//      #swagger.parameters['obj'] = {
//         in: 'body',
//         description: 'Updated client profile information',
//         required: true,
//         schema: {
//           firstName: 'John',
//           lastName: 'Smith',
//           email: 'john.smith@example.com',
//           phone: '+1987654321'
//         }
//      }
//      #swagger.responses[200] = {
//         description: 'Client profile updated successfully',
//         schema: {
//           success: true,
//           data: {
//             _id: 'client_id',
//             firstName: 'John',
//             lastName: 'Smith',
//             email: 'john.smith@example.com',
//             phone: '+1987654321',
//             business: 'business_id',
//             isProfileComplete: true,
//             isActive: true,
//             status: 'activated',
//             createdAt: '2024-01-01T00:00:00Z',
//             updatedAt: '2024-01-01T12:00:00Z'
//           }
//         }
//      }
//      #swagger.responses[400] = {
//         description: 'Validation error - missing required fields'
//      }
//      #swagger.responses[404] = {
//         description: 'Client profile or business not found'
//      }
//      #swagger.responses[409] = {
//         description: 'Client with this email or phone already exists'
//      }
//   */
//   try {
//     const business = await Business.findOne({ owner: req.user.id });
//     if (!business) {
//       return ErrorHandler("Business not found", 404, req, res);
//     }

//     const { clientId } = req.params;
//     const { firstName, lastName, email, phone } = req.body;

//     if (!mongoose.Types.ObjectId.isValid(clientId)) {
//       return ErrorHandler("Invalid client ID", 400, req, res);
//     }

//     // Validate required fields
//     if (!firstName || !lastName || !email || !phone) {
//       return ErrorHandler(
//         "First name, last name, email, and phone number are required",
//         400,
//         req,
//         res
//       );
//     }

//     // Validate email format
//     const emailRegex = /^\w+([.-]?\w+)*@\w+([.-]?\w+)*(\.\w{2,3})+$/;
//     if (!emailRegex.test(email)) {
//       return ErrorHandler("Please enter a valid email address", 400, req, res);
//     }

//     // Find the client
//     const client = await Client.findOne({
//       _id: clientId,
//       business: business._id,
//     });

//     if (!client) {
//       return ErrorHandler("Client profile not found", 404, req, res);
//     }

//     // Check if email is being changed and if it already exists
//     if (client.email !== email.toLowerCase()) {
//       const existingClientByEmail = await Client.findOne({
//         business: business._id,
//         email: email.toLowerCase(),
//         _id: { $ne: clientId },
//       });

//       if (existingClientByEmail) {
//         return ErrorHandler(
//           "A client with this email already exists for your business",
//           409,
//           req,
//           res
//         );
//       }
//     }

//     // Check if phone is being changed and if it already exists
//     if (client.phone !== phone) {
//       const existingClientByPhone = await Client.findOne({
//         business: business._id,
//         phone: phone,
//         _id: { $ne: clientId },
//       });

//       if (existingClientByPhone) {
//         return ErrorHandler(
//           "A client with this phone number already exists for your business",
//           409,
//           req,
//           res
//         );
//       }
//     }

//     // Update client profile
//     client.firstName = firstName.trim();
//     client.lastName = lastName.trim();
//     client.email = email.toLowerCase().trim();
//     client.phone = phone.trim();
//     client.isProfileComplete = true; // All required fields are provided

//     const updatedClient = await client.save();

//     return SuccessHandler(
//       {
//         message: "Client profile updated successfully",
//         client: updatedClient,
//       },
//       200,
//       res
//     );
//   } catch (error) {
//     console.error("Update client profile error:", error);

//     // Handle duplicate key errors
//     if (error.code === 11000) {
//       const field = Object.keys(error.keyPattern)[0];
//       return ErrorHandler(
//         `A client with this ${field} already exists`,
//         409,
//         req,
//         res
//       );
//     }

//     return ErrorHandler(error.message, 500, req, res);
//   }
// };

/**
 * @desc Delete a client profile
 * @route DELETE /api/business/client-profiles/:clientId
 * @access Private
 */
// const deleteClientProfile = async (req, res) => {
//   // #swagger.tags = ['Client Profiles']
//   /* #swagger.description = 'Delete a client profile'
//      #swagger.security = [{ "Bearer": [] }]
//      #swagger.parameters['clientId'] = {
//         in: 'path',
//         description: 'Client ID',
//         required: true,
//         type: 'string'
//      }
//      #swagger.responses[200] = {
//         description: 'Client profile deleted successfully',
//         schema: {
//           success: true,
//           message: 'Client profile deleted successfully'
//         }
//      }
//      #swagger.responses[404] = {
//         description: 'Client profile or business not found'
//      }
//   */
//   try {
//     const business = await Business.findOne({ owner: req.user.id });
//     if (!business) {
//       return ErrorHandler("Business not found", 404, req, res);
//     }

//     const { clientId } = req.params;

//     if (!mongoose.Types.ObjectId.isValid(clientId)) {
//       return ErrorHandler("Invalid client ID", 400, req, res);
//     }

//     const client = await Client.findOne({
//       _id: clientId,
//       business: business._id,
//     });

//     if (!client) {
//       return ErrorHandler("Client profile not found", 404, req, res);
//     }

//     // Check if client has any appointments
//     const appointmentCount = await Appointment.countDocuments({
//       business: business._id,
//       client: clientId,
//     });

//     if (appointmentCount > 0) {
//       return ErrorHandler(
//         "Cannot delete client profile with existing appointments. Please deactivate the client instead.",
//         400,
//         req,
//         res
//       );
//     }

//     await Client.findByIdAndDelete(clientId);

//     return SuccessHandler(
//       {
//         message: "Client profile deleted successfully",
//       },
//       200,
//       res
//     );
//   } catch (error) {
//     console.error("Delete client profile error:", error);
//     return ErrorHandler(error.message, 500, req, res);
//   }
// };

/**
 * @desc Toggle client profile active status
 * @route PATCH /api/business/client-profiles/:clientId/toggle-status
 * @access Private
 */
// const toggleClientProfileStatus = async (req, res) => {
//   // #swagger.tags = ['Client Profiles']
//   /* #swagger.description = 'Toggle the active status of a client profile'
//      #swagger.security = [{ "Bearer": [] }]
//      #swagger.parameters['clientId'] = {
//         in: 'path',
//         description: 'Client ID',
//         required: true,
//         type: 'string'
//      }
//      #swagger.responses[200] = {
//         description: 'Client profile status updated successfully',
//         schema: {
//           success: true,
//           data: {
//             _id: 'client_id',
//             firstName: 'John',
//             lastName: 'Doe',
//             email: 'john.doe@example.com',
//             phone: '+1234567890',
//             isActive: false,
//             status: 'deactivated'
//           }
//         }
//      }
//      #swagger.responses[404] = {
//         description: 'Client profile or business not found'
//      }
//   */
//   try {
//     const business = await Business.findOne({ owner: req.user.id });
//     if (!business) {
//       return ErrorHandler("Business not found", 404, req, res);
//     }

//     const { clientId } = req.params;

//     if (!mongoose.Types.ObjectId.isValid(clientId)) {
//       return ErrorHandler("Invalid client ID", 400, req, res);
//     }

//     const client = await Client.findOne({
//       _id: clientId,
//       business: business._id,
//     });

//     if (!client) {
//       return ErrorHandler("Client profile not found", 404, req, res);
//     }

//     // Toggle active status
//     client.isActive = !client.isActive;
//     client.status = client.isActive ? "activated" : "deactivated";

//     const updatedClient = await client.save();

//     return SuccessHandler(
//       {
//         message: `Client profile ${
//           client.isActive ? "activated" : "deactivated"
//         } successfully`,
//         client: updatedClient,
//       },
//       200,
//       res
//     );
//   } catch (error) {
//     console.error("Toggle client profile status error:", error);
//     return ErrorHandler(error.message, 500, req, res);
//   }
// };

module.exports = {
  getUserBusiness,
  getBusinessById,
  updateBusinessInfo,
  updateBusinessAddress,
  updateBusinessLocation,
  updateBusinessHours,
  getBusinessServices,
  addBusinessService,
  updateBusinessService,
  deleteBusinessService,
  updateBusinessProfile,
  getBusinessClients,
  addClient,
  getClientDetails,
  addClientNote,
  updateBusinessSettings,
  getBusinessSettings,
  startFreeTrial,
  getSubscriptionStatus,
  createStripeSubscription,
  handleStripeWebhook,
  // testWebhook,
  createEmailCampaign,
  getEmailCampaigns,
  updateEmailCampaign,
  deleteEmailCampaign,
  sendEmailCampaign,
  triggerEmailCampaignProcessing,
  getEmailCampaignSchedulerStatus,
  createSmsCampaign,
  checkCampaignCredits,
  getBarberProfileByLink,
  getBarberLink,
  regenerateBarberLink,
  checkClientExists,
  createClientProfile,
  createUnregisteredClient,
  convertClientToRegistered,
  // getClientProfiles,
  // getClientProfile,
  // updateClientProfile,
  // deleteClientProfile,
  // toggleClientProfileStatus,
};

// Remaining Steps for Stripe Subscriptions:
// Add your Stripe keys and price ID to your environment.
// Deploy a Stripe webhook endpoint (using the provided handler) for production.
// Use the new endpoints in your frontend for trial/subscription flows.
