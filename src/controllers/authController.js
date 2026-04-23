const User = require("../models/User/user");
const sendMail = require("../utils/sendMail");
const SuccessHandler = require("../utils/SuccessHandler");
const ErrorHandler = require("../utils/ErrorHandler");
const ejs = require("ejs");
const path = require("path");
const bcrypt = require("bcryptjs");
const { uploadFiles, deleteFile } = require("../utils/aws");
const Business = require("../models/User/business");
const Appointment = require("../models/appointment");
const Staff = require("../models/staff");
const { uploadToCloudinary, deleteImage } = require("../functions/cloudinary");
const BarberLink = require("../models/barberLink");
const { generateInvitationToken } = require("../utils/index");
const {
  getCanonicalRevenueTotalsByBusiness,
} = require("../services/payment/revenueProjection");

const sanitizeAuthUser = (userDoc) => {
  if (!userDoc) return userDoc;

  const user =
    typeof userDoc.toObject === "function" ? userDoc.toObject() : { ...userDoc };

  delete user.password;
  delete user.passwordResetToken;
  delete user.passwordResetTokenExpires;
  delete user.pendingPenalties;

  return user;
};

//register
const register = async (req, res) => {
  // #swagger.tags = ['Auth']
  try {
    const {
      email,
      password,
      personalName,
      surname,
      phone,
      businessName,
      address,
      location,
      businessHours,
      services,
      googlePlaceId,
    } = req.body;

    // Step 1: Validate required fields
    if (!email || !password) {
      return ErrorHandler("Email and password are required.", 400, req, res);
    }
    if (!personalName || !surname) {
      return ErrorHandler(
        "Personal name and surname are required.",
        400,
        req,
        res
      );
    }
    if (!businessName) {
      return ErrorHandler("Business name is required.", 400, req, res);
    }
    if (!phone) {
      return ErrorHandler("Phone number is required.", 400, req, res);
    }
    if (
      !address ||
      !address.streetName ||
      !address.houseNumber ||
      !address.city ||
      !address.postalCode
    ) {
      return ErrorHandler("Complete address is required.", 400, req, res);
    }
    if (
      !location ||
      !Array.isArray(location.coordinates) ||
      location.coordinates.length !== 2 ||
      !location.address
    ) {
      return ErrorHandler(
        "Location (coordinates and address) is required.",
        400,
        req,
        res
      );
    }
    if (!businessHours) {
      return ErrorHandler("Business hours are required.", 400, req, res);
    }

    // Step 2: Check if user already exists
    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return ErrorHandler(
        "A user with this email already exists.",
        400,
        req,
        res
      );
    }

    // Step 3: Create User
    const user = new User({
      name: `${personalName} ${surname}`.trim(),
      email,
      password,
      phone,
      provider: "app",
      // role: "barber",
      // status: "activated",
    });
    await user.save();

    // Step 4: Prepare business hours object (match updateBusinessProfile logic)
    const defaultBusinessHours = {
      monday: { enabled: true, shifts: [] },
      tuesday: { enabled: true, shifts: [] },
      wednesday: { enabled: true, shifts: [] },
      thursday: { enabled: true, shifts: [] },
      friday: { enabled: true, shifts: [] },
      saturday: { enabled: false, shifts: [] },
      sunday: { enabled: false, shifts: [] },
    };
    if (businessHours && typeof businessHours === "object") {
      for (const day in businessHours) {
        if (defaultBusinessHours[day]) {
          defaultBusinessHours[day] = businessHours[day];
        }
      }
    }

    // Step 5: Create Business
    const business = new Business({
      owner: user._id,
      personalName,
      surname,
      name: businessName,
      contactInfo: {
        email,
        phone,
      },
      address: {
        streetName: address.streetName,
        houseNumber: address.houseNumber,
        city: address.city,
        postalCode: address.postalCode,
      },
      location: {
        type: "Point",
        coordinates: location.coordinates,
        address: location.address,
      },
      businessHours: defaultBusinessHours,
      services: services || [], // Add services from registration
      googlePlaceId: googlePlaceId || null,
    });
    await business.save();

    // Step 6: Generate JWT
    const jwtToken = user.getJWTToken();

    // Step 7: Generate barber link
    let barberLink = null;
    try {
      const linkToken = generateInvitationToken();
      const baseUrl = process.env.FRONTEND_URL || "http://localhost:5173";
      const barberLinkUrl = `${baseUrl}/barber/profile/${linkToken}`;

      // Create barber link record
      await BarberLink.create({
        business: business._id,
        linkToken: linkToken,
        createdBy: user._id,
        isActive: true,
      });

      // Update business with the public URL
      business.contactInfo.publicUrl = barberLinkUrl;
      await business.save();

      barberLink = barberLinkUrl;
    } catch (linkError) {
      console.error("Error creating barber link:", linkError);
      // Don't fail registration if link creation fails
    }

    // Set cookie for regular user/barber registration
    return SuccessHandler(
      {
        token: jwtToken,
        user: sanitizeAuthUser(user),
        business,
        barberLink,
        signup: true,
      },
      200,
      res,
      {
        cookieName: 'userToken',
        cookieValue: jwtToken,
      }
    );
  } catch (error) {
    console.error("Registration error:", error);
    return ErrorHandler(error.message, 500, req, res);
  }
};

//login
const login = async (req, res) => {
  // #swagger.tags = ['Auth']
  /* #swagger.description = 'Log in an existing user'
     #swagger.parameters['obj'] = {
        in: 'body',
        description: 'User login credentials',
        required: true,
        schema: {
          email: 'john@example.com',
          password: 'password123',
          deviceToken: 'optional-device-token',
          userType: 'user'
        }
     }
     #swagger.responses[200] = {
        description: 'User logged in successfully',
        schema: { $ref: '#/definitions/AuthResponse' }
     }
     #swagger.responses[400] = {
        description: 'User does not exist or invalid credentials'
     }
  */
  try {
    const { email, password, deviceToken, userType } = req.body;
    const user = await User.findOne({ email }).select("+password");
    if (!user) {
      return ErrorHandler("User does not exist", 400, req, res);
    }

    if (
      userType === "admin" &&
      user.role !== "admin" &&
      user.role !== "sub-admin"
    ) {
      return ErrorHandler(
        "Access denied. Admin credentials required.",
        403,
        req,
        res
      );
    }

    if (
      userType === "user" &&
      (user.role === "admin" || user.role === "sub-admin")
    ) {
      return ErrorHandler(
        "Access denied. You are not a regular user.",
        403,
        req,
        res
      );
    }

    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return ErrorHandler("Invalid credentials", 400, req, res);
    }
    if (deviceToken) {
      user.deviceToken = deviceToken;
      await user.save();
    }
    jwtToken = user.getJWTToken();
    
    let cookieName = 'userToken';
    if (userType === 'admin' && (user.role === 'admin' || user.role === 'sub-admin')) {
      cookieName = 'adminToken';
    }
    
    return SuccessHandler(
      {
        token: jwtToken,
        user: sanitizeAuthUser(user),
      },
      200,
      res,
      {
        cookieName: cookieName,
        cookieValue: jwtToken,
      }
    );
  } catch (error) {
    return ErrorHandler(error.message, 500, req, res);
  }
};

//forgot password
const forgotPassword = async (req, res) => {
  // #swagger.tags = ['Auth']
  /* #swagger.description = 'Send password reset token to user email'
     #swagger.parameters['obj'] = {
        in: 'body',
        description: 'User email',
        required: true,
        schema: {
          email: 'john@example.com'
        }
     }
     #swagger.responses[200] = {
        description: 'Password reset token sent to email'
     }
     #swagger.responses[400] = {
        description: 'User does not exist'
     }
  */
  try {
    const { email } = req.body;
    const user = await User.findOne({ email });
    if (!user) {
      return ErrorHandler("User does not exist", 400, req, res);
    }
    const passwordResetToken = Math.floor(100000 + Math.random() * 900000);
    const passwordResetTokenExpires = new Date(Date.now() + 10 * 60 * 1000);
    user.passwordResetToken = passwordResetToken;
    user.passwordResetTokenExpires = passwordResetTokenExpires;
    console.log(passwordResetToken);
    await user.save();
    const ejTemp = await ejs.renderFile(
      `${path.join(__dirname, "../ejs")}/forgetPassword.ejs`,
      { otp: passwordResetToken }
    );
    const subject = `Password reset token`;
    await sendMail(email, subject, ejTemp);
    return SuccessHandler(`Password reset token sent to ${email}`, 200, res);
  } catch (error) {
    return ErrorHandler(error.message, 500, req, res);
  }
};

//reset password
const resetPassword = async (req, res) => {
  // #swagger.tags = ['Auth']
  /* #swagger.description = 'Reset password using token'
     #swagger.parameters['obj'] = {
        in: 'body',
        description: 'Password reset information',
        required: true,
        schema: {
          email: 'john@example.com',
          passwordResetToken: '123456',
          password: 'newpassword123'
        }
     }
     #swagger.responses[200] = {
        description: 'Password reset successfully'
     }
     #swagger.responses[400] = {
        description: 'User does not exist or invalid/expired token'
     }
  */
  try {
    const { email, passwordResetToken, password } = req.body;
    const user = await User.findOne({ email }).select("+password");
    if (!user) {
      return ErrorHandler("User does not exist", 400, req, res);
    }
    if (
      user.passwordResetToken.toString() !== passwordResetToken.toString() ||
      user.passwordResetTokenExpires < Date.now()
    ) {
      return ErrorHandler("Invalid token", 400, req, res);
    }
    user.password = password;
    user.passwordResetToken = null;
    user.passwordResetTokenExpires = null;
    await user.save();
    return SuccessHandler("Password reset successfully", 200, res);
  } catch (error) {
    return ErrorHandler(error.message, 500, req, res);
  }
};

//update password
const updatePassword = async (req, res) => {
  // #swagger.tags = ['Auth']
  /* #swagger.description = 'Update password for logged in user'
     #swagger.security = [{ "Bearer": [] }]
     #swagger.parameters['obj'] = {
        in: 'body',
        description: 'Password update information',
        required: true,
        schema: {
          currentPassword: 'oldpassword123',
          newPassword: 'newpassword123'
        }
     }
     #swagger.responses[200] = {
        description: 'Password updated successfully'
     }
     #swagger.responses[400] = {
        description: 'Invalid credentials or new password same as old password'
     }
  */
  try {
    const { currentPassword, newPassword } = req.body;
    const user = await User.findById(req.user.id).select("+password");
    const isMatch = await user.comparePassword(currentPassword);
    if (!isMatch) {
      return ErrorHandler("Invalid credentials", 400, req, res);
    }
    const samePasswords = await user.comparePassword(newPassword);
    if (samePasswords) {
      return ErrorHandler(
        "New password cannot be same as old password",
        400,
        req,
        res
      );
    }
    user.password = newPassword;
    await user.save();
    return SuccessHandler("Password updated successfully", 200, res);
  } catch (error) {
    return ErrorHandler(error.message, 500, req, res);
  }
};

// const updateProfile = async (req, res) => {
//   // #swagger.tags = ['Auth']
//   /* #swagger.description = 'Update user profile information'
//      #swagger.security = [{ "Bearer": [] }]
//      #swagger.consumes = ['multipart/form-data']
//      #swagger.parameters['profileImage'] = {
//         in: 'formData',
//         type: 'file',
//         description: 'Profile image file'
//      }
//      #swagger.parameters['name'] = {
//         in: 'formData',
//         type: 'string',
//         description: 'User name'
//      }
//      #swagger.parameters['phone'] = {
//         in: 'formData',
//         type: 'string',
//         description: 'User phone number'
//      }
//      #swagger.responses[200] = {
//         description: 'Profile updated successfully',
//         schema: { $ref: '#/definitions/User' }
//      }
//      #swagger.responses[400] = {
//         description: 'User does not exist or trying to update email/password'
//      }
//   */
//   try {
//     const data = req.body;

//     const user = await User.findById(req.user._id);
//     if (!user) {
//       return ErrorHandler("User does not exist", 400, req, res);
//     }

//     let profileLink = user?.profileImage;

//     if (req.files && req.files?.profileImage?.[0]) {
//       console.log("profileImage");
//       const img = req.files.profileImage[0];
//       const filePath = `${Date.now()}-${path.parse(img?.originalname)?.name}`;
//       const url = await cloud.uploadStreamImage(img.buffer, filePath);
//       if (profileLink) {
//         await cloud.deleteImage(profileLink);
//       }
//       profileLink = url.secure_url;
//     }

//     if (data.email || data.password) {
//       return ErrorHandler(
//         "Email and password cannot be updated here",
//         400,
//         req,
//         res
//       );
//     }

//     const updated = await User.findByIdAndUpdate(
//       req.user._id,
//       {
//         ...data,
//         profileImage: profileLink,
//       },
//       {
//         new: true,
//       }
//     );
//     return SuccessHandler(updated, 200, res);
//   } catch (error) {
//     return ErrorHandler(error.message, 500, req, res);
//   }
// };

const getMe = async (req, res) => {
  // #swagger.tags = ['Auth']
  /* #swagger.description = 'Get current user profile'
     #swagger.security = [{ "Bearer": [] }]
     #swagger.responses[200] = {
        description: 'User profile retrieved successfully',
        schema: { $ref: '#/definitions/User' }
     }
  */
  try {
    const user = await User.findById(req.user._id);
    return SuccessHandler(sanitizeAuthUser(user), 200, res);
  } catch (error) {
    return ErrorHandler(error.message, 500, req, res);
  }
};

// const updateAdminProfile = async (req, res) => {
//   // #swagger.tags = ['Auth']
//   /* #swagger.description = 'Update admin profile information'
//      #swagger.security = [{ "Bearer": [] }]
//      #swagger.consumes = ['multipart/form-data']
//      #swagger.parameters['profileImage'] = {
//         in: 'formData',
//         type: 'file',
//         description: 'Profile image file'
//      }
//      #swagger.parameters['name'] = {
//         in: 'formData',
//         type: 'string',
//         description: 'Admin name'
//      }
//      #swagger.parameters['country'] = {
//         in: 'formData',
//         type: 'string',
//         description: 'Admin country'
//      }
//      #swagger.parameters['phone'] = {
//         in: 'formData',
//         type: 'string',
//         description: 'Admin phone number'
//      }
//      #swagger.parameters['zip'] = {
//         in: 'formData',
//         type: 'string',
//         description: 'Admin ZIP/postal code'
//      }
//      #swagger.responses[200] = {
//         description: 'Admin profile updated successfully',
//         schema: { $ref: '#/definitions/User' }
//      }
//   */
//   try {
//     const { name, country, phone, zip } = req.body;

//     const user = await User.findById(req.user._id);
//     let profileLink =
//       req.body?.profileImage === "null" ? null : user?.profileImage;

//     if (
//       req.files &&
//       req.files?.profileImage &&
//       req.files?.profileImage?.length > 0
//     ) {
//       const img = req.files.profileImage[0];
//       const filePath = `${Date.now()}-${path.parse(img?.originalname)?.name}`;
//       const url = await cloud.uploadStreamImage(img.buffer, filePath);
//       if (profileLink) {
//         await cloud.deleteImage(profileLink);
//       }
//       profileLink = url.secure_url;
//     }

//     const updated = await User.findByIdAndUpdate(
//       req.user._id,
//       {
//         name,
//         country,
//         phone,
//         zip,
//         profileImage: profileLink,
//       },
//       {
//         new: true,
//       }
//     );

//     return SuccessHandler(updated, 200, res);
//   } catch (error) {
//     return ErrorHandler(error.message, 500, req, res);
//   }
// };

const socialAuth = async (req, res) => {
  // #swagger.tags = ['Auth']
  /* #swagger.description = 'Authenticate user with social provider (Google, Facebook)'
     #swagger.parameters['obj'] = {
        in: 'body',
        description: 'Social authentication information',
        required: true,
        schema: {
          email: 'john@example.com',
          name: 'John Doe',
          provider: 'google',
          photoURL: 'https://example.com/photo.jpg',
          deviceToken: 'optional-device-token'
        }
     }
     #swagger.responses[200] = {
        description: 'User authenticated successfully',
        schema: { $ref: '#/definitions/AuthResponse' }
     }
     #swagger.responses[400] = {
        description: 'Missing required fields or invalid provider'
     }
  */
  try {
    // Firebase se aane wali information
    const { email, name, provider, photoURL, deviceToken } = req.body;

    // Generate a temporary email for Facebook users if email is null
    const userEmail =
      email || (provider === "facebook" && name)
        ? email ||
          `${name
            .replace(/\s+/g, "")
            .toLowerCase()}_${Date.now()}@facebook.temporary.com`
        : null;

    if (!name || (provider !== "facebook" && !userEmail)) {
      return ErrorHandler(
        "Name is required, and email is required for non-Facebook providers",
        400,
        req,
        res
      );
    }

    // Provider type validate karein
    if (!provider || (provider !== "google" && provider !== "facebook")) {
      return ErrorHandler("Invalid provider type", 400, req, res);
    }

    // For Facebook logins with no email, try to find by name + provider instead
    let exUser = null;

    if (userEmail) {
      exUser = await User.findOne({ email: userEmail });
    }

    // If no user found by email, and it's Facebook, try by name and provider
    if (!exUser && provider === "facebook" && !email) {
      exUser = await User.findOne({ name, provider: "facebook" });
    }

    // Existing user with same provider
    if (exUser && exUser.provider === provider) {
      const token = await exUser.getJWTToken();

      // Update user information if needed
      let updated = false;

      if (deviceToken && exUser.deviceToken !== deviceToken) {
        exUser.deviceToken = deviceToken;
        updated = true;
      }

      if (photoURL && !exUser.profileImage) {
        exUser.profileImage = photoURL;
        updated = true;
      }

      if (updated) {
        await exUser.save();
      }

      // Set cookie for social auth (regular user)
      return SuccessHandler(
        { token, user: sanitizeAuthUser(exUser) }, 
        200, 
        res,
        {
          cookieName: 'userToken',
          cookieValue: token,
        }
      );
    }
    // Existing user with different social provider
    else if (
      exUser &&
      exUser.provider !== "app" &&
      exUser.provider !== provider
    ) {
      return ErrorHandler(
        `You previously signed up with ${exUser.provider}. Please use that method instead.`,
        400,
        req,
        res
      );
    }
    // Existing user with email/password
    else if (exUser && exUser.provider === "app") {
      return ErrorHandler(
        "You previously signed up with email/password. Please use that method instead.",
        400,
        req,
        res
      );
    }
    // New user - create account
    else {
      // Create new user with Firebase info
      const user = await User.create({
        email: userEmail,
        name,
        provider, // "google" ya "facebook"
        profileImage: photoURL || null, // Profile photo bhi save kar lein
        deviceToken: deviceToken || null,
      });

      const token = await user.getJWTToken();
      // Set cookie for new social auth user
      return SuccessHandler(
        { token, user: sanitizeAuthUser(user), signup: true }, 
        200, 
        res,
        {
          cookieName: 'userToken',
          cookieValue: token,
        }
      );
    }
  } catch (error) {
    console.log(error);
    return ErrorHandler(error.message, 500, req, res);
  }
};

/**
 * @desc Get all barbers with filtering, sorting, and pagination
 * @route GET /api/auth/barbers
 * @access Private (Admin)
 */
const getBarber = async (req, res) => {
  // #swagger.tags = ['Auth']
  /* #swagger.description = 'Get all users with role barber, with filtering, sorting, and pagination. Includes total revenue and appointment count for each barber.'
     #swagger.security = [{ "Bearer": [] }]
     #swagger.parameters['status'] = { in: 'query', description: 'Filter by activation status (activated, deactivated)', type: 'string' }
     #swagger.parameters['sort'] = { in: 'query', description: 'Sort by field (e.g., name:asc, email:desc, phone:asc, totalRevenue:desc, totalAppointments:desc)', type: 'string' }
     #swagger.parameters['page'] = { in: 'query', description: 'Page number for pagination', type: 'integer' }
     #swagger.parameters['limit'] = { in: 'query', description: 'Number of items per page', type: 'integer' }
     #swagger.responses[200] = {
        description: 'Barbers retrieved successfully with revenue and appointment data',
        schema: {
          barbers: [{
            _id: 'barber_id',
            name: 'John Doe',
            email: 'john@example.com',
            phone: '+1234567890',
            totalRevenue: 1500.50,
            totalAppointments: 25,
            business: {
              _id: 'business_id',
              name: 'Barber Shop'
            }
          }],
          pagination: {
            total: 50,
            page: 1,
            pages: 5
          }
        }
     }
  */
  try {
    const { status, sort, page = 1, limit = 10 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Base query - only include active barbers by default
    let baseQuery = {
      role: "barber",
      isActive: { $ne: false }, // Exclude soft-deleted barbers
    };

    if (status && ["activated", "deactivated"].includes(status)) {
      baseQuery.status = status;
    }

    // Sorting
    let sortObj = {};
    if (sort) {
      const [field, direction] = sort.split(":");
      if (
        [
          "name",
          "email",
          "phone",
          "totalRevenue",
          "totalAppointments",
        ].includes(field)
      ) {
        sortObj[field] = direction === "desc" ? -1 : 1;
      }
    } else {
      sortObj["name"] = 1; // Default sort by name ascending
    }

    // Get barbers with pagination
    const barbers = await User.find(baseQuery)
      .sort(sortObj)
      .skip(skip)
      .limit(parseInt(limit));

    // Get total count for pagination
    const total = await User.countDocuments(baseQuery);

    const businesses = await Business.find({
      owner: { $in: barbers.map((barber) => barber._id) },
    }).select("_id owner name contactInfo");

    const businessIds = businesses.map((business) => business._id);

    const [appointmentCounts, revenueTotals] = await Promise.all([
      businessIds.length > 0
        ? Appointment.aggregate([
            {
              $match: {
                business: { $in: businessIds },
              },
            },
            {
              $group: {
                _id: "$business",
                totalAppointments: { $sum: 1 },
              },
            },
          ])
        : [],
      getCanonicalRevenueTotalsByBusiness({
        businessIds,
        paymentMatch: {
          status: { $in: ["captured", "refunded_partial", "refunded_full"] },
        },
      }),
    ]);

    const businessByOwnerMap = new Map(
      businesses.map((business) => [business.owner.toString(), business])
    );
    const appointmentCountMap = new Map(
      appointmentCounts.map((entry) => [
        entry._id.toString(),
        entry.totalAppointments || 0,
      ])
    );
    const revenueTotalMap = new Map(
      revenueTotals.map((entry) => [
        entry._id.toString(),
        Number(entry.totalRevenue) || 0,
      ])
    );

    const enhancedBarbers = barbers.map((barber) => {
      const business = businessByOwnerMap.get(barber._id.toString()) || null;
      const businessId = business?._id?.toString();

      return {
        ...barber.toObject(),
        totalRevenue: businessId ? revenueTotalMap.get(businessId) || 0 : 0,
        totalAppointments: businessId
          ? appointmentCountMap.get(businessId) || 0
          : 0,
        business: business
          ? {
              _id: business._id,
              name: business.name,
              contactInfo: business.contactInfo,
            }
          : null,
      };
    });

    // Handle sorting by revenue or appointments if specified
    if (
      sort &&
      ["totalRevenue", "totalAppointments"].includes(sort.split(":")[0])
    ) {
      const [field, direction] = sort.split(":");
      enhancedBarbers.sort((a, b) => {
        const aValue = a[field] || 0;
        const bValue = b[field] || 0;
        return direction === "desc" ? bValue - aValue : aValue - bValue;
      });
    }

    return SuccessHandler(
      {
        barbers: enhancedBarbers,
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
 * @desc Update the status of a barber (admin only)
 * @route PATCH /api/auth/barbers/:id/status
 * @access Private (Admin)
 */
const updateBarberStatus = async (req, res) => {
  // #swagger.tags = ['Auth']
  /* #swagger.description = 'Update the status of a barber (activated/deactivated). Only admin can perform this action.'
     #swagger.security = [{ "Bearer": [] }]
     #swagger.parameters['id'] = { in: 'path', description: 'Barber user ID', required: true, type: 'string' }
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
      return ErrorHandler("Barber ID is required.", 400, req, res);
    }
    if (!status || !["activated", "deactivated"].includes(status)) {
      return ErrorHandler(
        'Status must be "activated" or "deactivated".',
        400,
        req,
        res
      );
    }
    const barber = await User.findById(id);
    if (!barber || barber.role !== "barber") {
      return ErrorHandler("Barber not found.", 404, req, res);
    }
    barber.status = status;
    await barber.save();
    return SuccessHandler(barber, 200, res);
  } catch (error) {
    return ErrorHandler(error.message, 500, req, res);
  }
};

/**
 * @desc Get detailed info for a specific barber (admin or self)
 * @route GET /api/auth/barbers/:id
 * @access Private (Admin or Barber themselves)
 */
const getByID = async (req, res) => {
  // #swagger.tags = ['Auth']
  /* #swagger.description = 'Get detailed info for a specific barber, including total appointments, revenue, client insights, and business details.'
     #swagger.security = [{ "Bearer": [] }]
     #swagger.parameters['id'] = { in: 'path', description: 'Barber user ID', required: true, type: 'string' }
  */
  try {
    const { id } = req.params;
    // Only allow admin or the barber themselves
    if (req.user.role !== "admin" && req.user._id.toString() !== id) {
      return ErrorHandler("Forbidden", 403, req, res);
    }
    // Fetch barber
    const barber = await User.findById(id);
    if (!barber || barber.role !== "barber") {
      return ErrorHandler("Barber not found.", 404, req, res);
    }
    // Fetch business (if any)
    const business = await Business.findOne({ owner: barber._id });
    // Aggregate appointment data
    let totalAppointments = 0;
    let totalRevenue = 0;

    if (business) {
      // Total appointments for this business
      totalAppointments = await Appointment.countDocuments({
        business: business._id,
      });

      const revenueAgg = await getCanonicalRevenueTotalsByBusiness({
        businessIds: [business._id],
        paymentMatch: {
          status: { $in: ["captured", "refunded_partial", "refunded_full"] },
        },
      });
      totalRevenue = Number(revenueAgg[0]?.totalRevenue) || 0;
    }
    // Client insights: unique clients and top clients
    let clientAgg = [];
    if (business) {
      clientAgg = await Appointment.aggregate([
        { $match: { business: business._id } },
        { $group: { _id: "$client", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $limit: 5 },
        {
          $lookup: {
            from: "clients",
            localField: "_id",
            foreignField: "_id",
            as: "clientInfo",
          },
        },
        { $unwind: "$clientInfo" },
        {
          $project: {
            _id: 0,
            clientId: "$clientInfo._id",
            name: "$clientInfo.name",
            email: "$clientInfo.email",
            phone: "$clientInfo.phone",
            appointmentCount: "$count",
          },
        },
      ]);
    }
    // Response
    return SuccessHandler(
      {
        barber,
        business,
        totalAppointments,
        totalRevenue,
        topClients: clientAgg,
      },
      200,
      res
    );
  } catch (error) {
    return ErrorHandler(error.message, 500, req, res);
  }
};

/**
 * @desc Delete a barber (soft delete by setting isActive to false)
 * @route DELETE /api/auth/barbers/:barberId
 * @access Private (Admin)
 */
const deleteBarber = async (req, res) => {
  // #swagger.tags = ['Auth']
  /* #swagger.description = 'Soft delete a barber by setting isActive to false.'
         #swagger.security = [{ "Bearer": [] }]
      */
  try {
    const { id } = req.params;

    const barber = await User.findOne({
      _id: id,
    });
    if (!barber) {
      return ErrorHandler("Barber not found.", 404, req, res);
    }

    // Soft delete by setting isActive to false
    await User.findByIdAndUpdate(id, { isActive: false });

    return SuccessHandler(
      { message: "Barber deleted successfully." },
      200,
      res
    );
  } catch (error) {
    return ErrorHandler(error.message, 500, req, res);
  }
};

/**
 * @desc Create a new sub-admin
 * @route POST /api/auth/subadmins
 * @access Private (Admin only)
 */
const createSubadmin = async (req, res) => {
  // #swagger.tags = ['Subadmins']
  /* #swagger.description = 'Create a new sub-admin user.'
     #swagger.security = [{ "Bearer": [] }]
     #swagger.parameters['obj'] = {
        in: 'body',
        description: 'Subadmin details',
        required: true,
        schema: {
          name: 'Jane Doe',
          email: 'jane@example.com',
          password: 'password123',
          phone: '+1234567890',
          permissions: ['manageClients', 'viewReports']
        }
     }
  */
  try {
    const { name, email, password, phone, permissions = [] } = req.body;
    if (!name || !email || !password) {
      return ErrorHandler(
        "Name, email, and password are required.",
        400,
        req,
        res
      );
    }
    const existing = await User.findOne({ email });
    if (existing) {
      return ErrorHandler(
        "A user with this email already exists.",
        400,
        req,
        res
      );
    }
    const subadmin = new User({
      name,
      email,
      password,
      phone,
      role: "sub-admin",
      status: "activated",
      permissions,
    });
    await subadmin.save();
    return SuccessHandler(subadmin, 201, res);
  } catch (error) {
    return ErrorHandler(error.message, 500, req, res);
  }
};

/**
 * @desc Get all sub-admins with search, sorting, filtering, and pagination
 * @route GET /api/auth/subadmins
 * @access Private (Admin only)
 */
const getAllSubadmins = async (req, res) => {
  // #swagger.tags = ['Subadmins']
  /* #swagger.description = 'Get all sub-admin users with search, sorting, filtering by status, and pagination.'
     #swagger.security = [{ "Bearer": [] }]
     #swagger.parameters['status'] = { in: 'query', description: 'Filter by activation status (activated, deactivated)', type: 'string' }
     #swagger.parameters['sort'] = { in: 'query', description: 'Sort by field (e.g., name:asc, email:desc, role:asc)', type: 'string' }
     #swagger.parameters['search'] = { in: 'query', description: 'Search by name, email, or phone', type: 'string' }
     #swagger.parameters['page'] = { in: 'query', description: 'Page number for pagination', type: 'integer' }
     #swagger.parameters['limit'] = { in: 'query', description: 'Number of items per page', type: 'integer' }
  */
  try {
    const { status, sort, search, page = 1, limit = 10 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    let baseQuery = { role: "sub-admin", isActive: true };
    if (status && ["activated", "deactivated"].includes(status)) {
      baseQuery.status = status;
    }
    if (search) {
      baseQuery.$or = [
        { name: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
        { phone: { $regex: search, $options: "i" } },
      ];
    }
    let sortObj = {};
    if (sort) {
      const [field, direction] = sort.split(":");
      if (["name", "email", "role"].includes(field)) {
        sortObj[field] = direction === "desc" ? -1 : 1;
      }
    } else {
      sortObj["name"] = 1;
    }
    const subadmins = await User.find(baseQuery)
      .sort(sortObj)
      .skip(skip)
      .limit(parseInt(limit));
    const total = await User.countDocuments(baseQuery);
    return SuccessHandler(
      {
        subadmins,
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
 * @desc Get a sub-admin by ID
 * @route GET /api/auth/subadmins/:id
 * @access Private (Admin only)
 */
const getSubadminById = async (req, res) => {
  // #swagger.tags = ['Subadmins']
  /* #swagger.description = 'Get a sub-admin user by ID.'
     #swagger.security = [{ "Bearer": [] }]
  */
  try {
    const { id } = req.params;
    const subadmin = await User.findOne({ _id: id, role: "sub-admin" });
    if (!subadmin) {
      return ErrorHandler("Sub-admin not found.", 404, req, res);
    }
    return SuccessHandler(subadmin, 200, res);
  } catch (error) {
    return ErrorHandler(error.message, 500, req, res);
  }
};

/**
 * @desc Update a sub-admin
 * @route PUT /api/auth/subadmins/:id
 * @access Private (Admin only)
 */
const updateSubadmin = async (req, res) => {
  // #swagger.tags = ['Subadmins']
  /* #swagger.description = 'Update a sub-admin user.'
     #swagger.security = [{ "Bearer": [] }]
  */
  try {
    const { id } = req.params;
    const updates = req.body;
    // Prevent role change to anything other than sub-admin
    if (updates.role && updates.role !== "sub-admin") {
      return ErrorHandler("Role cannot be changed.", 400, req, res);
    }
    const subadmin = await User.findOneAndUpdate(
      { _id: id, role: "sub-admin" },
      updates,
      { new: true, runValidators: true }
    );
    if (!subadmin) {
      return ErrorHandler("Sub-admin not found.", 404, req, res);
    }
    return SuccessHandler(subadmin, 200, res);
  } catch (error) {
    return ErrorHandler(error.message, 500, req, res);
  }
};

/**
 * @desc Delete a sub-admin (soft delete by setting isActive to false)
 * @route DELETE /api/auth/subadmins/:id
 * @access Private (Admin only)
 */
const deleteSubadmin = async (req, res) => {
  // #swagger.tags = ['Subadmins']
  /* #swagger.description = 'Soft delete a sub-admin by setting isActive to false.'
     #swagger.security = [{ "Bearer": [] }]
  */
  try {
    const { id } = req.params;
    const subadmin = await User.findOne({ _id: id, role: "sub-admin" });
    if (!subadmin) {
      return ErrorHandler("Sub-admin not found.", 404, req, res);
    }
    await User.findByIdAndUpdate(id, { isActive: false });
    return SuccessHandler(
      { message: "Sub-admin deleted successfully." },
      200,
      res
    );
  } catch (error) {
    return ErrorHandler(error.message, 500, req, res);
  }
};

/**
 * @desc Get user profile settings
 * @route GET /api/auth/profile-settings
 * @access Private (Authenticated user)
 */
const getProfileSettings = async (req, res) => {
  // #swagger.tags = ['Auth']
  /* #swagger.description = 'Get current user profile settings including notification preferences'
     #swagger.security = [{ "Bearer": [] }]
     #swagger.responses[200] = {
        description: 'Profile settings retrieved successfully',
        schema: {
          _id: 'user_id',
          name: 'John Doe',
          email: 'john@example.com',
          phone: '+1234567890',
          profileImage: 'https://example.com/profile.jpg',
          country: 'United States',
          zip: '10001',
          isNotificationEnabled: true,
          notificationSettings: {
            barberRegistration: true,
            subscriptionExpiry: true,
            bookingSpike: true
          }
        }
     }
  */
  try {
    const user = await User.findById(req.user._id).select(
      "-password -passwordResetToken -passwordResetTokenExpires -pendingPenalties"
    );

    if (!user) {
      return ErrorHandler("User not found", 404, req, res);
    }

    return SuccessHandler(user, 200, res);
  } catch (error) {
    return ErrorHandler(error.message, 500, req, res);
  }
};

/**
 * @desc Update user profile settings
 * @route PUT /api/auth/profile-settings
 * @access Private (Authenticated user)
 */
const updateProfileSettings = async (req, res) => {
  // #swagger.tags = ['Auth']
  /* #swagger.description = 'Update user profile settings including profile image, name, password, and notification preferences'
     #swagger.security = [{ "Bearer": [] }]
     #swagger.consumes = ['multipart/form-data']
     #swagger.parameters['profileImage'] = {
        in: 'formData',
        type: 'file',
        description: 'Profile image file'
     }
     #swagger.parameters['firstName'] = {
        in: 'formData',
        type: 'string',
        description: 'User first name'
     }
     #swagger.parameters['lastName'] = {
        in: 'formData',
        type: 'string',
        description: 'User last name'
     }
     #swagger.parameters['phone'] = {
        in: 'formData',
        type: 'string',
        description: 'User phone number'
     }
     #swagger.parameters['country'] = {
        in: 'formData',
        type: 'string',
        description: 'User country'
     }
     #swagger.parameters['zip'] = {
        in: 'formData',
        type: 'string',
        description: 'User ZIP/postal code'
     }
     #swagger.parameters['currentPassword'] = {
        in: 'formData',
        type: 'string',
        description: 'Current password (required if changing password)'
     }
     #swagger.parameters['newPassword'] = {
        in: 'formData',
        type: 'string',
        description: 'New password'
     }
     #swagger.parameters['confirmPassword'] = {
        in: 'formData',
        type: 'string',
        description: 'Confirm new password'
     }
     #swagger.parameters['isNotificationEnabled'] = {
        in: 'formData',
        type: 'boolean',
        description: 'Enable/disable all notifications'
     }
     #swagger.parameters['barberRegistration'] = {
        in: 'formData',
        type: 'boolean',
        description: 'Enable notifications for barber registration'
     }
     #swagger.parameters['subscriptionExpiry'] = {
        in: 'formData',
        type: 'boolean',
        description: 'Enable notifications for subscription expiry/cancellation'
     }
     #swagger.parameters['bookingSpike'] = {
        in: 'formData',
        type: 'boolean',
        description: 'Enable notifications for booking spikes'
     }
     #swagger.parameters['language'] = {
        in: 'formData',
        type: 'string',
        description: 'User preferred language code (e.g., en, es, fr)'
     }
     #swagger.responses[200] = {
        description: 'Profile settings updated successfully',
        schema: { $ref: '#/definitions/User' }
     }
     #swagger.responses[400] = {
        description: 'Validation error or invalid current password'
     }
  */
  try {
    console.log("updateProfileSettings called");
    console.log("req.body:", req.body);
    console.log("req.files:", req.files);
    console.log("req.user:", req.user);
    const {
      firstName,
      lastName,
      newPassword,
      currentPassword,
      confirmPassword,
      isNotificationEnabled,
      barberRegistration,
      subscriptionExpiry,
      bookingSpike,
      removeProfileImage,
      language,
    } = req.body;

    const user = await User.findById(req.user._id);
    if (!user) {
      return ErrorHandler("User not found", 404, req, res);
    }

    const updateData = {};

    // Handle profile image removal
    if (removeProfileImage === "true" || removeProfileImage === true) {
      console.log("Removing profile image");
      // Delete old profile image if exists
      if (user.profileImage) {
        try {
          await deleteImage(user.profileImage);
          console.log("Old profile image deleted successfully");
        } catch (deleteError) {
          console.error("Error deleting old profile image:", deleteError);
        }
      }
      updateData.profileImage = null;
    }
    // Handle profile image upload
    else if (req.files && req.files?.profileImage?.[0]) {
      console.log("Uploading new profile image");
      const img = req.files.profileImage[0];
      console.log("Image details:", {
        name: img.originalname,
        size: img.size,
        mimetype: img.mimetype,
      });

      try {
        const filePath = `${Date.now()}-${path.parse(img?.originalname)?.name}`;
        console.log("Uploading to cloudinary with path:", filePath);

        const url = await uploadToCloudinary(
          img.buffer,
          "profile-images",
          "image"
        );
        console.log("Upload successful, URL:", url.secure_url);

        // Delete old profile image if exists
        if (user.profileImage) {
          try {
            await deleteImage(user.profileImage);
            console.log("Old profile image deleted successfully");
          } catch (deleteError) {
            console.error("Error deleting old profile image:", deleteError);
          }
        }

        updateData.profileImage = url.secure_url;
      } catch (uploadError) {
        console.error("Error uploading profile image:", uploadError);
        return ErrorHandler("Failed to upload profile image", 500, req, res);
      }
    }

    // Handle name update
    if (firstName || lastName) {
      const currentName = user.name || "";
      const nameParts = currentName.split(" ");
      const newFirstName = firstName || nameParts[0] || "";
      const newLastName = lastName || nameParts[1] || "";
      updateData.name = `${newFirstName} ${newLastName}`.trim();
    }

    // Handle password change
    if (newPassword) {
      if (!currentPassword) {
        return ErrorHandler(
          "Current password is required to change password",
          400,
          req,
          res
        );
      }

      const isCurrentPasswordValid = await user.comparePassword(
        currentPassword
      );
      if (!isCurrentPasswordValid) {
        return ErrorHandler("Current password is incorrect", 400, req, res);
      }

      if (newPassword !== confirmPassword) {
        return ErrorHandler(
          "New password and confirm password do not match",
          400,
          req,
          res
        );
      }

      if (newPassword.length < 6) {
        return ErrorHandler(
          "Password must be at least 6 characters long",
          400,
          req,
          res
        );
      }

      // Hash the password before saving (since findByIdAndUpdate bypasses pre-save hooks)
      const salt = await bcrypt.genSalt(10);
      const hashedPassword = await bcrypt.hash(newPassword, salt);
      updateData.password = hashedPassword;
    }

    // Handle notification settings
    if (isNotificationEnabled !== undefined) {
      updateData.isNotificationEnabled = isNotificationEnabled;
    }

    // Handle specific notification preferences
    if (
      barberRegistration !== undefined ||
      subscriptionExpiry !== undefined ||
      bookingSpike !== undefined
    ) {
      updateData.notificationSettings = {
        ...user.notificationSettings,
        ...(barberRegistration !== undefined && { barberRegistration }),
        ...(subscriptionExpiry !== undefined && { subscriptionExpiry }),
        ...(bookingSpike !== undefined && { bookingSpike }),
      };
    }

    // Handle language preference
    if (language !== undefined) {
      updateData.language = language;
    }

    // Update user
    const updatedUser = await User.findByIdAndUpdate(req.user._id, updateData, {
      new: true,
      runValidators: true,
    }).select(
      "-password -passwordResetToken -passwordResetTokenExpires -pendingPenalties"
    );

    console.log("Profile update successful, returning user:", updatedUser);
    return SuccessHandler(updatedUser, 200, res);
  } catch (error) {
    console.error("Error in updateProfileSettings:", error);
    console.error("Error stack:", error.stack);
    return ErrorHandler(error.message, 500, req, res);
  }
};

/**
 * @desc Update notification settings only
 * @route PATCH /api/auth/notification-settings
 * @access Private (Authenticated user)
 */
const updateNotificationSettings = async (req, res) => {
  // #swagger.tags = ['Auth']
  /* #swagger.description = 'Update user notification settings only'
     #swagger.security = [{ "Bearer": [] }]
     #swagger.parameters['obj'] = {
        in: 'body',
        description: 'Notification settings to update',
        required: true,
        schema: {
          isNotificationEnabled: true,
          barberRegistration: true,
          subscriptionExpiry: true,
          bookingSpike: true
        }
     }
     #swagger.responses[200] = {
        description: 'Notification settings updated successfully'
     }
  */
  try {
    const {
      isNotificationEnabled,
      barberRegistration,
      subscriptionExpiry,
      bookingSpike,
    } = req.body;

    const user = await User.findById(req.user._id);
    if (!user) {
      return ErrorHandler("User not found", 404, req, res);
    }

    const updateData = {};

    if (isNotificationEnabled !== undefined) {
      updateData.isNotificationEnabled = isNotificationEnabled;
    }

    if (
      barberRegistration !== undefined ||
      subscriptionExpiry !== undefined ||
      bookingSpike !== undefined
    ) {
      updateData.notificationSettings = {
        ...user.notificationSettings,
        ...(barberRegistration !== undefined && { barberRegistration }),
        ...(subscriptionExpiry !== undefined && { subscriptionExpiry }),
        ...(bookingSpike !== undefined && { bookingSpike }),
      };
    }

    const updatedUser = await User.findByIdAndUpdate(req.user._id, updateData, {
      new: true,
    }).select(
      "-password -passwordResetToken -passwordResetTokenExpires -pendingPenalties"
    );

    return SuccessHandler(updatedUser, 200, res);
  } catch (error) {
    return ErrorHandler(error.message, 500, req, res);
  }
};

const logout = async (req, res) => {
  try {
    const isProduction = process.env.NODE_ENV === 'production' || 
                         process.env.VERCEL === '1' || 
                         process.env.RAILWAY_ENVIRONMENT === 'production';
    
    const cookieOptions = {
      path: '/',
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? 'none' : 'lax'
    };
    
    const userType = req.body?.userType || req.query?.userType;
    let cookieToClear = null;
    
    if (userType === 'admin') {
      cookieToClear = 'adminToken';
    } else if (userType === 'client') {
      cookieToClear = 'clientToken';
    } else {
      cookieToClear = 'userToken';
    }
    
    res.clearCookie(cookieToClear, cookieOptions);
    
    return SuccessHandler(
      { message: "Logged out successfully", clearedCookie: cookieToClear },
      200,
      res
    );
  } catch (error) {
    return ErrorHandler(error.message, 500, req, res);
  }
};

module.exports = {
  register,
  login,
  logout,
  forgotPassword,
  resetPassword,
  updatePassword,
  getMe,
  // updateProfile,
  // updateAdminProfile,
  socialAuth,
  getBarber,
  updateBarberStatus,
  getByID,
  deleteBarber,
  createSubadmin,
  getAllSubadmins,
  getSubadminById,
  updateSubadmin,
  deleteSubadmin,
  getProfileSettings,
  updateProfileSettings,
  updateNotificationSettings,
};
