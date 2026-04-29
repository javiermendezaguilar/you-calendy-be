const mongoose = require("mongoose");
const Appointment = require("../models/appointment");
const Business = require("../models/User/business");
const Service = require("../models/service");
const User = require("../models/User/user");
const SuccessHandler = require("../utils/SuccessHandler");
const ErrorHandler = require("../utils/ErrorHandler");
const { uploadFiles, deleteFile } = require("../utils/aws");
const sendMail = require("../utils/sendMail");
const sendNotification = require("../utils/pushNotification");
const clientNotification = require("../utils/clientNotification");
const {
  sendNotificationToAdmins,
} = require("../utils/adminNotificationHelper");
const moment = require("moment");
const Staff = require("../models/staff");
const Promotion = require("../models/promotion");
const FlashSale = require("../models/flashSale");
const Client = require("../models/client");
const Auditing = require("../models/auditing");
const { uploadToCloudinary } = require("../functions/cloudinary");
const { sendSMS } = require("../utils/twilio");
const ClientModel = require("../models/client");
const { sendSMSWithCredits } = require("../utils/creditAwareMessaging");
const { getComparablePhone } = require("../utils/index");
const {
  buildDateRangeClause,
  getCanonicalRevenueProjection,
} = require("../services/payment/revenueProjection");
const {
  getExpectedPolicyFeeForAppointment,
  resolveCancellationOutcome,
  resolveNoShowOutcome,
  toBoolean,
} = require("../services/appointment/policyOutcomeService");
const {
  findCapacityConflict,
  runWithCapacityGuard,
} = require("../services/appointment/capacityGuard");
const {
  getAvailabilityForBusiness,
} = require("../services/appointment/availabilityService");
const {
  getSemanticStateFromLegacyStatus,
  isTerminalAppointmentState,
} = require("../services/appointment/stateService");
const {
  resolveCanonicalServiceForBusiness,
} = require("../services/business/serviceService");
const { recordDomainEvent } = require("../services/domainEventService");

const buildAppointmentSemanticState = (status, overrides = {}) =>
  getSemanticStateFromLegacyStatus(status, overrides);

const buildBookingEventPayload = (appointment, extra = {}) => ({
  appointmentId: appointment._id,
  clientId:
    appointment.client && typeof appointment.client === "object"
      ? appointment.client._id || appointment.client
      : appointment.client,
  serviceId:
    appointment.service && typeof appointment.service === "object"
      ? appointment.service._id || appointment.service
      : appointment.service,
  staffId:
    appointment.staff && typeof appointment.staff === "object"
      ? appointment.staff._id || appointment.staff
      : appointment.staff || null,
  date: appointment.date,
  startTime: appointment.startTime,
  endTime: appointment.endTime,
  status: appointment.status,
  bookingStatus: appointment.bookingStatus,
  visitType: appointment.visitType,
  ...extra,
});

const applyWalkInQueueStatusForLegacyStatus = (
  appointment,
  status,
  occurredAt = new Date()
) => {
  if (appointment.visitType !== "walk_in") {
    return;
  }

  if (status === "Completed") {
    appointment.queueStatus = "completed";
    appointment.queueLeftAt = appointment.queueLeftAt || occurredAt;
    appointment.queueOutcomeReason =
      appointment.queueOutcomeReason || "completed";
    return;
  }

  if (status === "Canceled") {
    appointment.queueStatus =
      appointment.queueStatus === "abandoned" ? "abandoned" : "cancelled";
    appointment.queueLeftAt = appointment.queueLeftAt || occurredAt;
    appointment.queueOutcomeReason =
      appointment.queueOutcomeReason || appointment.queueStatus;
  }
};

const normalizeEmail = (email) => String(email || "").trim().toLowerCase();

const PLATFORM_ADMIN_ROLES = new Set(["admin", "sub-admin"]);

const getActorId = (user) => String(user?.id || user?._id || "");

const isClientActor = (user) =>
  user?.type === "client" || user?.role === "client";

const canManageBusinessAppointments = (user, business) => {
  if (!user || !business || isClientActor(user)) {
    return false;
  }

  if (PLATFORM_ADMIN_ROLES.has(user.role)) {
    return false;
  }

  return business.owner?.toString() === getActorId(user);
};

const getAppointmentBusinessContext = async (appointment, user) => {
  const business = await Business.findById(appointment.business);
  const isBusinessOwner = canManageBusinessAppointments(user, business);

  return {
    business,
    isBusinessOwner,
  };
};

const getOperationalAppointmentContext = async (appointment, user) => {
  const { business, isBusinessOwner } = await getAppointmentBusinessContext(
    appointment,
    user
  );

  let assignedStaff = null;
  if (!isBusinessOwner && appointment.staff && user?.email) {
    assignedStaff = await Staff.findOne({
      _id: appointment.staff,
      business: appointment.business,
      email: normalizeEmail(user.email),
    }).select("_id business email");
  }

  return {
    business,
    isBusinessOwner,
    isAssignedStaff: Boolean(assignedStaff),
    assignedStaff,
  };
};

const getOperationalAppointmentForUser = async (appointmentId, user) => {
  const appointment = await Appointment.findById(appointmentId);
  if (!appointment) {
    return { error: { message: "Appointment not found", status: 404 } };
  }

  const { isBusinessOwner, isAssignedStaff } =
    await getOperationalAppointmentContext(appointment, user);

  if (!isBusinessOwner && !isAssignedStaff) {
    return {
      error: {
        message: "Not authorized to manage this appointment operationally",
        status: 403,
      },
    };
  }

  return { appointment };
};

/**
 * @desc Create a new appointment
 * @route POST /api/appointments
 * @access Private
 */
const createAppointment = async (req, res) => {
  // #swagger.tags = ['Appointments']
  /* #swagger.description = 'Create a new appointment'
     #swagger.security = [{ "Bearer": [] }]
     #swagger.parameters['obj'] = {
        in: 'body',
        description: 'Appointment information',
        required: true,
        schema: {
          businessId: 'business_id',
          clientId: 'client_id',
          serviceId: 'service_id',
          staffId: 'staff_id_if_any (Optional)',
          date: '2025-03-15',
          startTime: '10:00',
          duration: 30,
          notes: 'Optional notes',
          clientNotes: 'Optional client notes'
        }
     }
     #swagger.responses[201] = {
        description: 'Appointment created successfully',
        schema: { $ref: '#/definitions/Appointment' }
     }
     #swagger.responses[404] = {
        description: 'Business, Client, Service, or Staff not found'
     }
     #swagger.responses[409] = {
        description: 'Time slot is not available'
     }
  */
  try {
    const {
      businessId,
      clientId,
      serviceId,
      staffId,
      date,
      startTime: rawStartTime,
      duration,
      notes,
      // clientNotes,
    } = req.body;

    if (!rawStartTime) {
      return ErrorHandler("Start time is required", 400, req, res);
    }

    const parsedTime = (() => {
      const trimmed = String(rawStartTime).trim();
      const match = trimmed.match(/^(\d{1,2}):(\d{2})(?:\s*(AM|PM))?$/i);
      if (!match) {
        return null;
      }

      let hour = parseInt(match[1], 10);
      const minute = parseInt(match[2], 10);
      const period = match[3]?.toUpperCase();

      if (
        Number.isNaN(hour) ||
        Number.isNaN(minute) ||
        minute < 0 ||
        minute > 59
      ) {
        return null;
      }

      if (period) {
        if (hour < 1 || hour > 12) {
          return null;
        }
        if (period === "PM" && hour !== 12) {
          hour += 12;
        }
        if (period === "AM" && hour === 12) {
          hour = 0;
        }
      } else if (hour > 23) {
        return null;
      }

      return {
        hour,
        minute,
        normalized: `${hour.toString().padStart(2, "0")}:${minute
          .toString()
          .padStart(2, "0")}`,
      };
    })();

    if (!parsedTime) {
      return ErrorHandler(
        "Invalid start time format. Use HH:MM or HH:MM AM/PM",
        400,
        req,
        res
      );
    }

    const {
      hour: startHour,
      minute: startMinute,
      normalized: startTime,
    } = parsedTime;

    // Handle client authentication - if authenticated as client, identify their specific client record for this business
    let actualClientId = clientId;
    if (req.user && isClientActor(req.user)) {
      actualClientId = req.user._id;

      // Verify the client is trying to book for themselves
      if (clientId && clientId.toString() !== actualClientId.toString()) {
        return ErrorHandler(
          "You can only book appointments for yourself",
          403,
          req,
          res
        );
      }
    }

    // Validate business and service
    const business = await Business.findById(businessId);
    if (!business) {
      return ErrorHandler("Business not found", 404, req, res);
    }

    if (
      !isClientActor(req.user) &&
      !canManageBusinessAppointments(req.user, business)
    ) {
      return ErrorHandler(
        "Not authorized to create appointments for this business",
        403,
        req,
        res
      );
    }

    // Validate client
    const client = await Client.findById(actualClientId);
    if (!client) {
      return ErrorHandler("Client not found", 404, req, res);
    }

    // Ensure client belongs to the business
    if (client.business.toString() !== businessId) {
      return ErrorHandler(
        "Client does not belong to this business",
        403,
        req,
        res
      );
    }
    // Determine if caller is staff or owner (who are allowed to bypass the automated block)
    const isBusinessCaller = canManageBusinessAppointments(req.user, business);

    // Hard enforcement of the no-show block for non-business users
    if (!isBusinessCaller && actualClientId) {
      const comparablePhone = getComparablePhone(client.phone);
      const orConditions = [{ _id: actualClientId }];
      
      if (comparablePhone && comparablePhone.length > 0) {
        orConditions.push({ phoneComparable: comparablePhone });
      }
      if (client.email && client.email.length > 0) {
        orConditions.push({ email: client.email.toLowerCase() });
      }

      const clientRegistrationQuery = {
        business: businessId,
        $or: orConditions
      };

      const allPotentialClients = await Client.find(clientRegistrationQuery);
      const blockedClient = allPotentialClients.find(c => c.appBookingBlocked === true);

      if (blockedClient) {
        const noShowDate = blockedClient.lastNoShowDate 
          ? moment(blockedClient.lastNoShowDate).format("DD/MM/YYYY")
          : "your last appointment";
          
        const businessPhone = business?.contactInfo?.phone || business?.phone || "your barber";
        
        return ErrorHandler(
          `If you are unable to attend an appointment, please cancel in advance by phone. Due to an unexcused no-show on ${noShowDate}, future appointments must be requested personally by calling ${businessPhone}.`,
          403,
          req,
          res
        );
      }
    }


    const service = await resolveCanonicalServiceForBusiness(
      business,
      serviceId
    );
    if (!service) {
      return ErrorHandler(
        "Service not found or doesn't belong to this business",
        404,
        req,
        res
      );
    }

    const hasAssignedStaffForPublic = await Staff.exists({
      business: businessId,
      services: { $elemMatch: { service: serviceId } },
    });
    if (!hasAssignedStaffForPublic) {
      return ErrorHandler(
        "This service is not assigned to any staff till now",
        400,
        req,
        res
      );
    }

    const hasAssignedStaffGlobal = await Staff.exists({
      business: businessId,
      services: { $elemMatch: { service: serviceId } },
    });
    if (!hasAssignedStaffGlobal) {
      return ErrorHandler(
        "This service is not assigned to any staff till now",
        400,
        req,
        res
      );
    }

    // Validate Staff Member if provided
    let staffMember = null;
    if (staffId) {
      staffMember = await Staff.findOne({
        _id: staffId,
        business: businessId,
      });
      if (!staffMember) {
        return ErrorHandler(
          "Staff member not found or does not belong to this business.",
          404,
          req,
          res
        );
      }
      const staffServiceItem = staffMember.services.find(
        (s) => s.service.toString() === serviceId
      );
      if (!staffServiceItem) {
        return ErrorHandler(
          "Selected service is not assigned to the specified staff member",
          400,
          req,
          res
        );
      }
    }

    // Validate and parse start time
    const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/;
    if (!startTime || !timeRegex.test(startTime)) {
      return ErrorHandler(
        "Invalid start time format. Use HH:MM",
        400,
        req,
        res
      );
    }
    const [hours, minutes] = startTime.split(":");

    // Check if appointment time is in the past
    const createAppointmentDateTime = new Date(date);
    createAppointmentDateTime.setHours(startHour);
    createAppointmentDateTime.setMinutes(startMinute);
    createAppointmentDateTime.setSeconds(0, 0); // Reset seconds and milliseconds for accurate comparison

    const createCurrentTime = new Date();
    createCurrentTime.setSeconds(0, 0); // Reset seconds and milliseconds for accurate comparison

    if (createAppointmentDateTime <= createCurrentTime) {
      return ErrorHandler(
        "Cannot book appointments in the past. Please select a future time slot.",
        400,
        req,
        res
      );
    }

    // Check booking buffer if staff member is specified (only for today's appointments)
    // Buffer is applied relative to current time, not shift start time
    if (staffMember && staffMember.bookingBuffer > 0) {
      const appointmentDateOnly = new Date(date);
      appointmentDateOnly.setHours(0, 0, 0, 0);
      const todayDateOnly = new Date();
      todayDateOnly.setHours(0, 0, 0, 0);
      const isToday = appointmentDateOnly.getTime() === todayDateOnly.getTime();

      // Only apply buffer for today's appointments
      // For future dates, there's already sufficient advance notice
      if (isToday) {
        const timeDifference =
          createAppointmentDateTime.getTime() - createCurrentTime.getTime();
        const minutesDifference = Math.floor(timeDifference / (1000 * 60));

        if (minutesDifference < staffMember.bookingBuffer) {
          return ErrorHandler(
            `This appointment must be booked at least ${staffMember.bookingBuffer} minutes in advance. Current time difference: ${minutesDifference} minutes.`,
            400,
            req,
            res
          );
        }
      }
    }

    // Calculate end time
    const startDateTime = new Date(date);
    startDateTime.setHours(startHour);
    startDateTime.setMinutes(startMinute);

    const endDateTime = new Date(startDateTime);
    // Calculate duration in minutes - use provided duration or get from staff-service relationship
    let serviceDurationMinutes = duration;

    if (!serviceDurationMinutes && staffId) {
      // If no duration provided and staff is specified, get from staff-service relationship
      const staff = await Staff.findById(staffId);
      if (staff) {
        const serviceItem = staff.services.find(
          (s) => s.service.toString() === serviceId
        );
        if (serviceItem) {
          serviceDurationMinutes = serviceItem.timeInterval;
        }
      }
    }

    // Fallback to default duration if still not found
    if (!serviceDurationMinutes) {
      serviceDurationMinutes = 60; // Default 60 minutes
    }
    endDateTime.setMinutes(endDateTime.getMinutes() + serviceDurationMinutes);

    const endTime = `${endDateTime
      .getHours()
      .toString()
      .padStart(2, "0")}:${endDateTime
        .getMinutes()
        .toString()
        .padStart(2, "0")}`;

    const capacityConflictMessage = staffId
      ? "This staff member is not available at the selected time."
      : "This time slot is not available.";
    const conflictingAppointment = await findCapacityConflict({
      businessId,
      staffId: staffId || null,
      date,
      startTime,
      endTime,
    });

    if (conflictingAppointment) {
      return ErrorHandler(capacityConflictMessage, 409, req, res);
    }

    // Handle reference photos if any
    let referencePhotos = [];

    if (req.files && req.files.length > 0) {
      const uploadPromises = req.files.map((photo) =>
        uploadToCloudinary(photo.buffer, "appointment-photos")
      );
      const uploadResults = await Promise.all(uploadPromises);
      referencePhotos = uploadResults.map((result) => ({
        url: result.secure_url,
        public_id: result.public_id,
      }));
    }

    // Get default reminder settings from business
    const defaultReminderSettings = business.defaultReminderSettings || {};

    // Create appointment data object
    const newAppointmentData = {
      client: actualClientId,
      business: businessId,
      service: serviceId,
      staff: staffId || null,
      date: new Date(date),
      startTime,
      endTime,
      duration: serviceDurationMinutes,
      price: service.price,
      notes,
      // clientNotes,
      referencePhotos,
      status: "Pending",
      ...buildAppointmentSemanticState("Pending"),
      visitType: "appointment",
      policySnapshot: Appointment.buildPolicySnapshot(business),
      // Apply default reminder settings if they exist
      appointmentReminder: defaultReminderSettings.appointmentReminder || false,
      reminderTime: defaultReminderSettings.reminderTime || null,
      messageReminder: defaultReminderSettings.messageReminder || "",
    };

    // Check for active promotions
    const appointmentDate = new Date(date);
    const dayOfWeek = appointmentDate
      .toLocaleDateString("en-US", {
        weekday: "long",
      })
      .toLowerCase();

    // Convert serviceId to string for comparison (services in promotion are stored as ObjectIds)
    const serviceIdString = serviceId.toString();

    const activePromotions = await Promotion.find({
      business: businessId,
      dayOfWeek,
      isActive: true,
      services: serviceIdString,
    });

    // Check if the appointment time falls within any promotion hours
    let appliedPromotion = null;
    for (const promotion of activePromotions) {
      if (promotion.isTimeSlotInPromotion(startTime)) {
        appliedPromotion = promotion;
        break; // Use the first applicable promotion
      }
    }

    // Apply promotion if found
    if (appliedPromotion) {
      const originalPrice = service.price;
      const discountedPrice =
        appliedPromotion.calculateDiscountedPrice(originalPrice);
      const discountAmount = originalPrice - discountedPrice;

      newAppointmentData.price = discountedPrice;
      newAppointmentData.promotion = {
        applied: true,
        promotionId: appliedPromotion._id,
        originalPrice,
        discountAmount,
        discountPercentage: appliedPromotion.discountPercentage,
      };
    } else {
      // Explicitly set promotion defaults if no promotion is found
      newAppointmentData.promotion = {
        applied: false,
        promotionId: null,
        originalPrice: 0,
        discountAmount: 0,
        discountPercentage: 0,
      };
    }

    // Check for active flash sales
    const flashSaleAppointmentDateTime = new Date(date);
    flashSaleAppointmentDateTime.setHours(startHour);
    flashSaleAppointmentDateTime.setMinutes(startMinute);
    flashSaleAppointmentDateTime.setSeconds(0, 0);
    flashSaleAppointmentDateTime.setMilliseconds(0);

    const activeFlashSales = await FlashSale.find({
      business: businessId,
      isActive: true,
      startDate: { $lte: flashSaleAppointmentDateTime },
      endDate: { $gte: flashSaleAppointmentDateTime },
    });

    // Apply flash sale if found
    if (activeFlashSales.length > 0) {
      const appliedFlashSale = activeFlashSales[0]; // Use the first active flash sale

      // Check if promotion has applyBothDiscounts flag set
      const shouldApplyBoth = appliedPromotion?.applyBothDiscounts === true;
      const shouldSkipFlashSale = appliedPromotion?.applyBothDiscounts === false && newAppointmentData.promotion?.applied;

      if (shouldApplyBoth && newAppointmentData.promotion?.applied) {
        // Apply both discounts: flash sale on top of promotion discount
        const promotionDiscountedPrice = newAppointmentData.price;
        const flashSaleDiscountedPrice =
          appliedFlashSale.calculateDiscountedPrice(promotionDiscountedPrice);
        const flashSaleDiscountAmount = promotionDiscountedPrice - flashSaleDiscountedPrice;
        const totalDiscountAmount = service.price - flashSaleDiscountedPrice;

        newAppointmentData.price = flashSaleDiscountedPrice;
        newAppointmentData.flashSale = {
          applied: true,
          flashSaleId: appliedFlashSale._id,
          originalPrice: promotionDiscountedPrice, // Price after promotion discount
          discountAmount: flashSaleDiscountAmount,
          discountPercentage: appliedFlashSale.discountPercentage,
        };
        // Keep promotion data as is
      } else if (shouldSkipFlashSale) {
        // Promotion has applyBothDiscounts: false, so skip flash sale and keep only promotion
        // Don't apply flash sale - promotion discount only
        newAppointmentData.flashSale = {
          applied: false,
          flashSaleId: null,
          originalPrice: 0,
          discountAmount: 0,
          discountPercentage: 0,
        };
        // Keep promotion data as is (already set above)
      } else {
        // No promotion or promotion doesn't have applyBothDiscounts flag set
        // Flash sale takes precedence over promotion (default behavior)
        const originalPrice = newAppointmentData.promotion?.applied
          ? newAppointmentData.promotion.originalPrice
          : service.price;
        const discountedPrice =
          appliedFlashSale.calculateDiscountedPrice(originalPrice);
        const discountAmount = originalPrice - discountedPrice;

        newAppointmentData.price = discountedPrice;
        newAppointmentData.flashSale = {
          applied: true,
          flashSaleId: appliedFlashSale._id,
          originalPrice,
          discountAmount,
          discountPercentage: appliedFlashSale.discountPercentage,
        };

        // If there was a promotion applied, remove it since flash sale takes precedence
        if (newAppointmentData.promotion?.applied) {
          newAppointmentData.promotion = {
            applied: false,
            originalPrice: 0,
            discountAmount: 0,
            discountPercentage: 0,
          };
        }
      }
    } else {
      // No flash sale found - set flash sale data to defaults
      newAppointmentData.flashSale = {
        applied: false,
        flashSaleId: null,
        originalPrice: 0,
        discountAmount: 0,
        discountPercentage: 0,
      };
    }


    // Check for pending penalties and apply them
    const user = await User.findById(clientId);
    if (user && user.pendingPenalties) {
      const pendingPenalties = user.pendingPenalties.filter(
        (penalty) =>
          penalty.business.toString() === businessId && !penalty.applied
      );

      if (pendingPenalties.length > 0) {
        const totalPenaltyAmount = pendingPenalties.reduce(
          (sum, penalty) => sum + penalty.amount,
          0
        );
        newAppointmentData.penalty = {
          applied: true,
          amount: totalPenaltyAmount,
          paid: false,
          notes: `Applied from ${pendingPenalties.length} missed appointment penalty(ies)`,
        };

        // Mark penalties as applied
        pendingPenalties.forEach((penalty) => {
          penalty.applied = true;
          penalty.appliedToAppointment = newAppointmentData._id;
        });

        await user.save();
      }
    }

    const newAppointment = await runWithCapacityGuard({
      businessId,
      staffId: staffId || null,
      date,
      startTime,
      endTime,
      conflictMessage: capacityConflictMessage,
      operation: async ({ session }) => {
        const [createdAppointment] = await Appointment.create(
          [newAppointmentData],
          { session }
        );
        return createdAppointment;
      },
    });
    await recordDomainEvent({
      type: "booking_created",
      actorId: req.user._id || req.user.id,
      shopId: business._id,
      correlationId: newAppointment._id,
      payload: buildBookingEventPayload(newAppointment, {
        source: "client_booking",
      }),
    });

    // Populate the appointment with related data for response
    const populatedAppointment = await Appointment.findById(newAppointment._id)
      .populate("client", "firstName lastName email phone")
      .populate("business", "name contactInfo.phone")
      .populate("staff", "firstName lastName");

    populatedAppointment.service = {
      _id: service._id,
      name: service.name,
      duration: service.duration,
      price: service.price,
    };

    // Send notification to the client (using Client model, not User)
    // This works for clients who book via the public booking page
    if (clientId) {
      try {
        const serviceName = populatedAppointment.service?.name || 'your service';
        await clientNotification(
          clientId,
          "Appointment Confirmed",
          `Your appointment for ${serviceName} on ${moment(date).format("MMM DD, YYYY")} at ${startTime} has been confirmed.`,
          {
            appointmentId: newAppointment._id,
            businessId: businessId,
            date: date,
            startTime: startTime
          }
        );
      } catch (notifError) {
        console.error("Error sending client notification:", notifError.message);
        // Don't fail the appointment creation if notification fails
      }
    }

    // Send notifications only if the client is a registered user
    if (user) {
      // Send notification to client
      await sendNotification(
        user,
        "New Appointment Created",
        `A new appointment has been created for you on ${moment(date).format(
          "MMM DD, YYYY"
        )} at ${startTime}`,
        "client",
        { appointmentId: newAppointment._id }
      );

      // Send notification to admins
      await sendNotificationToAdmins(
        "New Appointment Created",
        `A new appointment has been created by ${user.name || "a client"
        } on ${moment(date).format("MMM DD, YYYY")} at ${startTime}`,
        "admin",
        {
          appointmentId: newAppointment._id,
          clientId: user._id,
          businessId: businessId,
        }
      );

      // Notify client about penalty if applied
      const appliedPenalties = user.pendingPenalties.filter((p) => p.applied);
      if (appliedPenalties.length > 0) {
        const totalPenaltyAmount = appliedPenalties.reduce(
          (sum, penalty) => sum + penalty.amount,
          0
        );
        await sendNotification(
          user,
          "Penalty Applied to Appointment",
          `Your pending penalty(ies) totaling $${totalPenaltyAmount} have been applied to your new appointment on ${moment(
            date
          ).format("MMM DD, YYYY")} at ${startTime}.`,
          "client",
          { appointmentId: newAppointment._id }
        );

        // Send penalty notification to admins
        await sendNotificationToAdmins(
          "Penalty Applied to Appointment",
          `Penalty(ies) totaling $${totalPenaltyAmount} have been applied to ${user.name || "a client"
          }'s appointment on ${moment(date).format(
            "MMM DD, YYYY"
          )} at ${startTime}.`,
          "admin",
          {
            appointmentId: newAppointment._id,
            clientId: user._id,
            businessId: businessId,
            penaltyAmount: totalPenaltyAmount,
          }
        );
      }
    }

    // Send notification to barber (optional - for confirmation)
    const clientFullName = `${populatedAppointment.client.firstName} ${populatedAppointment.client.lastName}`;
    if (user) {
      await sendNotification(
        user,
        "Appointment Created Successfully",
        `Appointment created for ${clientFullName} on ${moment(date).format(
          "MMM DD, YYYY"
        )} at ${startTime}`,
        "barber",
        { appointmentId: newAppointment._id }
      );
    }

    // Send notification to admins about appointment creation
    await sendNotificationToAdmins(
      "Appointment Created Successfully",
      `Appointment created for ${clientFullName} on ${moment(date).format(
        "MMM DD, YYYY"
      )} at ${startTime}`,
      "admin",
      {
        appointmentId: newAppointment._id,
        businessId: businessId,
        clientName: clientFullName,
      }
    );

    return SuccessHandler(populatedAppointment, 201, res);
  } catch (error) {
    console.error("Create appointment error:", error.message);
    return ErrorHandler(error.message, error.statusCode || 500, req, res);
  }
};

/**
 * @desc Get all appointments for user
 * @route GET /api/appointments
 * @access Private
 */
const getAppointments = async (req, res) => {
  // #swagger.tags = ['Appointments']
  /* #swagger.description = 'Get all appointments for the logged-in user'
     #swagger.security = [{ "Bearer": [] }]
     #swagger.parameters['status'] = {
        in: 'query',
        description: 'Filter by status',
        type: 'string',
        enum: ['Pending', 'Confirmed', 'Canceled', 'Completed', 'No-Show', 'Missed']
     }
     #swagger.parameters['date'] = {
        in: 'query',
        description: 'Filter by date (YYYY-MM-DD)',
        type: 'string'
     }
     #swagger.parameters['staffId'] = {
        in: 'query',
        description: 'Filter by staff member ID',
        type: 'string'
     }
     #swagger.responses[200] = {
        description: 'List of appointments',
        schema: { $ref: '#/definitions/AppointmentList' }
     }
  */
  try {
    const userId = getActorId(req.user);
    const { status, date, staffId, page = 1, limit = 10 } = req.query;

    console.log("getAppointments called with:", {
      userId,
      status,
      date,
      staffId,
      page,
      limit,
    });

    const isClientUser = req.user.type === "client";
    const normalizedUserEmail = normalizeEmail(req.user.email);
    const ownerBusiness =
      isClientUser || PLATFORM_ADMIN_ROLES.has(req.user.role)
        ? null
        : await Business.findOne({ owner: userId }).select("_id");
    const isBusinessOwner = Boolean(ownerBusiness);
    console.log("Is business owner:", isBusinessOwner);

    // Build query
    let query = {};
    let assignedStaffRecords = [];

    if (isBusinessOwner) {
      query.business = ownerBusiness._id;
      console.log("Business found:", ownerBusiness._id);
    } else if (isClientUser) {
      query.client = userId;
    } else {
      assignedStaffRecords = await Staff.find({
        email: normalizedUserEmail,
      }).select("_id business");

      if (!assignedStaffRecords.length) {
        return ErrorHandler("Not authorized to view appointments", 403, req, res);
      }

      query.business = {
        $in: assignedStaffRecords.map((record) => record.business),
      };
    }

    // Apply filters
    if (status) {
      query.status = status;
    }

    // Filter by staff member
    if (staffId && staffId !== 'all') {
      // Convert staffId string to ObjectId for proper MongoDB matching
      try {
        const requestedStaffId = new mongoose.Types.ObjectId(staffId);

        if (!isBusinessOwner && !isClientUser) {
          const canReadRequestedStaff = assignedStaffRecords.some((record) =>
            record._id.equals(requestedStaffId)
          );

          if (!canReadRequestedStaff) {
            return SuccessHandler(
              {
                appointments: [],
                pagination: {
                  total: 0,
                  page: parseInt(page),
                  pages: 0,
                },
              },
              200,
              res
            );
          }
        }

        query.staff = requestedStaffId;
        console.log('Applied staff filter as ObjectId:', staffId);
      } catch (err) {
        console.error('Invalid staffId format:', staffId);
        return ErrorHandler("Invalid staff ID format", 400, req, res);
      }
    } else if (!isBusinessOwner && !isClientUser) {
      query.staff = {
        $in: assignedStaffRecords.map((record) => record._id),
      };
    }

    console.log('Final query before date:', JSON.stringify(query, null, 2));

    if (date) {
      // Ensure proper date handling for exact date matching
      const targetDate = new Date(date);
      const startOfDay = new Date(
        targetDate.getFullYear(),
        targetDate.getMonth(),
        targetDate.getDate()
      );
      const endOfDay = new Date(
        targetDate.getFullYear(),
        targetDate.getMonth(),
        targetDate.getDate() + 1
      );

      query.date = {
        $gte: startOfDay,
        $lt: endOfDay,
      };
    }

    console.log("Final query:", query);

    // Pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Get appointments WITHOUT populating service initially to preserve the ID
    const appointments = await Appointment.find(query)
      .populate({
        path: "client",
        model: "Client",
        select: "firstName lastName email phone registrationStatus incidentNotes",
      })
      .populate("business", "name contactInfo.phone")
      .populate("staff", "firstName lastName")
      .sort({ date: 1, startTime: 1 })
      .skip(skip)
      .limit(parseInt(limit));

    // Manual Service Resolution Strategy
    // 1. Collect all service IDs from current appointments
    const mainServiceIds = appointments.map(a => a.service?.toString()).filter(Boolean);
    
    // 2. Collect all appointment IDs from client incident history to find their services
    const incidentAppIds = appointments.flatMap(a => 
      (a.client?.incidentNotes || []).map(n => n.appointmentId?.toString()).filter(Boolean)
    );
    
    // 3. Fetch services for those history appointments
    const incidentServiceMap = {}; // appointmentId -> serviceId
    let incidentServiceIds = [];
    if (incidentAppIds.length > 0) {
      const historyApps = await Appointment.find({ _id: { $in: incidentAppIds } }).select("service");
      historyApps.forEach(app => {
        if (app.service) {
          const sId = app.service.toString();
          incidentServiceMap[app._id.toString()] = sId;
          incidentServiceIds.push(sId);
        }
      });
    }

    // 4. Combine all service IDs that need resolution
    const allServiceIdsToResolve = [...new Set([...mainServiceIds, ...incidentServiceIds])];
    
    // 5. Build a comprehensive service map (from Service collection + Business embedded)
    const serviceMap = {};
    
    // Resolve from standalone Service collection
    const standaloneServices = await Service.find({ _id: { $in: allServiceIdsToResolve } }).select("name duration price");
    standaloneServices.forEach(s => {
      serviceMap[s._id.toString()] = {
        _id: s._id,
        name: s.name,
        price: s.price,
        duration: s.duration
      };
    });

    // Handle unresolved IDs (likely embedded in Business)
    const unresolvedIds = allServiceIdsToResolve.filter(id => !serviceMap[id]);
    if (unresolvedIds.length > 0) {
      // Find businesses for these services
      const relevantBusinessIds = [...new Set(appointments.map(a => a.business?._id?.toString() || a.business?.toString()).filter(Boolean))];
      if (relevantBusinessIds.length > 0) {
        const businesses = await Business.find({ _id: { $in: relevantBusinessIds } }).select('services');
        businesses.forEach(biz => {
          if (biz.services) {
            biz.services.forEach(s => {
              if (unresolvedIds.includes(s._id.toString())) {
                serviceMap[s._id.toString()] = {
                  _id: s._id,
                  name: s.name,
                  price: s.price,
                  duration: s.duration || 0
                };
              }
            });
          }
        });
      }
    }

    // 6. Transform and attach service info to appointments AND their client's history
    const transformedAppointments = appointments.map((appointment) => {
      const appointmentObj = appointment.toObject();
      const sId = appointmentObj.service?.toString();
      
      // Attach service name to main appointment
      if (sId && serviceMap[sId]) {
        appointmentObj.service = serviceMap[sId];
        appointmentObj.serviceName = serviceMap[sId].name;
      } else {
        appointmentObj.service = null;
        appointmentObj.serviceName = 'Unknown Service';
      }

      // Resolve service names for the client's incident history if they are missing
      if (appointmentObj.client && appointmentObj.client.incidentNotes) {
        appointmentObj.client.incidentNotes = appointmentObj.client.incidentNotes.map(incident => {
          if (!incident.serviceName) {
            const appId = incident.appointmentId?.toString();
            const resolvedServiceId = incidentServiceMap[appId];
            if (resolvedServiceId && serviceMap[resolvedServiceId]) {
              return { ...incident, serviceName: serviceMap[resolvedServiceId].name };
            }
          }
          return incident;
        });
      }
      
      return appointmentObj;
    });

    console.log("Found appointments count:", transformedAppointments.length);
    console.log("Sample appointment:", transformedAppointments[0]);

    // Get total count
    const total = await Appointment.countDocuments(query);
    console.log("Total appointments count:", total);

    const response = {
      appointments: transformedAppointments,
      pagination: {
        total,
        page: parseInt(page),
        pages: Math.ceil(total / parseInt(limit)),
      },
    };

    console.log("Sending response:", response);

    return SuccessHandler(response, 200, res);
  } catch (error) {
    console.error("Get appointments error:", error.message);
    return ErrorHandler(error.message, 500, req, res);
  }
};

/**
 * @desc Get appointment by ID
 * @route GET /api/appointments/:id
 * @access Private
 */
const getAppointmentById = async (req, res) => {
  // #swagger.tags = ['Appointments']
  /* #swagger.description = 'Get appointment details by ID'
     #swagger.security = [{ "Bearer": [] }]
     #swagger.parameters['id'] = {
        in: 'path',
        description: 'Appointment ID',
        required: true,
        type: 'string'
     }
     #swagger.responses[200] = {
        description: 'Appointment details',
        schema: { $ref: '#/definitions/Appointment' }
     }
     #swagger.responses[404] = {
        description: 'Appointment not found'
     }
  */
  try {
    const appointment = await Appointment.findById(req.params.id)
      .populate("service", "name duration price description")
      .populate("client", "firstName lastName email phone")
      .populate("business", "name contactInfo address")
      .populate("staff", "name");

    if (!appointment) {
      return ErrorHandler("Appointment not found", 404, req, res);
    }

    const userId = req.user.id;
    const isClient = appointment.client?._id?.toString() === String(userId);
    const { isBusinessOwner, isAssignedStaff } =
      await getOperationalAppointmentContext(appointment, req.user);

    if (!isClient && !isBusinessOwner && !isAssignedStaff) {
      return ErrorHandler(
        "Not authorized to view this appointment",
        403,
        req,
        res
      );
    }

    return SuccessHandler(appointment, 200, res);
  } catch (error) {
    console.error("Get appointment by ID error:", error.message);
    return ErrorHandler(error.message, 500, req, res);
  }
};

/**
 * @desc Update appointment status
 * @route PUT /api/appointments/:id/status
 * @access Private
 */
const updateAppointmentStatus = async (req, res) => {
  // #swagger.tags = ['Appointments']
  /* #swagger.description = 'Update appointment status'
     #swagger.security = [{ "Bearer": [] }]
     #swagger.parameters['id'] = {
        in: 'path',
        description: 'Appointment ID',
        required: true,
        type: 'string'
     }
     #swagger.parameters['obj'] = {
        in: 'body',
        description: 'Status update. Possible values: Pending, Confirmed, Canceled, Completed, No-Show, Missed',
        required: true,
        schema: {
          status: 'Confirmed'
        }
     }
     #swagger.responses[200] = {
        description: 'Appointment status updated',
        schema: { $ref: '#/definitions/Appointment' }
     }
     #swagger.responses[404] = {
        description: 'Appointment not found'
     }
  */
  try {
    const { status } = req.body;
    const appointmentId = req.params.id;
    const userId = req.user.id || req.user._id;

    // Validate status
    const validStatuses = [
      "Pending",
      "Confirmed",
      "Canceled",
      "Completed",
      "No-Show",
      "Missed",
    ];
    if (!validStatuses.includes(status)) {
      return ErrorHandler("Invalid status", 400, req, res);
    }

    // Find appointment and populate service to get name for incident notes
    const appointment = await Appointment.findById(appointmentId).populate('service');
    if (!appointment) {
      return ErrorHandler("Appointment not found", 404, req, res);
    }

    // Check authorization
    const { business, isBusinessOwner, isAssignedStaff } =
      await getOperationalAppointmentContext(appointment, req.user);
    const isClient = appointment.client.toString() === String(userId);
    const requestedWaiver = toBoolean(req.body.waiveFee);

    if (requestedWaiver && !isBusinessOwner) {
      return ErrorHandler(
        "Only the business owner can waive policy fees",
        403,
        req,
        res
      );
    }

    if ((status === "No-Show" || status === "Missed") && !isBusinessOwner) {
      return ErrorHandler(
        "Only the business owner can mark appointments as No-Show or Missed",
        403,
        req,
        res
      );
    }

    if (
      appointment.visitType === "walk_in" &&
      (status === "No-Show" || status === "Missed")
    ) {
      return ErrorHandler(
        "Walk-ins must be abandoned, not marked as No-Show or Missed",
        409,
        req,
        res
      );
    }

    if (status === "Completed" && !isBusinessOwner && !isAssignedStaff) {
      return ErrorHandler(
        "Only the business owner or assigned staff can mark appointments as Completed",
        403,
        req,
        res
      );
    }

    if (status === "Completed") {
      const alreadyCompleted =
        appointment.status === "Completed" &&
        appointment.visitStatus === "completed";
      if (alreadyCompleted) {
        return SuccessHandler(appointment, 200, res);
      }

      if (appointment.visitStatus !== "in_service") {
        return ErrorHandler(
          "Appointment must be in service before marking it as Completed",
          409,
          req,
          res
        );
      }
    }

    // Clients can only cancel their own appointments
    if (status === "Canceled" && !isBusinessOwner && !isClient) {
      return ErrorHandler(
        "Not authorized to cancel this appointment",
        403,
        req,
        res
      );
    }

    // Use transaction for policy-sensitive status changes to keep appointment,
    // client incident notes and blocking consistent.
    let session = null;
    const policySensitiveStatus = ["No-Show", "Missed", "Canceled"].includes(
      status
    );
    if (policySensitiveStatus) {
      session = await mongoose.startSession();
    }

    try {
      if ((status === "No-Show" || status === "Missed") && isBusinessOwner) {
        await session.withTransaction(async () => {
          const policyResult = resolveNoShowOutcome({
            appointment,
            business,
            actorId: userId,
            payload: req.body,
            isBusinessOwner,
          });

          appointment.policyOutcome = policyResult.outcome;
          appointment.penalty = policyResult.penalty;

          // Handle client blocking and incident notes
          const { incidentNote } = req.body;
          const clientDoc = await Client.findById(appointment.client).session(session);

          if (clientDoc) {
            // If barber chose to block the client
            let blockActionTaken = false;
            if (policyResult.blockApplied) {
              console.log(`[updateAppointmentStatus] Blocking client ${clientDoc._id} due to No-Show.`);
              clientDoc.appBookingBlocked = true;
              clientDoc.lastNoShowDate = appointment.date || new Date();
              clientDoc.blockAppliedDate = new Date();
              blockActionTaken = true;
            }

            // Initialize incidentNotes array if not exists
            if (!clientDoc.incidentNotes) {
              clientDoc.incidentNotes = [];
            }

            // Resolve service name for incident notes
            let serviceName = "Appointment Service";
            if (appointment.service && typeof appointment.service === "object" && appointment.service.name) {
              serviceName = appointment.service.name;
            } else {
              const sId = (appointment.service && typeof appointment.service === "object" && appointment.service._id)
                ? appointment.service._id.toString()
                : appointment.service?.toString();
              if (sId) {
                const standaloneService = await Service.findById(sId).session(session);
                if (standaloneService) {
                  serviceName = standaloneService.name;
                } else {
                  const bizService = business?.services?.id(sId);
                  if (bizService) serviceName = bizService.name;
                }
              }
            }

            const finalNote = incidentNote && incidentNote.trim()
              ? incidentNote.trim()
              : `No-show for ${serviceName} appointment`;

            // Add the incident note
            clientDoc.incidentNotes.push({
              date: new Date(),
              type: 'no-show',
              appointmentId: appointment._id,
              serviceName: serviceName,
              note: finalNote,
              createdBy: userId,
            });

            await clientDoc.save({ session });

            // Record audit trail for blocking if applied
            if (blockActionTaken) {
              await Auditing.create([{
                entityType: "Client",
                entityId: clientDoc._id,
                action: "modified",
                reason: `Blocked from app booking due to no-show on ${moment(appointment.date).format('DD/MM/YYYY')}`,
                createdBy: userId,
                metadata: {
                  actionType: 'block',
                  appointmentId: appointment._id,
                  noShowDate: appointment.date,
                  blockAppliedDate: clientDoc.blockAppliedDate,
                  policyVersion: policyResult.policy.version,
                  policySource: policyResult.policy.source,
                }
              }], { session });
            }
          }

          // Update appointment status within transaction
          appointment.status = status;
          Object.assign(appointment, buildAppointmentSemanticState(status));
          applyWalkInQueueStatusForLegacyStatus(appointment, status);
          appointment.updatedAt = new Date();
          await appointment.save({ session });
        });
      } else if (status === "Canceled") {
        await session.withTransaction(async () => {
          const policyResult = resolveCancellationOutcome({
            appointment,
            business,
            actorId: userId,
            payload: req.body,
            isBusinessOwner,
          });

          if (policyResult.outcome) {
            appointment.policyOutcome = policyResult.outcome;
            appointment.penalty = policyResult.penalty;

            const clientDoc = await Client.findById(appointment.client).session(
              session
            );
            if (clientDoc) {
              const serviceName =
                appointment.service &&
                typeof appointment.service === "object" &&
                appointment.service.name
                  ? appointment.service.name
                  : "Appointment Service";

              clientDoc.incidentNotes = clientDoc.incidentNotes || [];
              clientDoc.incidentNotes.push({
                date: new Date(),
                type: "cancellation",
                appointmentId: appointment._id,
                serviceName,
                note:
                  policyResult.outcome.note ||
                  `Late cancellation for ${serviceName} appointment`,
                createdBy: userId,
              });
              await clientDoc.save({ session });
            }
          }

          appointment.status = status;
          Object.assign(appointment, buildAppointmentSemanticState(status));
          applyWalkInQueueStatusForLegacyStatus(appointment, status);
          appointment.updatedAt = new Date();
          await appointment.save({ session });
        });
      } else {
        // For non-no-show/missed statuses, perform standard update
        appointment.status = status;
        Object.assign(appointment, buildAppointmentSemanticState(status));
        applyWalkInQueueStatusForLegacyStatus(appointment, status);
        appointment.updatedAt = new Date();
        await appointment.save();
      }
    } catch (error) {
      if (session && session.inTransaction()) {
        await session.abortTransaction();
      }
      throw error;
    } finally {
      if (session) session.endSession();
    }

    // Update recurring email campaign schedules if appointment is completed
    // if (status === "Completed") {
    //   try {
    //     await updateRecurringCampaignSchedules(
    //       appointment.client,
    //       appointment.business,
    //       appointment.date
    //     );
    //   } catch (emailError) {
    //     console.error(
    //       "Error updating recurring campaign schedules:",
    //       emailError
    //     );
    //     // Don't fail the appointment update if email campaign update fails
    //   }
    // }

    if (status === "Completed" || status === "No-Show" || status === "Missed") {
      await recordDomainEvent({
        type: status === "Completed" ? "service_completed" : "no_show_marked",
        actorId: req.user._id || req.user.id,
        shopId: appointment.business,
        correlationId: appointment._id,
        payload: {
          appointmentId: appointment._id,
          clientId: appointment.client,
          serviceId:
            appointment.service && typeof appointment.service === "object"
              ? appointment.service._id || appointment.service
              : appointment.service,
          staffId: appointment.staff,
          status,
          policyOutcome: appointment.policyOutcome,
        },
      });
    }

    if (status === "Canceled" && appointment.policyOutcome?.type === "late_cancel") {
      await recordDomainEvent({
        type: "late_cancel_marked",
        actorId: req.user._id || req.user.id,
        shopId: appointment.business,
        correlationId: appointment._id,
        payload: buildBookingEventPayload(appointment, {
          policyOutcome: appointment.policyOutcome,
        }),
      });
    }

    if (
      (status === "No-Show" || status === "Missed") &&
      appointment.policyOutcome?.blockApplied
    ) {
      await recordDomainEvent({
        type: "customer_blocked",
        actorId: req.user._id || req.user.id,
        shopId: appointment.business,
        correlationId: appointment._id,
        payload: {
          appointmentId: appointment._id,
          clientId: appointment.client,
          reason: "no_show",
          policyOutcome: appointment.policyOutcome,
        },
      });
    }

    if (status === "Canceled") {
      await recordDomainEvent({
        type: "booking_cancelled",
        actorId: req.user._id || req.user.id,
        shopId: appointment.business,
        correlationId: appointment._id,
        payload: buildBookingEventPayload(appointment, {
          cancelledBy:
            req.user?.type === "client" || req.user?.role === "client"
              ? "client"
              : "business",
        }),
      });
    }

    // Send notifications based on status change
    // Appointment.client references Client model, not User model
    const client = await Client.findById(appointment.client);
    const businessOwner = await User.findById(business.owner);

    let notificationTitle, notificationBody;

    // Helper function to get client name
    const getClientName = (clientDoc) => {
      if (!clientDoc) return "a client";
      // Client model uses firstName/lastName, User model uses name
      if (clientDoc.firstName || clientDoc.lastName) {
        return (
          `${clientDoc.firstName || ""} ${clientDoc.lastName || ""}`.trim() ||
          "a client"
        );
      }
      return clientDoc.name || "a client";
    };

    if (status === "Confirmed") {
      notificationTitle = "Appointment Confirmed";
      notificationBody = `Your appointment on ${moment(appointment.date).format(
        "MMM DD, YYYY"
      )} at ${appointment.startTime} has been confirmed.`;

      // Notify client (only if client exists and is a registered User)
      if (client) {
        // Try to find corresponding User if client is a Client model instance
        const clientUser = client.email
          ? await User.findOne({ email: client.email })
          : null;
        if (clientUser) {
          await sendNotification(
            clientUser,
            notificationTitle,
            notificationBody,
            "client",
            { appointmentId: appointment._id }
          );
        }

        // Also send notification to Client model (for clients who booked via public page)
        try {
          await clientNotification(
            client._id,
            notificationTitle,
            notificationBody,
            { appointmentId: appointment._id, status: status }
          );
        } catch (notifError) {
          console.error("Error sending client notification:", notifError.message);
        }
      }

      // Send notification to admins
      await sendNotificationToAdmins(
        notificationTitle,
        `Appointment for ${getClientName(
          client
        )} has been confirmed for ${moment(appointment.date).format(
          "MMM DD, YYYY"
        )} at ${appointment.startTime}`,
        "admin",
        {
          appointmentId: appointment._id,
          clientId: client?._id,
          businessId: appointment.business,
        }
      );
    } else if (status === "Canceled") {
      notificationTitle = "Appointment Canceled";
      notificationBody = `Your appointment on ${moment(appointment.date).format(
        "MMM DD, YYYY"
      )} at ${appointment.startTime} has been canceled.`;

      // Notify client if canceled by business owner
      if (isBusinessOwner && client) {
        // Try to find corresponding User if client is a Client model instance
        const clientUser = client.email
          ? await User.findOne({ email: client.email })
          : null;
        if (clientUser) {
          await sendNotification(
            clientUser,
            notificationTitle,
            notificationBody,
            "client",
            { appointmentId: appointment._id }
          );
        }

        // Also send notification to Client model (for clients who booked via public page)
        try {
          await clientNotification(
            client._id,
            notificationTitle,
            notificationBody,
            { appointmentId: appointment._id, status: status }
          );
        } catch (notifError) {
          console.error("Error sending client notification:", notifError.message);
        }

        // Send notification to admins
        await sendNotificationToAdmins(
          notificationTitle,
          `Appointment for ${getClientName(
            client
          )} has been canceled by business owner for ${moment(
            appointment.date
          ).format("MMM DD, YYYY")} at ${appointment.startTime}.`,
          "admin",
          {
            appointmentId: appointment._id,
            clientId: client._id,
            businessId: appointment.business,
          }
        );
      }

      // Notify business owner if canceled by client
      if (isClient) {
        await sendNotification(
          businessOwner,
          "Appointment Canceled by Client",
          `A client canceled their appointment on ${moment(
            appointment.date
          ).format("MMM DD, YYYY")} at ${appointment.startTime}.`,
          "barber",
          { appointmentId: appointment._id }
        );

        // Send notification to admins
        await sendNotificationToAdmins(
          "Appointment Canceled by Client",
          `Client ${getClientName(
            client
          )} canceled their appointment on ${moment(appointment.date).format(
            "MMM DD, YYYY"
          )} at ${appointment.startTime}.`,
          "admin",
          {
            appointmentId: appointment._id,
            clientId: client?._id,
            businessId: appointment.business,
          }
        );
      }
    }

    // --- Review Request SMS Logic ---
    // Only after marking as Completed, and only if business owner
    if (status === "Completed" && isBusinessOwner) {
      const { reviewRequest, reviewMessage } = req.body;
      if (
        reviewRequest === true &&
        reviewMessage &&
        reviewMessage.trim().length > 0
      ) {
        // Check if client exists
        if (!client) {
          console.error("Client not found for appointment:", appointmentId);
          // Continue with appointment update but skip SMS
        } else {
          // Get client phone from Client model (appointments reference Client model)
          let clientPhone = client.phone;

          // If phone not found in Client model, try to find corresponding User
          if (!clientPhone && client.email) {
            try {
              const clientUser = await User.findOne({ email: client.email });
              if (clientUser && clientUser.phone) {
                clientPhone = clientUser.phone;
              }
            } catch (e) {
              console.error("Error finding client user:", e);
            }
          }

          if (clientPhone) {


            let smsSent = false;
            let smsError = null;

            try {
              // Send SMS with credit validation
              const smsResult = await sendSMSWithCredits(
                clientPhone,
                reviewMessage,
                business._id,
                req,
                res
              );



              // Check if credit validation failed
              if (smsResult && smsResult.error) {
                console.error(
                  "Insufficient SMS credits for review request:",
                  smsResult.message
                );
                smsError = smsResult.message;
                // Don't fail the appointment update, just log the error
              } else {
                smsSent = true;
                // Update appointment with review request information
                appointment.reviewRequest = {
                  sent: true,
                  message: reviewMessage,
                  sentAt: new Date(),
                  sentBy: userId,
                  creditsUsed: smsResult?.creditsUsed || 1,
                  smsStatus: {
                    sent: true,
                    messageId: smsResult?.messageId || null,
                    creditsUsed: smsResult?.creditsUsed || 1,
                  },
                };
                await appointment.save();

              }
            } catch (smsError) {
              console.error(
                "Failed to send review request SMS:",
                smsError.message
              );
              smsError = smsError.message;
            }

            // Log final SMS status


            // Update appointment with SMS status (success or failure)
            if (smsSent) {
              // Already updated above when SMS was sent successfully
            } else {
              // Store error information in appointment when SMS failed
              appointment.reviewRequest = {
                sent: false,
                message: reviewMessage,
                sentAt: null,
                sentBy: userId,
                error: smsError || "Unknown error",
                errorMessage:
                  smsError ||
                  "Failed to send SMS. Please check your SMS credits.",
              };
              await appointment.save();
            }
          } else {
            // No client phone found
            appointment.reviewRequest = {
              sent: false,
              message: reviewMessage,
              sentAt: null,
              sentBy: userId,
              error: "No phone number found",
              errorMessage:
                "Review request could not be sent. Client phone number not found.",
            };
            await appointment.save();
          }
        }
      }
    }
    // --- End Review Request SMS Logic ---

    return SuccessHandler(appointment, 200, res);
  } catch (error) {
    console.error("Update appointment status error:", error.message);
    return ErrorHandler(error.message, error.statusCode || 500, req, res);
  }
};

const checkInAppointment = async (req, res) => {
  try {
    const { appointment, error } = await getOperationalAppointmentForUser(
      req.params.id,
      req.user
    );

    if (error) {
      return ErrorHandler(error.message, error.status, req, res);
    }

    if (isTerminalAppointmentState(appointment)) {
      return ErrorHandler(
        "Cannot check in an appointment in a final state",
        409,
        req,
        res
      );
    }

    if (appointment.visitStatus === "checked_in") {
      return SuccessHandler(appointment, 200, res);
    }

    if (appointment.visitStatus === "in_service") {
      return ErrorHandler(
        "Appointment has already started service",
        409,
        req,
        res
      );
    }

    appointment.visitStatus = "checked_in";
    appointment.operationalTimestamps = {
      ...appointment.operationalTimestamps,
      checkedInAt: new Date(),
      checkedInBy: req.user._id,
    };
    await appointment.save();
    await recordDomainEvent({
      type: "client_checked_in",
      actorId: req.user._id || req.user.id,
      shopId: appointment.business,
      correlationId: appointment._id,
      payload: {
        appointmentId: appointment._id,
        clientId: appointment.client,
        serviceId: appointment.service,
        staffId: appointment.staff,
      },
    });

    const hydratedAppointment = await Appointment.findById(appointment._id)
      .populate("client", "firstName lastName phone")
      .populate("staff", "firstName lastName")
      .populate("service", "name price currency");

    return SuccessHandler(hydratedAppointment, 200, res);
  } catch (error) {
    return ErrorHandler(error.message, 500, req, res);
  }
};

const startAppointmentService = async (req, res) => {
  try {
    const { appointment, error } = await getOperationalAppointmentForUser(
      req.params.id,
      req.user
    );

    if (error) {
      return ErrorHandler(error.message, error.status, req, res);
    }

    if (isTerminalAppointmentState(appointment)) {
      return ErrorHandler(
        "Cannot start service for an appointment in a final state",
        409,
        req,
        res
      );
    }

    const isWalkIn = appointment.visitType === "walk_in";
    const shouldRecordWalkInConverted =
      isWalkIn && appointment.queueStatus !== "in_service";

    if (appointment.visitStatus === "in_service") {
      if (shouldRecordWalkInConverted) {
        const queueLeftAt = new Date();
        appointment.queueStatus = "in_service";
        appointment.queueLeftAt = appointment.queueLeftAt || queueLeftAt;
        appointment.queueOutcomeReason =
          appointment.queueOutcomeReason || "service_started";
        await appointment.save();
        await recordDomainEvent({
          type: "walkin_converted",
          actorId: req.user._id || req.user.id,
          shopId: appointment.business,
          correlationId: appointment._id,
          payload: {
            appointmentId: appointment._id,
            clientId: appointment.client,
            serviceId: appointment.service,
            staffId: appointment.staff,
          },
        });
      }

      return SuccessHandler(appointment, 200, res);
    }

    if (appointment.visitStatus !== "checked_in") {
      return ErrorHandler(
        "Appointment must be checked in before starting service",
        409,
        req,
        res
      );
    }

    const serviceStartedAt = new Date();
    appointment.visitStatus = "in_service";
    appointment.operationalTimestamps = {
      ...appointment.operationalTimestamps,
      serviceStartedAt,
      serviceStartedBy: req.user._id || req.user.id,
    };

    if (isWalkIn) {
      appointment.queueStatus = "in_service";
      appointment.queueLeftAt = appointment.queueLeftAt || serviceStartedAt;
      appointment.queueOutcomeReason =
        appointment.queueOutcomeReason || "service_started";
    }

    await appointment.save();
    await recordDomainEvent({
      type: "service_started",
      actorId: req.user._id || req.user.id,
      shopId: appointment.business,
      correlationId: appointment._id,
      payload: {
        appointmentId: appointment._id,
        clientId: appointment.client,
        serviceId: appointment.service,
        staffId: appointment.staff,
      },
    });

    if (shouldRecordWalkInConverted) {
      await recordDomainEvent({
        type: "walkin_converted",
        actorId: req.user._id || req.user.id,
        shopId: appointment.business,
        correlationId: appointment._id,
        payload: {
          appointmentId: appointment._id,
          clientId: appointment.client,
          serviceId: appointment.service,
          staffId: appointment.staff,
        },
      });
    }

    const hydratedAppointment = await Appointment.findById(appointment._id)
      .populate("client", "firstName lastName phone")
      .populate("staff", "firstName lastName")
      .populate("service", "name price currency");

    return SuccessHandler(hydratedAppointment, 200, res);
  } catch (error) {
    return ErrorHandler(error.message, 500, req, res);
  }
};

/**
 * @desc Update appointment details
 * @route PUT /api/appointments/:id
 * @access Private
 */
const updateAppointment = async (req, res) => {
  // #swagger.tags = ['Appointments']
  /* #swagger.description = 'Update appointment details'
     #swagger.security = [{ "Bearer": [] }]
     #swagger.parameters['id'] = {
        in: 'path',
        description: 'Appointment ID',
        required: true,
        type: 'string'
     }
     #swagger.parameters['obj'] = {
        in: 'body',
        description: 'Appointment update information',
        required: true,
        schema: {
          date: '2025-03-20',
          startTime: '11:00',
          serviceId: 'new_service_id',
          notes: 'Updated notes',
          clientNotes: 'Updated client notes'
        }
     }
     #swagger.responses[200] = {
        description: 'Appointment updated successfully',
        schema: { $ref: '#/definitions/Appointment' }
     }
     #swagger.responses[404] = {
        description: 'Appointment not found'
     }
  */
  try {
    const { date, startTime, serviceId, notes, clientNotes } = req.body;
    const appointmentId = req.params.id;
    const userId = req.user.id;

    // Find appointment
    const appointment = await Appointment.findById(appointmentId);
    if (!appointment) {
      return ErrorHandler("Appointment not found", 404, req, res);
    }

    // Check authorization
    const business = await Business.findById(appointment.business);
    if (!business) {
      return ErrorHandler("Business not found", 404, req, res);
    }
    const isBusinessOwner = canManageBusinessAppointments(req.user, business);
    const isClient =
      isClientActor(req.user) && appointment.client.toString() === userId;

    if (!isBusinessOwner && !isClient) {
      return ErrorHandler(
        "Not authorized to update this appointment",
        403,
        req,
        res
      );
    }

    // Prepare updates
    const updates = {};

    // Only business owners can update certain fields
    if (isBusinessOwner) {
      if (notes !== undefined) updates.notes = notes;
    }

    // Fields that both client and business owner can update
    if (clientNotes !== undefined) updates.clientNotes = clientNotes;

    // Handle reschedule (date/time change)
    if (date || startTime) {
      // Only allow rescheduling if appointment is not completed or no-show
      if (isTerminalAppointmentState(appointment)) {
        return ErrorHandler(
          "Cannot reschedule completed, cancelled, or no-show appointments",
          400,
          req,
          res
        );
      }

      const newDate = date || appointment.date;
      const newStartTime = startTime || appointment.startTime;

      // Calculate new end time if needed
      let newEndTime = appointment.endTime;
      let duration = appointment.duration;

      if (serviceId) {
        const service = await resolveCanonicalServiceForBusiness(
          business,
          serviceId
        );
        if (!service) {
          return ErrorHandler(
            "Service not found or doesn't belong to this business",
            404,
            req,
            res
          );
        }
        // Duration is now handled per staff-service relationship
        // Keep the existing duration or use provided duration
        updates.service = serviceId;
        updates.price = service.price;
      }

      if (startTime) {
        const [hours, minutes] = newStartTime.split(":");
        const startDateTime = new Date(newDate);
        startDateTime.setHours(parseInt(hours, 10));
        startDateTime.setMinutes(parseInt(minutes, 10));

        const endDateTime = new Date(startDateTime);
        endDateTime.setMinutes(endDateTime.getMinutes() + duration);

        newEndTime = `${endDateTime
          .getHours()
          .toString()
          .padStart(2, "0")}:${endDateTime
            .getMinutes()
            .toString()
            .padStart(2, "0")}`;
      }

      // Check for availability
      const conflictingAppointment = await Appointment.findOne({
        _id: { $ne: appointmentId },
        business: appointment.business,
        date: { $eq: new Date(newDate).toISOString().split("T")[0] },
        $or: [
          {
            startTime: { $lt: newEndTime },
            endTime: { $gt: newStartTime },
          },
        ],
        status: { $nin: ["Canceled"] },
      });

      if (conflictingAppointment) {
        return ErrorHandler("This time slot is not available", 400, req, res);
      }

      updates.date = newDate;
      updates.startTime = newStartTime;
      updates.endTime = newEndTime;
      updates.duration = duration;

      // When rescheduling, set status to Pending if client initiated
      if (isClient && !isBusinessOwner) {
        updates.status = "Pending";
      }
      updates.bookingStatus = "rescheduled";
      updates.visitStatus = "not_started";
    }

    // Update appointment
    const updatedAppointment = await Appointment.findByIdAndUpdate(
      appointmentId,
      { $set: updates },
      { new: true }
    )
      .populate("service", "name duration price")
      .populate("client", "firstName lastName email phone")
      .populate("business", "name contactInfo address");

    if (Object.keys(updates).length > 0) {
      await recordDomainEvent({
        type: "booking_modified",
        actorId: req.user._id || req.user.id,
        shopId: appointment.business,
        correlationId: updatedAppointment._id,
        payload: buildBookingEventPayload(updatedAppointment, {
          modifiedFields: Object.keys(updates),
        }),
      });
    }

    // Send notifications if appointment was rescheduled
    if (date || startTime) {
      const notificationTitle = "Appointment Rescheduled";
      const notificationBody = `Your appointment has been rescheduled to ${moment(
        updatedAppointment.date
      ).format("MMM DD, YYYY")} at ${updatedAppointment.startTime}.`;

      if (isBusinessOwner) {
        // Notify client
        await sendNotification(
          appointment.client,
          notificationTitle,
          notificationBody,
          "client",
          { appointmentId: appointment._id }
        );

        // Send notification to admins
        await sendNotificationToAdmins(
          notificationTitle,
          `Appointment for ${appointment.client.name || "a client"
          } has been rescheduled by business owner to ${moment(
            updatedAppointment.date
          ).format("MMM DD, YYYY")} at ${updatedAppointment.startTime}.`,
          "admin",
          {
            appointmentId: appointment._id,
            clientId: appointment.client._id,
            businessId: appointment.business,
          }
        );
      } else if (isClient) {
        // Notify business owner
        await sendNotification(
          business.owner,
          "Reschedule Request",
          `A client has requested to reschedule their appointment to ${moment(
            updatedAppointment.date
          ).format("MMM DD, YYYY")} at ${updatedAppointment.startTime}.`,
          "barber",
          { appointmentId: appointment._id }
        );

        // Send notification to admins
        await sendNotificationToAdmins(
          "Reschedule Request",
          `Client ${appointment.client.name || "a client"
          } has requested to reschedule their appointment to ${moment(
            updatedAppointment.date
          ).format("MMM DD, YYYY")} at ${updatedAppointment.startTime}.`,
          "admin",
          {
            appointmentId: appointment._id,
            clientId: appointment.client._id,
            businessId: appointment.business,
          }
        );
      }
    }

    return SuccessHandler(updatedAppointment, 200, res);
  } catch (error) {
    console.error("Update appointment error:", error.message);
    return ErrorHandler(error.message, 500, req, res);
  }
};

/**
 * @desc Notify client about delay
 * @route POST /api/appointments/:id/delay
 * @access Private (Business Owner/Barber)
 */
const notifyDelay = async (req, res) => {
  // #swagger.tags = ['Appointments']
  /* #swagger.description = 'Send delay notification to client with custom message and new date/time if slot is available.'
     #swagger.security = [{ "Bearer": [] }]
     #swagger.parameters['id'] = {
        in: 'path',
        description: 'Appointment ID',
        required: true,
        type: 'string'
     }
     #swagger.parameters['obj'] = {
        in: 'body',
        description: 'Delay notification information',
        required: true,
        schema: {
          newDate: '2025-03-20',
          newStartTime: '11:00',
          message: 'We are running 15 minutes behind schedule. Your appointment will start at 2:15 PM instead of 2:00 PM.'
        }
     }
     #swagger.responses[200] = {
        description: 'Delay notification sent successfully',
        schema: {
          message: 'Delay notification sent successfully',
          appointment: { $ref: '#/definitions/Appointment' }
        }
     }
     #swagger.responses[404] = {
        description: 'Appointment not found'
     }
     #swagger.responses[403] = {
        description: 'Not authorized to send delay notification'
     }
     #swagger.responses[400] = {
        description: 'Invalid input data or slot unavailable'
     }
  */
  try {
    const { newDate, newStartTime, message } = req.body;
    const appointmentId = req.params.id;
    const userId = req.user.id;

    // Validate required fields
    if (!newDate || !newStartTime || !message) {
      return ErrorHandler(
        "New date, new start time, and message are required",
        400,
        req,
        res
      );
    }

    // Validate message length
    if (message.length > 500) {
      return ErrorHandler(
        "Message must be 500 characters or less",
        400,
        req,
        res
      );
    }

    // Find appointment
    const appointment = await Appointment.findById(appointmentId)
      .populate("client", "firstName lastName email")
      .populate("business", "name owner")
      .populate("service", "name duration");

    if (!appointment) {
      return ErrorHandler("Appointment not found", 404, req, res);
    }
    if (!appointment.business) {
      return ErrorHandler(
        "Business associated with this appointment not found",
        404,
        req,
        res
      );
    }
    if (!appointment.client) {
      return ErrorHandler(
        "Client for this appointment not found",
        404,
        req,
        res
      );
    }

    // Handle missing service gracefully - use appointment duration if service is missing
    let serviceName = "Service";
    let serviceDuration = appointment.duration || 60; // Default to appointment duration or 60 minutes

    if (appointment.service) {
      serviceName = appointment.service.name;
      // Duration is now stored directly in appointment.duration
      serviceDuration = appointment.duration || 60;
    }

    // Check authorization - only business owner can send delay notifications
    if (appointment.business.owner.toString() !== userId) {
      return ErrorHandler(
        "Not authorized to send delay notification",
        403,
        req,
        res
      );
    }

    // Check if appointment is eligible for delay notification
    const validStatuses = ["Pending", "Confirmed"];
    if (!validStatuses.includes(appointment.status)) {
      return ErrorHandler(
        "Delay notification can only be sent for Pending or Confirmed appointments",
        400,
        req,
        res
      );
    }

    // Calculate new end time using the serviceDuration we determined above
    let duration = serviceDuration;
    const [hours, minutes] = newStartTime.split(":");
    const startDateTime = new Date(newDate);
    startDateTime.setHours(parseInt(hours, 10));
    startDateTime.setMinutes(parseInt(minutes, 10));
    const endDateTime = new Date(startDateTime);
    endDateTime.setMinutes(endDateTime.getMinutes() + duration);
    const newEndTime = `${endDateTime
      .getHours()
      .toString()
      .padStart(2, "0")}:${endDateTime
        .getMinutes()
        .toString()
        .padStart(2, "0")}`;

    // Check for slot availability (exclude this appointment)
    const conflictQuery = {
      _id: { $ne: appointmentId },
      business: appointment.business._id || appointment.business,
      date: { $eq: new Date(newDate).toISOString().split("T")[0] },
      status: { $nin: ["Canceled", "No-Show"] },
      $or: [
        { startTime: { $lt: newEndTime }, endTime: { $gt: newStartTime } },
        { startTime: { $gte: newStartTime, $lt: newEndTime } },
      ],
    };
    if (appointment.staff) {
      conflictQuery.staff = appointment.staff;
    }
    const conflictingAppointment = await Appointment.findOne(conflictQuery);
    if (conflictingAppointment) {
      return ErrorHandler("This time slot is not available", 400, req, res);
    }

    // Update appointment with new date/time and delay info
    appointment.date = new Date(newDate);
    appointment.startTime = newStartTime;
    appointment.endTime = newEndTime;
    appointment.delay = {
      notified: true,
      message: message,
      notifiedAt: new Date(),
      estimatedDelay: null,
      newDate: newDate,
      newStartTime: newStartTime,
      newEndTime: newEndTime,
    };
    await appointment.save();

    // Send notification to client
    const notificationTitle = "Appointment Delayed & Rescheduled";
    const notificationBody = `Your appointment for ${serviceName} has been delayed and rescheduled to ${moment(
      newDate
    ).format("MMM DD, YYYY")} at ${newStartTime}. ${message}`;
    await sendNotification(
      appointment.client,
      notificationTitle,
      notificationBody,
      "client",
      {
        appointmentId: appointment._id,
        newDate: newDate,
        newTime: newStartTime,
        message: message,
      }
    );

    // Send notification to admins
    await sendNotificationToAdmins(
      notificationTitle,
      `Appointment for ${appointment.client.firstName} ${appointment.client.lastName
      } has been delayed and rescheduled to ${moment(newDate).format(
        "MMM DD, YYYY"
      )} at ${newStartTime}. Reason: ${message}`,
      "admin",
      {
        appointmentId: appointment._id,
        clientId: appointment.client._id,
        businessId: appointment.business._id,
        newDate: newDate,
        newTime: newStartTime,
        message: message,
      }
    );
    // Send confirmation notification to barber
    const barberUser = await User.findById(userId);
    if (barberUser) {
      await sendNotification(
        barberUser,
        "Delay Notification Sent",
        `Delay notification sent to ${appointment.client.firstName + " " + appointment.client.lastName
        } for appointment on ${moment(appointment.date).format(
          "MMM DD, YYYY"
        )} at ${appointment.startTime}`,
        "barber",
        { appointmentId: appointment._id }
      );
    }

    return SuccessHandler(
      {
        message: "Delay notification sent successfully",
        appointment: {
          id: appointment._id,
          clientName:
            appointment.client.firstName + " " + appointment.client.lastName,
          serviceName: serviceName,
          newDate: newDate,
          newTime: newStartTime,
          newEndTime: newEndTime,
          message: message,
          notifiedAt: appointment.delay.notifiedAt,
        },
      },
      200,
      res
    );
  } catch (error) {
    console.error("Notify delay error:", error.message);
    return ErrorHandler(error.message, 500, req, res);
  }
};

/**
 * @desc Get delay information for an appointment
 * @route GET /api/appointments/:id/delay
 * @access Private
 */
const getDelayInfo = async (req, res) => {
  // #swagger.tags = ['Appointments']
  /* #swagger.description = 'Get delay information for an appointment'
     #swagger.security = [{ "Bearer": [] }]
     #swagger.parameters['id'] = {
        in: 'path',
        description: 'Appointment ID',
        required: true,
        type: 'string'
     }
     #swagger.responses[200] = {
        description: 'Delay information retrieved successfully',
        schema: {
          delay: {
            notified: true,
            message: 'We are running 15 minutes behind schedule.',
            notifiedAt: '2025-01-15T10:30:00Z',
            estimatedDelay: 15
          }
        }
     }
     #swagger.responses[404] = {
        description: 'Appointment not found'
     }
  */
  try {
    const appointmentId = req.params.id;
    const userId = req.user.id;

    // Find appointment
    const appointment = await Appointment.findById(appointmentId)
      .populate("client", "firstName lastName email")
      .populate("business", "name");

    if (!appointment) {
      return ErrorHandler("Appointment not found", 404, req, res);
    }

    // Check authorization (either client or business owner)
    const business = await Business.findById(appointment.business);
    const isBusinessOwner = business.owner.toString() === userId;
    const isClient = appointment.client._id.toString() === userId;

    if (!isBusinessOwner && !isClient) {
      return ErrorHandler(
        "Not authorized to view this appointment",
        403,
        req,
        res
      );
    }

    return SuccessHandler(
      {
        delay: appointment.delay,
        appointmentInfo: {
          id: appointment._id,
          date: appointment.date,
          startTime: appointment.startTime,
          status: appointment.status,
        },
      },
      200,
      res
    );
  } catch (error) {
    console.error("Get delay info error:", error.message);
    return ErrorHandler(error.message, 500, req, res);
  }
};

/**
 * @desc Get available time slots
 * @route GET /api/appointments/available
 * @access Public
 */
const getAvailableTimeSlots = async (req, res) => {
  // #swagger.tags = ['Appointments']
  /* #swagger.description = 'Get available time slots for a business on a specific date, optionally for a specific staff member. Respects booking buffer settings to prevent last-minute bookings. Time slots are filtered based on the user\'s local timezone to ensure past slots are not shown.'
     #swagger.parameters['businessId'] = { in: 'query', description: 'Business ID', required: true, type: 'string' }
     #swagger.parameters['serviceId'] = { in: 'query', description: 'Service ID', required: true, type: 'string' }
     #swagger.parameters['date'] = { in: 'query', description: 'Date (YYYY-MM-DD)', required: true, type: 'string' }
     #swagger.parameters['staffId'] = { in: 'query', description: 'Optional: Staff Member ID to check availability for. If provided, uses staff-specific booking buffer. If not provided, uses business default booking buffer.', type: 'string' }
     #swagger.parameters['timezoneOffset'] = { in: 'query', description: 'Optional timezone offset in minutes or HH:MM offset. Used to avoid showing past slots in the user local timezone.', type: 'string' }
     #swagger.responses[200] = {
        description: 'Available time slots (excluding slots within booking buffer for today)',
        schema: {
          availableSlots: ['10:00', '11:00', '13:00']
        }
     }
     #swagger.responses[400] = {
        description: 'Missing required parameters'
     }
     #swagger.responses[404] = {
        description: 'Business or service not found'
     }
  */
  try {
    const { businessId, serviceId, date, staffId, timezoneOffset } = req.query;

    if (!businessId || !date || !serviceId) {
      return ErrorHandler(
        "Business ID, Service ID, and Date are required",
        400,
        req,
        res
      );
    }

    const business = await Business.findById(businessId);
    if (!business) {
      return ErrorHandler("Business not found", 404, req, res);
    }
    const serviceInBusiness = await resolveCanonicalServiceForBusiness(
      business,
      serviceId
    );
    if (!serviceInBusiness) {
      return ErrorHandler(
        "Service not found or doesn't belong to this business",
        404,
        req,
        res
      );
    }

    // Determine if caller is staff or owner (who are allowed to bypass the automated block)
    const isBusinessCaller = req.user && (req.user.role === "barber" || req.user.role === "admin" || req.user.role === "sub-admin");

    // Check for blocking status (unexcused no-shows) for early stage booking flow
    if (!isBusinessCaller) {
      const checkClientId = (req.user && (req.user.type === "client" || req.user.role === "client")) 
        ? (req.user._id || req.user.id) 
        : (req.body.clientId || req.query.clientId);
        
      if (checkClientId) {
        const currentClient = await Client.findById(checkClientId);
        if (currentClient) {
          const { getComparablePhone } = require("../utils/index");
          const comparablePhone = getComparablePhone(currentClient.phone);
          const orConditions = [{ _id: currentClient._id }];
          if (comparablePhone && comparablePhone.length > 0) orConditions.push({ phoneComparable: comparablePhone });
          if (currentClient.email && currentClient.email.length > 0) orConditions.push({ email: currentClient.email?.toLowerCase() });

          const clientRegistrationQuery = {
            business: businessId,
            $or: orConditions
          };

          const allPotentialClients = await Client.find(clientRegistrationQuery);
          const blockedClient = allPotentialClients.find(c => c.appBookingBlocked === true);

          if (blockedClient) {
            const noShowDate = blockedClient.lastNoShowDate 
              ? moment(blockedClient.lastNoShowDate).format("DD/MM/YYYY")
              : "your last appointment";
              
            const businessPhone = business.contactInfo?.phone || business.phone || "your barber";
            
            return ErrorHandler(
              `If you are unable to attend an appointment, please cancel in advance by phone. Due to an unexcused no-show on ${noShowDate}, future appointments must be requested personally by calling ${businessPhone}.`,
              403,
              req,
              res
            );
          }
        }
      }
    }
    const availability = await getAvailabilityForBusiness({
      business,
      service: serviceInBusiness,
      serviceId,
      staffId,
      date,
      timezoneOffset: timezoneOffset || req.headers["x-timezone-offset"],
    });

    return SuccessHandler(availability, 200, res);
  } catch (error) {
    console.error("Get available time slots error:", error.message);
    return ErrorHandler(error.message, error.statusCode || 500, req, res);
  }
};

/**
 * @desc Get all appointments for a business
 * @route GET /api/business/appointments
 * @access Private (Business Owner)
 */
const getBusinessAppointments = async (req, res) => {
  // #swagger.tags = ['Business']
  /* #swagger.description = 'Get all appointments for the business owner, with filtering and search.'
     #swagger.security = [{ "Bearer": [] }]
     #swagger.parameters['status'] = {
        in: 'query',
        description: 'Filter by appointment status (e.g., Pending, Confirmed)',
        type: 'string'
     }
     #swagger.parameters['date'] = {
        in: 'query',
        description: 'Filter by specific date (YYYY-MM-DD)',
        type: 'string'
     }
     #swagger.parameters['search'] = {
        in: 'query',
        description: 'Search by client name or email',
        type: 'string'
     }
     #swagger.parameters['page'] = { in: 'query', description: 'Page number for pagination', type: 'integer' }
     #swagger.parameters['limit'] = { in: 'query', description: 'Number of items per page', type: 'integer' }
     #swagger.responses[200] = {
        description: 'List of appointments with pagination',
        schema: { $ref: '#/definitions/AppointmentList' }
     }
     #swagger.responses[404] = {
        description: 'Business not found for this user'
     }
  */
  try {
    const userId = req.user.id;
    const { status, date, search, page = 1, limit = 10 } = req.query;

    // Find the business owned by the user
    const business = await Business.findOne({ owner: userId });
    if (!business) {
      return ErrorHandler(
        "No business found for the current user.",
        404,
        req,
        res
      );
    }

    // Build the query
    let query = { business: business._id };

    if (status) {
      query.status = status;
    }

    if (date) {
      query.date = {
        $gte: moment(date).startOf("day").toDate(),
        $lte: moment(date).endOf("day").toDate(),
      };
    }

    // Build search query if 'search' is provided
    if (search) {
      // We need to find clients that match the search first
      const matchingClients = await User.find({
        $or: [
          { name: { $regex: search, $options: "i" } },
          { email: { $regex: search, $options: "i" } },
        ],
      }).select("_id");

      const clientIds = matchingClients.map((client) => client._id);

      // Add client filter to the main query
      query.client = { $in: clientIds };
    }

    // Pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Get appointments
    const appointments = await Appointment.find(query)
      .populate("service", "name duration price")
      .populate({
        path: "client",
        model: "User",
        select: "name email phone profileImage",
      })
      .populate("business", "name contactInfo.phone")
      .sort({ date: 1, startTime: 1 })
      .skip(skip)
      .limit(parseInt(limit));

    // Get total count for pagination
    const total = await Appointment.countDocuments(query);

    return SuccessHandler(
      {
        appointments,
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
    console.error("Get business appointments error:", error.message);
    return ErrorHandler(error.message, 500, req, res);
  }
};

/**
 * @desc Get appointment history for the logged-in user (with search and filters)
 * @route GET /api/appointments/history
 * @access Private
 */
const getAppointmentHistory = async (req, res) => {
  // #swagger.tags = ['Appointments']
  /* #swagger.description = 'Get appointment history (past appointments) for the logged-in user or their business, with search and filters.'
     #swagger.security = [{ "Bearer": [] }]
     #swagger.parameters['status'] = { in: 'query', description: 'Filter by status', type: 'string' }
     #swagger.parameters['duration'] = { in: 'query', description: 'Filter by duration in minutes', type: 'number' }
     #swagger.parameters['date'] = { in: 'query', description: 'Filter by date (YYYY-MM-DD)', type: 'string' }
     #swagger.parameters['search'] = { in: 'query', description: 'Search by service name', type: 'string' }
     #swagger.parameters['page'] = { in: 'query', description: 'Page number for pagination', type: 'integer' }
     #swagger.parameters['limit'] = { in: 'query', description: 'Number of items per page', type: 'integer' }
     #swagger.responses[200] = {
        description: 'List of past appointments',
        schema: { $ref: '#/definitions/AppointmentList' }
     }
  */
  try {
    const userId = req.user.id;
    const {
      status,
      duration,
      date,
      search,
      page = 1,
      limit = 10,
      sort,
    } = req.query;
    const today = new Date();

    // Determine if user is business owner
    const isBusinessOwner = await Business.exists({ owner: userId });
    let query = { date: { $lt: today } };

    if (isBusinessOwner) {
      // Get user's business
      const business = await Business.findOne({ owner: userId });
      query.business = business._id;
    } else {
      // Regular user (client)
      query.client = userId;
    }

    // Apply status filter
    if (status) {
      query.status = status;
    }

    // Apply duration filter (in minutes)
    if (duration) {
      query.duration = parseInt(duration, 10);
    }

    // Apply date filter (exact date)
    if (date) {
      const filterDate = new Date(date);
      query.date = {
        $gte: new Date(filterDate.setHours(0, 0, 0, 0)),
        $lt: new Date(filterDate.setHours(23, 59, 59, 999)),
      };
    }

    // Pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);
    let sortObj = {};
    if (sort) {
      // Example: firstName:asc, email:desc, position:asc
      const [field, direction] = sort.split(":");
      if (["client.firstName", "date", "duration", "status"].includes(field)) {
        sortObj[field] = direction === "desc" ? -1 : 1;
      }
    } else {
      sortObj["client.firstName"] = 1; // Default sort by firstName ascending
    }
    // Build base query
    let appointmentQuery = Appointment.find(query)
      .populate("service", "name duration price")
      .populate("staff", "name")
      .populate("business", "name contactInfo");

    // Apply search filter (by service name)
    if (search) {
      // Need to search by service name, so we use aggregation
      const matchStage = [
        { $match: query },
        {
          $lookup: {
            from: "services",
            localField: "service",
            foreignField: "_id",
            as: "service",
          },
        },
        { $unwind: "$service" },
        {
          $match: {
            "service.name": { $regex: search, $options: "i" },
          },
        },
        {
          $sort: { date: -1, startTime: -1 },
        },
        { $skip: skip },
        { $limit: parseInt(limit) },
        {
          $lookup: {
            from: "clients",
            localField: "client",
            foreignField: "_id",
            as: "client",
          },
        },
        { $unwind: "$client" },
        {
          $lookup: {
            from: "businesses",
            localField: "business",
            foreignField: "_id",
            as: "business",
          },
        },
        { $unwind: "$business" },
        {
          $lookup: {
            from: "staff",
            localField: "staff",
            foreignField: "_id",
            as: "staff",
          },
        },
        { $unwind: { path: "$staff", preserveNullAndEmptyArrays: true } },
      ];
      const appointments = await Appointment.aggregate(matchStage);
      const total = await Appointment.aggregate([
        { $match: query },
        {
          $lookup: {
            from: "services",
            localField: "service",
            foreignField: "_id",
            as: "service",
          },
        },
        { $unwind: "$service" },
        {
          $match: {
            "service.name": { $regex: search, $options: "i" },
          },
        },
        { $count: "total" },
      ]);
      return SuccessHandler(
        {
          appointments,
          pagination: {
            total: total[0] ? total[0].total : 0,
            page: parseInt(page),
            pages: Math.ceil((total[0] ? total[0].total : 0) / parseInt(limit)),
          },
        },
        200,
        res
      );
    }

    // If no search, use normal query
    const appointments = await appointmentQuery
      .sort({ date: -1, startTime: -1 })
      .skip(skip)
      .limit(parseInt(limit));
    const total = await Appointment.countDocuments(query);
    return SuccessHandler(
      {
        appointments,
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
    console.error("Get appointment history error:", error.message);
    return ErrorHandler(error.message, 500, req, res);
  }
};

/**
 * @desc Create appointment by barber (manual appointment creation)
 * @route POST /api/appointments/barber
 * @access Private (Business Owner/Barber)
 */
const createAppointmentByBarber = async (req, res) => {
  // #swagger.tags = ['Appointments']
  /* #swagger.description = 'Create a new appointment manually by barber for a client'
     #swagger.security = [{ "Bearer": [] }]
     #swagger.parameters['obj'] = {
        in: 'body',
        description: 'Appointment information for manual creation',
        required: true,
        schema: {
          clientId: 'client_user_id',
          serviceId: 'service_id',
          staffId: 'staff_id',
          date: '2025-03-15',
          startTime: '10:00',
          price: 50,
          notes: 'Optional barber notes',
          clientNotes: 'Optional client notes'
        }
     }
     #swagger.responses[201] = {
        description: 'Appointment created successfully by barber',
        schema: { $ref: '#/definitions/Appointment' }
     }
     #swagger.responses[400] = {
        description: 'Invalid input data or time conflict'
     }
     #swagger.responses[404] = {
        description: 'Client, Service, or Staff not found'
     }
     #swagger.responses[403] = {
        description: 'Not authorized to create appointments for this business'
     }
  */
  try {
    const {
      clientId,
      serviceId,
      staffId,
      date,
      startTime,
      price,
      // notes,
      // clientNotes,
    } = req.body;

    const barberId = req.user.id;

    // Validate required fields
    if (!clientId || !serviceId || !date || !startTime || !price) {
      return ErrorHandler(
        "Client ID, Service ID, Staff ID, Date, Start Time, and Price are required",
        400,
        req,
        res
      );
    }

    // Validate price
    if (isNaN(price) || price < 0) {
      return ErrorHandler(
        "Price must be a valid positive number",
        400,
        req,
        res
      );
    }

    // Validate time format
    const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$/;
    if (!timeRegex.test(startTime)) {
      return ErrorHandler(
        "Invalid start time format. Use HH:MM format",
        400,
        req,
        res
      );
    }

    // Get barber's business
    const business = await Business.findOne({ owner: barberId });
    if (!business) {
      return ErrorHandler("Business not found for this barber", 404, req, res);
    }

    // Validate client exists and belongs to this business
    const client = await Client.findOne({
      _id: clientId,
      business: business._id,
    });
    if (!client) {
      return ErrorHandler("Client not found", 404, req, res);
    }

    // Note: Barbers can book appointments for any client (registered or unregistered/walk-in)
    // The isProfileComplete check was removed because unregistered clients created via walk-in/phone
    // may not have email addresses, which made isProfileComplete=false and blocked booking.
    // Only client self-booking should enforce profile completeness.

    const service = await resolveCanonicalServiceForBusiness(
      business,
      serviceId
    );
    if (!service) {
      return ErrorHandler(
        "Service not found or doesn't belong to this business",
        404,
        req,
        res
      );
    }

    const hasAssignedStaffGlobalPublic = await Staff.exists({
      business: business._id,
      services: { $elemMatch: { service: serviceId } },
    });
    if (!hasAssignedStaffGlobalPublic) {
      return ErrorHandler(
        "This service is not assigned to any staff till now",
        400,
        req,
        res
      );
    }

    // Validate staff member (required)
    const staffMember = await Staff.findOne({
      _id: staffId,
      business: business._id,
    });
    if (!staffMember) {
      return ErrorHandler(
        "Staff member not found or does not belong to this business",
        404,
        req,
        res
      );
    }

    // Determine service duration from staff-service relationship
    const serviceItem = staffMember.services.find(
      (s) => s.service.toString() === serviceId
    );
    if (!serviceItem) {
      return ErrorHandler(
        "Selected service is not assigned to the specified staff member",
        400,
        req,
        res
      );
    }
    const serviceDuration = serviceItem.timeInterval; // minutes
    const endMoment = moment(startTime, "HH:mm").add(
      serviceDuration,
      "minutes"
    );
    const endTime = endMoment.format("HH:mm");

    // Check if appointment time is in the past
    const barberAppointmentDateTime = new Date(date);
    barberAppointmentDateTime.setHours(parseInt(startTime.split(":")[0], 10));
    barberAppointmentDateTime.setMinutes(parseInt(startTime.split(":")[1], 10));
    barberAppointmentDateTime.setSeconds(0, 0); // Reset seconds and milliseconds for accurate comparison

    const barberCurrentTime = new Date();
    barberCurrentTime.setSeconds(0, 0); // Reset seconds and milliseconds for accurate comparison

    if (barberAppointmentDateTime <= barberCurrentTime) {
      return ErrorHandler(
        "Cannot book appointments in the past. Please select a future time slot.",
        400,
        req,
        res
      );
    }

    // Check booking buffer if staff member is specified (only for today's appointments)
    // Buffer is applied relative to current time, not shift start time
    if (staffMember && staffMember.bookingBuffer > 0) {
      const appointmentDateOnly = new Date(date);
      appointmentDateOnly.setHours(0, 0, 0, 0);
      const todayDateOnly = new Date();
      todayDateOnly.setHours(0, 0, 0, 0);
      const isToday = appointmentDateOnly.getTime() === todayDateOnly.getTime();

      // Only apply buffer for today's appointments
      // For future dates, there's already sufficient advance notice
      if (isToday) {
        const timeDifference =
          barberAppointmentDateTime.getTime() - barberCurrentTime.getTime();
        const minutesDifference = Math.floor(timeDifference / (1000 * 60));

        if (minutesDifference < staffMember.bookingBuffer) {
          return ErrorHandler(
            `This appointment must be booked at least ${staffMember.bookingBuffer} minutes in advance. Current time difference: ${minutesDifference} minutes.`,
            400,
            req,
            res
          );
        }
      }
    }

    const capacityConflictMessage =
      "This staff member is not available at the selected time";
    const conflictingAppointment = await findCapacityConflict({
      businessId: business._id,
      staffId,
      date,
      startTime,
      endTime,
    });
    if (conflictingAppointment) {
      return ErrorHandler(capacityConflictMessage, 409, req, res);
    }

    // Handle reference photos if any
    // let referencePhotos = [];
    // if (req.files && req.files.length > 0) {
    //   const uploadPromises = req.files.map((photo) =>
    //     cloud.uploadStreamImage(photo.buffer)
    //   );
    //   const uploadResults = await Promise.all(uploadPromises);
    //   referencePhotos = uploadResults.map((result) => ({
    //     url: result.secure_url,
    //     public_id: result.public_id,
    //   }));
    // }

    // Get default reminder settings from business
    const defaultReminderSettings = business.defaultReminderSettings || {};

    // Create appointment data object
    const newAppointmentData = {
      client: clientId,
      business: business._id,
      service: serviceId,
      staff: staffId || null,
      date: new Date(date),
      startTime,
      endTime,
      duration: serviceDuration,
      price: parseFloat(price),
      // notes: notes || "",
      // clientNotes: clientNotes || "",
      // referencePhotos,
      status: "Confirmed", // Barber-created appointments are typically confirmed
      ...buildAppointmentSemanticState("Confirmed"),
      visitType: "appointment",
      policySnapshot: Appointment.buildPolicySnapshot(business),
      paymentStatus: "Pending",
      // Apply default reminder settings if they exist
      appointmentReminder: defaultReminderSettings.appointmentReminder || false,
      reminderTime: defaultReminderSettings.reminderTime || null,
      messageReminder: defaultReminderSettings.messageReminder || "",
    };

    // Check for active promotions
    const appointmentDate = new Date(date);
    const dayOfWeek = appointmentDate
      .toLocaleDateString("en-US", {
        weekday: "long",
      })
      .toLowerCase();

    // Convert serviceId to string for comparison (services in promotion are stored as ObjectIds)
    const serviceIdString = serviceId.toString();

    const activePromotions = await Promotion.find({
      business: business._id,
      dayOfWeek,
      isActive: true,
      services: serviceIdString,
    });

    // Check if the appointment time falls within any promotion hours
    let appliedPromotion = null;
    for (const promotion of activePromotions) {
      if (promotion.isTimeSlotInPromotion(startTime)) {
        appliedPromotion = promotion;
        break; // Use the first applicable promotion
      }
    }

    // Apply promotion if found
    if (appliedPromotion) {
      const originalPrice = service.price;
      const discountedPrice =
        appliedPromotion.calculateDiscountedPrice(originalPrice);
      const discountAmount = originalPrice - discountedPrice;

      newAppointmentData.price = discountedPrice;
      newAppointmentData.promotion = {
        applied: true,
        promotionId: appliedPromotion._id,
        originalPrice,
        discountAmount,
        discountPercentage: appliedPromotion.discountPercentage,
      };
    } else {
      // Explicitly set promotion defaults if no promotion is found
      newAppointmentData.promotion = {
        applied: false,
        promotionId: null,
        originalPrice: 0,
        discountAmount: 0,
        discountPercentage: 0,
      };
    }

    // Check for active flash sales
    const appointmentDateTime = new Date(date);
    appointmentDateTime.setHours(parseInt(startTime.split(":")[0], 10));
    appointmentDateTime.setMinutes(parseInt(startTime.split(":")[1], 10));
    appointmentDateTime.setSeconds(0, 0);
    appointmentDateTime.setMilliseconds(0);

    const activeFlashSales = await FlashSale.find({
      business: business._id,
      isActive: true,
      startDate: { $lte: appointmentDateTime },
      endDate: { $gte: appointmentDateTime },
    });

    // Apply flash sale if found
    if (activeFlashSales.length > 0) {
      const appliedFlashSale = activeFlashSales[0]; // Use the first active flash sale

      // Check if promotion has applyBothDiscounts flag set
      const shouldApplyBoth = appliedPromotion?.applyBothDiscounts === true;
      const shouldSkipFlashSale = appliedPromotion?.applyBothDiscounts === false && newAppointmentData.promotion?.applied;

      if (shouldApplyBoth && newAppointmentData.promotion?.applied) {
        // Apply both discounts: flash sale on top of promotion discount
        const promotionDiscountedPrice = newAppointmentData.price;
        const flashSaleDiscountedPrice =
          appliedFlashSale.calculateDiscountedPrice(promotionDiscountedPrice);
        const flashSaleDiscountAmount = promotionDiscountedPrice - flashSaleDiscountedPrice;
        const totalDiscountAmount = service.price - flashSaleDiscountedPrice;

        newAppointmentData.price = flashSaleDiscountedPrice;
        newAppointmentData.flashSale = {
          applied: true,
          flashSaleId: appliedFlashSale._id,
          originalPrice: promotionDiscountedPrice, // Price after promotion discount
          discountAmount: flashSaleDiscountAmount,
          discountPercentage: appliedFlashSale.discountPercentage,
        };
        // Keep promotion data as is
      } else if (shouldSkipFlashSale) {
        // Promotion has applyBothDiscounts: false, so skip flash sale and keep only promotion
        // Don't apply flash sale - promotion discount only
        newAppointmentData.flashSale = {
          applied: false,
          flashSaleId: null,
          originalPrice: 0,
          discountAmount: 0,
          discountPercentage: 0,
        };
        // Keep promotion data as is (already set above)
      } else {
        // No promotion or promotion doesn't have applyBothDiscounts flag set
        // Flash sale takes precedence over promotion (default behavior)
        const originalPrice = newAppointmentData.promotion?.applied
          ? newAppointmentData.promotion.originalPrice
          : service.price;
        const discountedPrice =
          appliedFlashSale.calculateDiscountedPrice(originalPrice);
        const discountAmount = originalPrice - discountedPrice;

        newAppointmentData.price = discountedPrice;
        newAppointmentData.flashSale = {
          applied: true,
          flashSaleId: appliedFlashSale._id,
          originalPrice,
          discountAmount,
          discountPercentage: appliedFlashSale.discountPercentage,
        };

        // If there was a promotion applied, remove it since flash sale takes precedence
        if (newAppointmentData.promotion?.applied) {
          newAppointmentData.promotion = {
            applied: false,
            originalPrice: 0,
            discountAmount: 0,
            discountPercentage: 0,
          };
        }
      }
    } else {
      // No flash sale found - set flash sale data to defaults
      newAppointmentData.flashSale = {
        applied: false,
        flashSaleId: null,
        originalPrice: 0,
        discountAmount: 0,
        discountPercentage: 0,
      };
    }

    // Check for pending penalties and apply them
    // A client might exist in the 'clients' collection but not yet as a 'user' if added manually.
    // In that case, they won't have pending penalties.
    const clientUser = await User.findById(clientId);
    if (clientUser && clientUser.pendingPenalties) {
      const pendingPenalties = clientUser.pendingPenalties.filter(
        (penalty) =>
          penalty.business.toString() === business._id.toString() &&
          !penalty.applied
      );

      if (pendingPenalties.length > 0) {
        const totalPenaltyAmount = pendingPenalties.reduce(
          (sum, penalty) => sum + penalty.amount,
          0
        );
        newAppointmentData.penalty = {
          applied: true,
          amount: totalPenaltyAmount,
          paid: false,
          notes: `Applied from ${pendingPenalties.length} missed appointment penalty(ies)`,
        };

        // Mark penalties as applied
        pendingPenalties.forEach((penalty) => {
          penalty.applied = true;
          penalty.appliedToAppointment = newAppointmentData._id;
        });

        await clientUser.save();
      }
    }

    const newAppointment = await runWithCapacityGuard({
      businessId: business._id,
      staffId,
      date,
      startTime,
      endTime,
      conflictMessage: capacityConflictMessage,
      operation: async ({ session }) => {
        const [createdAppointment] = await Appointment.create(
          [newAppointmentData],
          { session }
        );
        return createdAppointment;
      },
    });
    await recordDomainEvent({
      type: "booking_created",
      actorId: req.user._id || req.user.id,
      shopId: business._id,
      correlationId: newAppointment._id,
      payload: buildBookingEventPayload(newAppointment, {
        source: "barber_booking",
      }),
    });

    // Populate the appointment with related data for response
    const populatedAppointment = await Appointment.findById(newAppointment._id)
      .populate("service", "name duration price")
      .populate({
        path: "client",
        model: "Client",
        select: "firstName lastName email phone",
      })
      .populate("business", "name contactInfo.phone")
      .populate("staff", "firstName lastName");

    // Send notifications only if the client is a registered user
    if (clientUser) {
      // Send appointment creation notification
      await sendNotification(
        clientUser,
        "New Appointment Created",
        `A new appointment has been created for you on ${moment(date).format(
          "MMM DD, YYYY"
        )} at ${startTime}`,
        "client",
        { appointmentId: newAppointment._id }
      );

      // Send notification to admins
      await sendNotificationToAdmins(
        "New Appointment Created by Barber",
        `A new appointment has been created by barber for ${clientUser.name || "a client"
        } on ${moment(date).format("MMM DD, YYYY")} at ${startTime}`,
        "admin",
        {
          appointmentId: newAppointment._id,
          clientId: clientUser._id,
          businessId: business._id,
        }
      );

      // Check again for penalties that were just applied to notify the user.
      const appliedPenalties = pendingPenalties.filter((p) => p.applied);
      if (appliedPenalties.length > 0) {
        const totalPenaltyAmount = appliedPenalties.reduce(
          (sum, penalty) => sum + penalty.amount,
          0
        );
        await sendNotification(
          clientUser,
          "Penalty Applied to Appointment",
          `Your pending penalty(ies) totaling $${totalPenaltyAmount} have been applied to your new appointment.`,
          "client",
          { appointmentId: newAppointment._id }
        );

        // Send penalty notification to admins
        await sendNotificationToAdmins(
          "Penalty Applied to Appointment",
          `Penalty(ies) totaling $${totalPenaltyAmount} have been applied to ${clientUser.name || "a client"
          }'s appointment created by barber.`,
          "admin",
          {
            appointmentId: newAppointment._id,
            clientId: clientUser._id,
            businessId: business._id,
            penaltyAmount: totalPenaltyAmount,
          }
        );
      }
    }

    // Send notification to barber
    const clientFullName = `${populatedAppointment.client.firstName} ${populatedAppointment.client.lastName}`;
    const barberUser = await User.findById(barberId);
    if (barberUser) {
      await sendNotification(
        barberUser,
        "Appointment Created Successfully",
        `Appointment created for ${clientFullName} on ${moment(date).format(
          "MMM DD, YYYY"
        )} at ${startTime}`,
        "barber",
        { appointmentId: newAppointment._id }
      );
    }

    // Send notification to admins about barber-created appointment
    await sendNotificationToAdmins(
      "Appointment Created by Barber",
      `Barber created appointment for ${clientFullName} on ${moment(
        date
      ).format("MMM DD, YYYY")} at ${startTime}`,
      "admin",
      {
        appointmentId: newAppointment._id,
        businessId: business._id,
        clientName: clientFullName,
        barberId: barberId,
      }
    );

    return SuccessHandler(populatedAppointment, 201, res);
  } catch (error) {
    console.error("Create appointment by barber error:", error.message);
    return ErrorHandler(error.message, error.statusCode || 500, req, res);
  }
};

/**
 * @desc Get appointment statistics (counts and percentages by status)
 * @route GET /api/appointments/stats
 * @access Private
 */
const getAppointmentStats = async (req, res) => {
  // #swagger.tags = ['Appointments']
  /* #swagger.description = 'Get appointment statistics including total count and breakdown by status with percentages'
     #swagger.security = [{ "Bearer": [] }]
     #swagger.responses[200] = {
        description: 'Appointment statistics retrieved successfully',
        schema: {
          totalAppointments: 100,
          stats: {
            booked: { count: 20, percentage: 20 },
            confirmed: { count: 30, percentage: 30 },
            completed: { count: 35, percentage: 35 },
            noShows: { count: 10, percentage: 10 },
            cancelled: { count: 5, percentage: 5 },
            missed: { count: 5, percentage: 5 }
          }
        }
     }
  */
  try {
    // Handle both user and client authentication
    const userId = req.user.id || req.user._id;
    const userType = req.user.type;

    let query = {};

    if (userType === "client") {
      // Client user - get their appointments
      query.client = userId;
    } else {
      // Regular user - check if business owner
      const isBusinessOwner = await Business.exists({ owner: userId });

      if (isBusinessOwner) {
        // Get user's business
        const business = await Business.findOne({ owner: userId });
        if (!business) {
          return ErrorHandler(
            "Business not found for this user",
            404,
            req,
            res
          );
        }
        query.business = business._id;
      } else {
        // Regular user (client) - fallback
        query.client = userId;
      }
    }

    // Get total count
    const totalAppointments = await Appointment.countDocuments(query);

    if (totalAppointments === 0) {
      return SuccessHandler(
        {
          totalAppointments: 0,
          stats: {
            booked: { count: 0, percentage: 0 },
            confirmed: { count: 0, percentage: 0 },
            completed: { count: 0, percentage: 0 },
            noShows: { count: 0, percentage: 0 },
            cancelled: { count: 0, percentage: 0 },
            missed: { count: 0, percentage: 0 },
          },
        },
        200,
        res
      );
    }

    // Get counts for each status
    const statusCounts = await Appointment.aggregate([
      { $match: query },
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
        },
      },
    ]);

    // Initialize stats object
    const stats = {
      booked: { count: 0, percentage: 0 },
      confirmed: { count: 0, percentage: 0 },
      completed: { count: 0, percentage: 0 },
      noShows: { count: 0, percentage: 0 },
      cancelled: { count: 0, percentage: 0 },
      missed: { count: 0, percentage: 0 },
    };

    // Process status counts and calculate percentages
    statusCounts.forEach((statusCount) => {
      const count = statusCount.count;
      const percentage = ((count / totalAppointments) * 100).toFixed(1);

      switch (statusCount._id) {
        case "Pending":
          stats.booked.count = count;
          stats.booked.percentage = parseFloat(percentage);
          break;
        case "Confirmed":
          stats.confirmed.count = count;
          stats.confirmed.percentage = parseFloat(percentage);
          break;
        case "Completed":
          stats.completed.count = count;
          stats.completed.percentage = parseFloat(percentage);
          break;
        case "No-Show":
          stats.noShows.count = count;
          stats.noShows.percentage = parseFloat(percentage);
          break;
        case "Canceled":
          stats.cancelled.count = count;
          stats.cancelled.percentage = parseFloat(percentage);
          break;
        case "Missed":
          stats.missed.count = count;
          stats.missed.percentage = parseFloat(percentage);
          break;
        default:
          // Handle any unexpected statuses
          break;
      }
    });

    return SuccessHandler(
      {
        totalAppointments,
        stats,
      },
      200,
      res
    );
  } catch (error) {
    console.error("Get appointment stats error:", error.message);
    return ErrorHandler(error.message, 500, req, res);
  }
};

/**
 * @desc Get comprehensive dashboard statistics with date filtering, staff filtering, 
 *       agenda occupancy calculation, and previous period comparison
 * @route GET /api/appointments/dashboard-stats
 * @access Private
 */
const getDashboardStats = async (req, res) => {
  // #swagger.tags = ['Appointments']
  /* #swagger.description = 'Get dashboard statistics including agenda occupancy, appointment status breakdown, and previous period comparison'
     #swagger.security = [{ "Bearer": [] }]
     #swagger.parameters['month'] = {
        in: 'query',
        description: 'Month (1-12)',
        type: 'integer',
        example: 2
     }
     #swagger.parameters['year'] = {
        in: 'query',
        description: 'Year (e.g., 2026)',
        type: 'integer',
        example: 2026
     }
     #swagger.parameters['staffId'] = {
        in: 'query',
        description: 'Staff ID for individual barber stats (optional, omit for global stats)',
        type: 'string'
     }
     #swagger.responses[200] = {
        description: 'Dashboard statistics retrieved successfully'
     }
  */
  try {
    const userId = req.user.id || req.user._id;
    const userType = req.user.type;
    const { month, year, staffId } = req.query;

    // Validate month/year
    const selectedMonth = parseInt(month, 10) || new Date().getMonth() + 1;
    const selectedYear = parseInt(year, 10) || new Date().getFullYear();

    // Calculate date range for selected period
    const startDate = new Date(selectedYear, selectedMonth - 1, 1);
    const endDate = new Date(selectedYear, selectedMonth, 0, 23, 59, 59, 999);

    // Calculate previous period (immediately previous month)
    const prevMonth = selectedMonth === 1 ? 12 : selectedMonth - 1;
    const prevYear = selectedMonth === 1 ? selectedYear - 1 : selectedYear;
    const prevStartDate = new Date(prevYear, prevMonth - 1, 1);
    const prevEndDate = new Date(prevYear, prevMonth, 0, 23, 59, 59, 999);

    let baseQuery = {};

    if (userType === "client") {
      baseQuery.client = userId;
    } else {
      const business = await Business.findOne({ owner: userId });
      if (!business) {
        return ErrorHandler("Business not found for this user", 404, req, res);
      }
      baseQuery.business = business._id;

      // Add staff filter if provided
      if (staffId) {
        baseQuery.staff = mongoose.Types.ObjectId.isValid(staffId)
          ? new mongoose.Types.ObjectId(staffId)
          : staffId;
      }

      // Calculate available minutes for the selected period
      const availableMinutes = await calculateAvailableMinutes(
        business,
        staffId,
        startDate,
        endDate
      );

      const prevAvailableMinutes = await calculateAvailableMinutes(
        business,
        staffId,
        prevStartDate,
        prevEndDate
      );

      // Get current period stats
      const currentQuery = {
        ...baseQuery,
        date: { $gte: startDate, $lte: endDate },
      };

      const prevQuery = {
        ...baseQuery,
        date: { $gte: prevStartDate, $lte: prevEndDate },
      };

      // Aggregate current period appointments
      const currentStats = await Appointment.aggregate([
        { $match: currentQuery },
        {
          $group: {
            _id: null,
            totalAppointments: { $sum: 1 },
            bookedMinutes: { $sum: { $ifNull: ["$duration", 30] } },
            finished: {
              $sum: { $cond: [{ $eq: ["$status", "Completed"] }, 1, 0] },
            },
            cancelled: {
              $sum: { $cond: [{ $eq: ["$status", "Canceled"] }, 1, 0] },
            },
            noShow: {
              $sum: { $cond: [{ $eq: ["$status", "No-Show"] }, 1, 0] },
            },
          },
        },
      ]);

      // Aggregate previous period appointments
      const prevStats = await Appointment.aggregate([
        { $match: prevQuery },
        {
          $group: {
            _id: null,
            totalAppointments: { $sum: 1 },
            bookedMinutes: { $sum: { $ifNull: ["$duration", 30] } },
            finished: {
              $sum: { $cond: [{ $eq: ["$status", "Completed"] }, 1, 0] },
            },
            cancelled: {
              $sum: { $cond: [{ $eq: ["$status", "Canceled"] }, 1, 0] },
            },
            noShow: {
              $sum: { $cond: [{ $eq: ["$status", "No-Show"] }, 1, 0] },
            },
          },
        },
      ]);

      const current = currentStats[0] || {
        totalAppointments: 0,
        bookedMinutes: 0,
        finished: 0,
        cancelled: 0,
        noShow: 0,
      };

      const prev = prevStats[0] || {
        totalAppointments: 0,
        bookedMinutes: 0,
        finished: 0,
        cancelled: 0,
        noShow: 0,
      };

      // Calculate agenda occupancy
      const agendaOccupancy =
        availableMinutes > 0
          ? parseFloat(
              ((current.bookedMinutes / availableMinutes) * 100).toFixed(1)
            )
          : 0;

      const prevAgendaOccupancy =
        prevAvailableMinutes > 0
          ? parseFloat(
              ((prev.bookedMinutes / prevAvailableMinutes) * 100).toFixed(1)
            )
          : 0;

      // Calculate percentage changes (current vs previous period)
      const calculateChange = (current, previous) => {
        if (previous === 0) return current > 0 ? 100 : 0;
        return parseFloat((((current - previous) / previous) * 100).toFixed(1));
      };

      // Calculate rates as percentage of total appointments
      const total = current.totalAppointments;
      const finishedRate = total > 0 ? parseFloat(((current.finished / total) * 100).toFixed(1)) : 0;
      const cancelledRate = total > 0 ? parseFloat(((current.cancelled / total) * 100).toFixed(1)) : 0;
      const noShowRate = total > 0 ? parseFloat(((current.noShow / total) * 100).toFixed(1)) : 0;

      // Get list of staff members for filter dropdown
      const staffList = await Staff.find({ business: baseQuery.business })
        .select("_id firstName lastName")
        .lean();

      return SuccessHandler(
        {
          period: {
            month: selectedMonth,
            year: selectedYear,
            startDate: startDate.toISOString(),
            endDate: endDate.toISOString(),
          },
          previousPeriod: {
            month: prevMonth,
            year: prevYear,
          },
          agendaOccupancy: {
            percentage: agendaOccupancy,
            bookedMinutes: current.bookedMinutes,
            availableMinutes: availableMinutes,
            formula: "(booked minutes / available minutes) × 100",
            change: calculateChange(agendaOccupancy, prevAgendaOccupancy),
          },
          appointments: {
            total: current.totalAppointments,
            change: calculateChange(
              current.totalAppointments,
              prev.totalAppointments
            ),
            definition:
              "Total number of appointments scheduled within the selected period",
          },
          appointmentStatus: {
            finished: {
              count: current.finished,
              percentage: finishedRate,
              change: calculateChange(current.finished, prev.finished),
              definition:
                "Appointments marked as completed by the barber",
            },
            cancelled: {
              count: current.cancelled,
              percentage: cancelledRate,
              change: calculateChange(current.cancelled, prev.cancelled),
              definition: "Appointments cancelled by the client",
            },
            noShow: {
              count: current.noShow,
              percentage: noShowRate,
              change: calculateChange(current.noShow, prev.noShow),
              definition:
                "Appointments where the client did not attend, marked by the barber",
            },
          },
          staffFilter: {
            selectedStaffId: staffId || null,
            staffList: staffList.map((s) => ({
              id: s._id,
              name: `${s.firstName} ${s.lastName}`,
            })),
          },
          tooltips: {
            agendaOccupancy:
              "Percentage of available time that has been booked. Formula: (booked minutes / available minutes) × 100",
            appointments:
              "Total appointments scheduled for the selected month/year. Only counts appointments where the scheduled date falls within the period.",
            finished:
              "Appointments successfully completed. This is the final state - appointment cannot change after this.",
            cancelled:
              "Appointments cancelled by the client. Counted based on the original scheduled date, not cancellation date.",
            noShow:
              "Client did not attend the appointment. Marked by the barber. This is a final state.",
            percentageChange:
              "Comparison against the immediately previous month. Positive values indicate improvement.",
          },
        },
        200,
        res
      );
    }

    // For client users, return simplified stats
    const currentQuery = {
      ...baseQuery,
      date: { $gte: startDate, $lte: endDate },
    };

    const stats = await Appointment.aggregate([
      { $match: currentQuery },
      {
        $group: {
          _id: "$status",
          count: { $sum: 1 },
        },
      },
    ]);

    const statusMap = {};
    stats.forEach((s) => {
      statusMap[s._id] = s.count;
    });

    return SuccessHandler(
      {
        period: { month: selectedMonth, year: selectedYear },
        appointments: {
          total: Object.values(statusMap).reduce((a, b) => a + b, 0),
        },
        appointmentStatus: {
          finished: { count: statusMap["Completed"] || 0 },
          cancelled: { count: statusMap["Canceled"] || 0 },
          noShow: { count: statusMap["No-Show"] || 0 },
        },
      },
      200,
      res
    );
  } catch (error) {
    console.error("Get dashboard stats error:", error.message);
    return ErrorHandler(error.message, 500, req, res);
  }
};

/**
 * Helper function to calculate available minutes for a business/staff within a date range
 */
const calculateAvailableMinutes = async (
  business,
  staffId,
  startDate,
  endDate
) => {
  let totalMinutes = 0;
  const currentDate = new Date(startDate);

  // Get staff working hours if staffId is provided
  let staffWorkingHours = null;
  if (staffId) {
    const staff = await Staff.findById(staffId).lean();
    if (staff && staff.workingHours && staff.workingHours.length > 0) {
      staffWorkingHours = staff.workingHours;
    }
  }

  const dayNames = [
    "sunday",
    "monday",
    "tuesday",
    "wednesday",
    "thursday",
    "friday",
    "saturday",
  ];

  while (currentDate <= endDate) {
    const dayName = dayNames[currentDate.getDay()];

    if (staffWorkingHours) {
      // Use staff-specific working hours
      const daySchedule = staffWorkingHours.find((wh) => wh.day === dayName);
      if (daySchedule && daySchedule.enabled && daySchedule.shifts) {
        for (const shift of daySchedule.shifts) {
          const minutes = calculateShiftMinutes(shift);
          totalMinutes += minutes;
        }
      }
    } else if (business.businessHours && business.businessHours[dayName]) {
      // Use business working hours
      const daySchedule = business.businessHours[dayName];
      if (daySchedule.enabled && daySchedule.shifts) {
        for (const shift of daySchedule.shifts) {
          const minutes = calculateShiftMinutes(shift);
          totalMinutes += minutes;
        }
      }
    }

    currentDate.setDate(currentDate.getDate() + 1);
  }

  return totalMinutes;
};

/**
 * Helper function to calculate minutes in a shift
 */
const calculateShiftMinutes = (shift) => {
  if (!shift.start || !shift.end) return 0;

  const parseTime = (timeStr) => {
    const [hours, minutes] = timeStr.split(":").map(Number);
    return hours * 60 + (minutes || 0);
  };

  const startMinutes = parseTime(shift.start);
  const endMinutes = parseTime(shift.end);

  // Handle shifts that might cross midnight
  let shiftMinutes = endMinutes - startMinutes;
  if (shiftMinutes < 0) {
    shiftMinutes += 24 * 60;
  }

  // Subtract break time if breaks are defined
  if (shift.breaks && Array.isArray(shift.breaks)) {
    for (const breakPeriod of shift.breaks) {
      if (breakPeriod.start && breakPeriod.end) {
        const breakStart = parseTime(breakPeriod.start);
        const breakEnd = parseTime(breakPeriod.end);
        let breakMinutes = breakEnd - breakStart;
        if (breakMinutes < 0) breakMinutes += 24 * 60;
        shiftMinutes -= breakMinutes;
      }
    }
  }

  return Math.max(0, shiftMinutes);
};

/**
 * @desc Get revenue projection with date range filtering
 * @route GET /api/appointments/revenue-projection
 * @access Private
 */
const getRevenueProjection = async (req, res) => {
  // #swagger.tags = ['Appointments']
  /* #swagger.description = 'Get revenue projection data for dashboard charts with date range filtering'
     #swagger.security = [{ "Bearer": [] }]
     #swagger.parameters['startDate'] = {
        in: 'query',
        description: 'Start date for revenue projection (YYYY-MM-DD)',
        type: 'string',
        example: '2025-01-01'
     }
     #swagger.parameters['endDate'] = {
        in: 'query',
        description: 'End date for revenue projection (YYYY-MM-DD)',
        type: 'string',
        example: '2025-12-31'
     }
     #swagger.parameters['groupBy'] = {
        in: 'query',
        description: 'Group revenue data by: year, day, week, month',
        type: 'string',
        enum: ['year', 'day', 'week', 'month'],
        default: 'year'
     }
     #swagger.parameters['staffId'] = {
        in: 'query',
        description: 'Staff ID to filter by individual barber (optional)',
        type: 'string'
     }
     #swagger.responses[200] = {
        description: 'Revenue projection data retrieved successfully',
        schema: {
          totalRevenue: 15000,
          totalAppointments: 150,
          averageRevenuePerAppointment: 100,
          revenueData: [
            {
              date: '2025',
              revenue: 15000,
              appointments: 150,
              completedAppointments: 120,
              cancelledAppointments: 15
            }
          ],
          summary: {
            totalRevenue: 15000,
            totalAppointments: 150,
            averageRevenuePerAppointment: 100,
            completionRate: 85.5
          }
        }
     }
  */
  try {
    // Handle both user and client authentication
    const userId = req.user.id || req.user._id;
    const userType = req.user.type;
    const { startDate, endDate, groupBy = "year", staffId } = req.query;

    let appointmentQuery = {};
    let paymentQuery = {
      status: { $in: ["captured", "refunded_partial", "refunded_full"] },
    };

    if (userType === "client") {
      // Client user - get their appointments
      const clientId = req.client?._id || userId;
      appointmentQuery.client = clientId;
      paymentQuery.client = clientId;
    } else {
      // Regular user - check if business owner
      const isBusinessOwner = await Business.exists({ owner: userId });

      if (isBusinessOwner) {
        // Get user's business
        const business = await Business.findOne({ owner: userId });
        if (!business) {
          return ErrorHandler(
            "Business not found for this user",
            404,
            req,
            res
          );
        }
        appointmentQuery.business = business._id;
        paymentQuery.business = business._id;
        
        // Add staff filter if provided
        if (staffId) {
          const normalizedStaffId = mongoose.Types.ObjectId.isValid(staffId)
            ? new mongoose.Types.ObjectId(staffId)
            : staffId;
          appointmentQuery.staff = normalizedStaffId;
          paymentQuery.staff = normalizedStaffId;
        }
      } else {
        // Regular user (client) - fallback
        const clientId = req.client?._id || userId;
        appointmentQuery.client = clientId;
        paymentQuery.client = clientId;
      }
    }

    const appointmentDateClause = buildDateRangeClause("date", startDate, endDate);
    const paymentDateClause = buildDateRangeClause("capturedAt", startDate, endDate);

    appointmentQuery = {
      ...appointmentQuery,
      ...(appointmentDateClause || {}),
      date: {
        ...(appointmentDateClause?.date || {}),
        $ne: null,
      },
    };
    paymentQuery = {
      ...paymentQuery,
      ...(paymentDateClause || {}),
    };

    const response = await getCanonicalRevenueProjection({
      appointmentMatch: appointmentQuery,
      paymentMatch: paymentQuery,
      groupBy,
    });

    response.filters = {
      startDate: startDate || null,
      endDate: endDate || null,
      groupBy,
      staffId: staffId || null,
    };

    return SuccessHandler(response, 200, res);
  } catch (error) {
    console.error("Get revenue projection error:", error.message);
    return ErrorHandler(error.message, 500, req, res);
  }
};

/**
 * @desc Apply penalty to client for missed appointment
 * @route POST /api/appointments/:id/penalty
 * @access Private (Business Owner)
 */
const applyPenalty = async (req, res) => {
  // #swagger.tags = ['Appointments']
  /* #swagger.description = 'Apply penalty to client for missed appointment'
     #swagger.security = [{ "Bearer": [] }]
     #swagger.parameters['id'] = {
        in: 'path',
        description: 'Appointment ID',
        required: true,
        type: 'string'
     }
     #swagger.parameters['obj'] = {
        in: 'body',
        description: 'Penalty information',
        required: true,
        schema: {
          amount: 25
        }
     }
     #swagger.responses[200] = {
        description: 'Penalty applied successfully',
        schema: { $ref: '#/definitions/Appointment' }
     }
     #swagger.responses[404] = {
        description: 'Appointment not found'
     }
     #swagger.responses[403] = {
        description: 'Not authorized to apply penalty'
     }
  */
  try {
    const { amount, type, time, comment } = req.body;
    const appointmentId = req.params.id;
    const userId = req.user.id;

    // Validate penalty type - currently only money penalties are supported
    if (type && type !== "money") {
      return ErrorHandler(
        "Only money penalties are currently supported. Time-based penalties are not yet implemented.",
        400,
        req,
        res
      );
    }

    // Validate required fields - amount is required for money penalties
    if (!amount) {
      return ErrorHandler(
        "Amount is required for money penalties",
        400,
        req,
        res
      );
    }

    // Validate amount
    if (isNaN(amount) || amount <= 0) {
      return ErrorHandler("Amount must be a positive number", 400, req, res);
    }

    // Note: time-based penalties are not yet implemented
    // If time is provided, it will be ignored for now

    // Find appointment
    const appointment = await Appointment.findById(appointmentId)
      .populate("client", "firstName lastName email")
      .populate("business", "name");

    if (!appointment) {
      return ErrorHandler("Appointment not found", 404, req, res);
    }

    // Check authorization - only business owner can apply penalties
    const business = await Business.findById(appointment.business);
    if (business.owner.toString() !== userId) {
      return ErrorHandler("Not authorized to apply penalty", 403, req, res);
    }

    const expectedPolicyFee = getExpectedPolicyFeeForAppointment(
      appointment,
      business
    );

    const isPolicyPenaltyEligible =
      appointment.status === "Missed" ||
      appointment.status === "No-Show" ||
      appointment.policyOutcome?.type === "late_cancel";

    // Check if appointment is eligible for penalty.
    if (!isPolicyPenaltyEligible) {
      return ErrorHandler(
        "Penalty can only be applied to no-show or late-cancel appointments",
        400,
        req,
        res
      );
    }

    if (expectedPolicyFee.waived) {
      return ErrorHandler(
        "Policy fee was waived and cannot be applied manually",
        409,
        req,
        res
      );
    }

    if (expectedPolicyFee.amount <= 0) {
      return ErrorHandler(
        "No policy fee is available for this appointment",
        400,
        req,
        res
      );
    }

    if (parseFloat(amount) !== expectedPolicyFee.amount) {
      return ErrorHandler(
        "Penalty amount must match the frozen appointment policy",
        400,
        req,
        res
      );
    }

    // Check if penalty already exists
    if (appointment.penalty.applied) {
      return ErrorHandler(
        "Penalty already applied to this appointment",
        400,
        req,
        res
      );
    }

    // Apply penalty to appointment
    // Use comment if provided, otherwise use default message
    const policyReasonLabel =
      expectedPolicyFee.type === "late_cancel" ? "late-cancel" : "no-show";
    const penaltyNotes = comment
      ? `Applied from ${policyReasonLabel} policy fee: ${comment}`
      : `Applied from ${policyReasonLabel} policy fee`;

    appointment.penalty = {
      applied: true,
      amount: expectedPolicyFee.amount,
      paid: false,
      type: expectedPolicyFee.type,
      source: "policy_snapshot",
      assessedAt: new Date(),
      assessedBy: userId,
      notes: penaltyNotes,
    };

    await appointment.save();

    // Add penalty to client's pending penalties
    // Note: appointment.client references Client model, but pendingPenalties is in User model
    // We need to find the User by the Client's email or phone
    const clientDoc = await Client.findById(appointment.client);

    if (clientDoc) {
      // Try to find the corresponding User by email
      const client = await User.findOne({ email: clientDoc.email });

      if (client) {
        // Ensure pendingPenalties is initialized as an array
        if (!client.pendingPenalties) {
          client.pendingPenalties = [];
        }

        client.pendingPenalties.push({
          business: appointment.business,
          amount: expectedPolicyFee.amount,
          reason:
            expectedPolicyFee.type === "late_cancel"
              ? "late-cancel"
              : "no-show",
          appointmentId: appointment._id,
          appliedDate: new Date(),
          applied: false,
        });

        await client.save();
      } else {
        // If client doesn't exist in User collection, log a warning but don't fail
        console.warn(
          `Client ${clientDoc.email} not found in User collection. Penalty not added to pending penalties.`
        );
      }
    }

    // Send notification to client
    await sendNotification(
      appointment.client,
      "Penalty Applied",
      `A penalty of $${expectedPolicyFee.amount} has been applied for your ${policyReasonLabel} appointment on ${moment(
        appointment.date
      ).format("MMM DD, YYYY")} at ${appointment.startTime
      }. This will be added to your next appointment.`,
      "client",
      { appointmentId: appointment._id }
    );

    // Send notification to admins
    await sendNotificationToAdmins(
      "Penalty Applied",
      `Penalty of $${expectedPolicyFee.amount} has been applied to ${appointment.client.firstName
      } ${appointment.client.lastName} for ${policyReasonLabel} appointment on ${moment(
        appointment.date
      ).format("MMM DD, YYYY")} at ${appointment.startTime}.`,
      "admin",
      {
        appointmentId: appointment._id,
        clientId: appointment.client._id,
        businessId: appointment.business,
        penaltyAmount: expectedPolicyFee.amount,
      }
    );

    return SuccessHandler(
      {
        message: "Penalty applied successfully",
        appointment: appointment,
        penaltyAmount: expectedPolicyFee.amount,
      },
      200,
      res
    );
  } catch (error) {
    console.error("Apply penalty error:", error.message);
    return ErrorHandler(error.message, 500, req, res);
  }
};

/**
 * @desc Get client penalties (for business owner)
 * @route GET /api/appointments/penalties/:clientId
 * @access Private (Business Owner)
 */
const getClientPenalties = async (req, res) => {
  // #swagger.tags = ['Appointments']
  /* #swagger.description = 'Get all penalties for a specific client'
     #swagger.security = [{ "Bearer": [] }]
     #swagger.parameters['clientId'] = {
        in: 'path',
        description: 'Client ID',
        required: true,
        type: 'string'
     }
     #swagger.responses[200] = {
        description: 'Client penalties retrieved successfully',
        schema: {
          pendingPenalties: [
            {
              business: 'business_id',
              amount: 25,
              reason: 'no-show',
              appointmentId: 'appointment_id',
              appliedDate: '2025-01-15T10:00:00Z',
              applied: false
            }
          ],
          totalPendingAmount: 50
        }
     }
  */
  try {
    const { clientId } = req.params;
    const userId = req.user.id;

    // Find client
    const client = await User.findById(clientId);
    if (!client) {
      return ErrorHandler("Client not found", 404, req, res);
    }

    // Check if user is business owner
    const business = await Business.findOne({ owner: userId });
    if (!business) {
      return ErrorHandler(
        "Not authorized to view client penalties",
        403,
        req,
        res
      );
    }

    // Filter penalties for this business
    // Ensure pendingPenalties is an array (default to empty array if null/undefined)
    const pendingPenalties = client.pendingPenalties || [];
    const businessPenalties = pendingPenalties.filter(
      (penalty) =>
        penalty.business.toString() === business._id.toString() &&
        !penalty.applied
    );

    const totalPendingAmount = businessPenalties.reduce(
      (sum, penalty) => sum + penalty.amount,
      0
    );

    return SuccessHandler(
      {
        pendingPenalties: businessPenalties,
        totalPendingAmount: totalPendingAmount,
        clientName: `${client.firstName} ${client.lastName}`,
        clientEmail: client.email,
      },
      200,
      res
    );
  } catch (error) {
    console.error("Get client penalties error:", error.message);
    return ErrorHandler(error.message, 500, req, res);
  }
};

/**
 * @desc Pay penalty (mark as paid)
 * @route PUT /api/appointments/penalties/:penaltyId/pay
 * @access Private (Business Owner)
 */
const payPenalty = async (req, res) => {
  // #swagger.tags = ['Appointments']
  /* #swagger.description = 'Mark a penalty as paid'
     #swagger.security = [{ "Bearer": [] }]
     #swagger.parameters['penaltyId'] = {
        in: 'path',
        description: 'Penalty ID (index in pendingPenalties array)',
        required: true,
        type: 'string'
     }
     #swagger.parameters['obj'] = {
        in: 'body',
        description: 'Payment information',
        required: true,
        schema: {
          clientId: 'client_id',
          appointmentId: 'appointment_id_to_apply_penalty_to'
        }
     }
     #swagger.responses[200] = {
        description: 'Penalty marked as paid successfully',
        schema: {
          message: 'Penalty paid successfully',
          penaltyAmount: 25
        }
     }
  */
  try {
    const { clientId, appointmentId } = req.body;
    const penaltyId = req.params.penaltyId;
    const userId = req.user.id;

    // Validate required fields
    if (!clientId || !appointmentId) {
      return ErrorHandler(
        "Client ID and appointment ID are required",
        400,
        req,
        res
      );
    }

    // Check if user is business owner
    const business = await Business.findOne({ owner: userId });
    if (!business) {
      return ErrorHandler("Not authorized to pay penalties", 403, req, res);
    }

    // Find client
    const client = await User.findById(clientId);
    if (!client) {
      return ErrorHandler("Client not found", 404, req, res);
    }

    // Find appointment
    const appointment = await Appointment.findById(appointmentId);
    if (!appointment) {
      return ErrorHandler("Appointment not found", 404, req, res);
    }

    // Check if appointment belongs to this business
    if (appointment.business.toString() !== business._id.toString()) {
      return ErrorHandler(
        "Appointment does not belong to this business",
        403,
        req,
        res
      );
    }

    // Find the penalty in client's pending penalties
    // Ensure pendingPenalties is an array (default to empty array if null/undefined)
    const pendingPenalties = client.pendingPenalties || [];
    const penaltyIndex = pendingPenalties.findIndex(
      (penalty) =>
        penalty.business.toString() === business._id.toString() &&
        penalty.appointmentId.toString() === penaltyId
    );

    if (penaltyIndex === -1) {
      return ErrorHandler("Penalty not found", 404, req, res);
    }

    const penalty = pendingPenalties[penaltyIndex];

    // Check if penalty is already applied
    if (penalty.applied) {
      return ErrorHandler("Penalty already applied", 400, req, res);
    }

    // Mark penalty as applied
    // Ensure pendingPenalties is initialized before accessing
    if (!client.pendingPenalties) {
      client.pendingPenalties = [];
    }
    client.pendingPenalties[penaltyIndex].applied = true;
    client.pendingPenalties[penaltyIndex].appliedToAppointment = appointmentId;

    await client.save();

    // Update appointment to include penalty
    appointment.penalty = {
      applied: true,
      amount: penalty.amount,
      paid: true,
      paidDate: new Date(),
      notes: "Applied from missed appointment penalty",
    };

    await appointment.save();

    // Send notification to client
    await sendNotification(
      clientId,
      "client",
      "Penalty Applied",
      `Your pending penalty of $${penalty.amount
      } has been applied to your appointment on ${moment(
        appointment.date
      ).format("MMM DD, YYYY")} at ${appointment.startTime}.`,
      "penalty",
      { appointmentId: appointment._id }
    );

    // Send notification to admins
    await sendNotificationToAdmins(
      "Penalty Paid",
      `Pending penalty of $${penalty.amount
      } has been paid and applied to appointment on ${moment(
        appointment.date
      ).format("MMM DD, YYYY")} at ${appointment.startTime}.`,
      "admin",
      {
        appointmentId: appointment._id,
        clientId: clientId,
        businessId: appointment.business,
        penaltyAmount: penalty.amount,
      }
    );

    return SuccessHandler(
      {
        message: "Penalty applied successfully",
        penaltyAmount: penalty.amount,
        appointment: appointment,
      },
      200,
      res
    );
  } catch (error) {
    console.error("Pay penalty error:", error.message);
    return ErrorHandler(error.message, 500, req, res);
  }
};

/**
 * @desc Automated appointment reminder sender
 * @route POST /api/appointments/automated-reminder
 * @access Private (Business Owner/Barber)
 */
const automatedReminder = async (req, res) => {
  // #swagger.tags = ['Appointments']
  /* #swagger.description = 'Send automated appointment reminders to clients based on their stored reminder settings, or filter by reminderTime and appointmentReminder toggle from the frontend.'
     #swagger.security = [{ "Bearer": [] }]
     #swagger.parameters['reminderTime'] = {
        in: 'body',
        description: 'Optional: Only send reminders for this reminderTime interval (e.g., 1_hour_before)',
        required: false,
        type: 'string',
        enum: ['1_hour_before', '2_hours_before', '3_hours_before', '4_hours_before']
     }
     #swagger.parameters['appointmentReminder'] = {
        in: 'body',
        description: 'Whether to send reminders only for appointments with reminders enabled (toggle from frontend)',
        required: false,
        type: 'boolean'
     }
     #swagger.responses[200] = {
        description: 'Reminders sent successfully',
        schema: {
          message: 'Reminders sent successfully',
          totalReminders: 10
        }
     }
     #swagger.responses[400] = {
        description: 'No appointments found or no reminders sent'
     }
  */
  try {
    const userId = req.user.id;
    const { appointmentReminder, reminderTime } = req.body;
    // Find the business owned by the user
    const business = await Business.findOne({ owner: userId });
    if (!business) {
      return ErrorHandler(
        "No business found for the current user.",
        404,
        req,
        res
      );
    }
    // Map enum to hours
    const reminderMap = {
      "1_hour_before": 1,
      "2_hours_before": 2,
      "3_hours_before": 3,
      "4_hours_before": 4,
    };
    const now = new Date();

    // Build filter for appointments
    // If appointmentReminder is not specified, only check appointments with reminders enabled
    // If specified as false, check all appointments (for testing/debugging)
    const apptReminderFilter =
      appointmentReminder === undefined
        ? { appointmentReminder: true }
        : appointmentReminder === false
          ? {} // No filter - check all appointments
          : { appointmentReminder: appointmentReminder };

    // Build reminderTime filter
    // If reminderTime is specified, only check that specific time
    // Otherwise, check all valid reminder times (exclude null - can't send reminder without a time)
    const reminderTimeFilter =
      reminderTime && reminderMap[reminderTime]
        ? { reminderTime: reminderTime }
        : { reminderTime: { $in: Object.keys(reminderMap) } };

    // Build the complete query
    // Note: date filter uses start of today to include today's appointments
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);

    const query = {
      business: business._id,
      status: { $in: ["Pending", "Confirmed"] },
      date: { $gte: startOfToday }, // Include appointments from today onwards
      ...apptReminderFilter,
      ...reminderTimeFilter,
    };

    console.log("=== Automated Reminder Query Debug ===");
    console.log("Query:", JSON.stringify(query, null, 2));
    console.log("Current time:", now.toISOString());
    console.log("Business ID:", business._id.toString());
    console.log("AppointmentReminder filter:", appointmentReminder);
    console.log("ReminderTime filter:", reminderTime || "all valid times");

    // First, let's check how many appointments exist with basic criteria
    const totalAppointments = await Appointment.countDocuments({
      business: business._id,
      status: { $in: ["Pending", "Confirmed"] },
      date: { $gte: startOfToday },
    });
    console.log(
      `Total appointments (Pending/Confirmed, from today onwards): ${totalAppointments}`
    );

    const appointmentsWithReminders = await Appointment.countDocuments({
      business: business._id,
      status: { $in: ["Pending", "Confirmed"] },
      date: { $gte: startOfToday },
      appointmentReminder: true,
    });
    console.log(
      `Appointments with appointmentReminder: true: ${appointmentsWithReminders}`
    );

    const appointmentsWithReminderTime = await Appointment.countDocuments({
      business: business._id,
      status: { $in: ["Pending", "Confirmed"] },
      date: { $gte: startOfToday },
      reminderTime: { $in: Object.keys(reminderMap) },
    });
    console.log(
      `Appointments with valid reminderTime: ${appointmentsWithReminderTime}`
    );

    const appointmentsWithBoth = await Appointment.countDocuments({
      business: business._id,
      status: { $in: ["Pending", "Confirmed"] },
      date: { $gte: startOfToday },
      appointmentReminder: true,
      reminderTime: { $in: Object.keys(reminderMap) },
    });
    console.log(
      `Appointments with BOTH appointmentReminder: true AND valid reminderTime: ${appointmentsWithBoth}`
    );

    const appointments = await Appointment.find(query).populate(
      "client",
      "firstName lastName email phone isActive status"
    );

    console.log(
      `Found ${appointments.length} appointments matching all query criteria`
    );
    console.log("=====================================");
    let totalReminders = 0;
    for (const appt of appointments) {
      // Only send to active/activated clients with a phone number
      if (
        appt.client &&
        appt.client.phone &&
        appt.client.isActive &&
        appt.client.status === "activated"
      ) {
        // Calculate the reminder window for this appointment
        const hoursBefore = reminderMap[appt.reminderTime];

        // Skip if reminderTime is invalid or not in map
        if (!hoursBefore || !appt.reminderTime) {
          console.log(
            `Skipping appointment ${appt._id}: Invalid reminderTime (${appt.reminderTime})`
          );
          continue;
        }

        // Create appointment date-time with proper timezone handling
        const apptDateTime = new Date(appt.date);
        const [h, m] = appt.startTime.split(":");
        apptDateTime.setHours(parseInt(h, 10));
        apptDateTime.setMinutes(parseInt(m, 10));
        apptDateTime.setSeconds(0, 0);
        apptDateTime.setMilliseconds(0);

        // Calculate when the reminder should be sent (X hours before appointment)
        const reminderTargetTime = new Date(
          apptDateTime.getTime() - hoursBefore * 60 * 60 * 1000
        );

        // Reminder window: 30 minutes before and 30 minutes after the target time
        // This gives a 1-hour window to catch the reminder
        const reminderWindowStart = new Date(
          reminderTargetTime.getTime() - 30 * 60 * 1000
        );
        const reminderWindowEnd = new Date(
          reminderTargetTime.getTime() + 30 * 60 * 1000
        );

        // Check if current time is within the reminder window
        if (now >= reminderWindowStart && now < reminderWindowEnd) {
          console.log(
            `Starting SMS credit validation for reminder to ${appt.client.phone}`
          );
          console.log(`Business ID: ${appt.business}`);
          console.log(`Appointment ID: ${appt._id}`);
          console.log(`Reminder target time: ${reminderTargetTime}`);
          console.log(`Current time: ${now}`);
          console.log(`Window: ${reminderWindowStart} to ${reminderWindowEnd}`);

          let smsSent = false;
          let smsError = null;

          try {
            // Format appointment date for message
            const appointmentDateStr = appt.date.toLocaleDateString("en-US", {
              weekday: "short",
              year: "numeric",
              month: "short",
              day: "numeric",
            });

            // Send SMS with credit validation
            const smsResult = await sendSMSWithCredits(
              appt.client.phone,
              `${appt.messageReminder || "Appointment Reminder"
              } - Your appointment is at ${appt.startTime
              } on ${appointmentDateStr}`,
              appt.business,
              req,
              res
            );

            console.log(`SMS Result for reminder:`, smsResult);

            // Check if SMS was sent successfully
            if (smsResult && smsResult.error) {
              console.error(
                "Insufficient SMS credits for reminder:",
                smsResult.message
              );
              smsError = smsResult.message;
              // Don't increment counter if credits insufficient
            } else if (smsResult && smsResult.success) {
              smsSent = true;
              totalReminders++;
              console.log(
                `Reminder SMS sent successfully to ${appt.client.phone}`
              );
            } else {
              // Handle case where result doesn't have expected structure
              console.error(
                "Unexpected SMS result structure:",
                JSON.stringify(smsResult)
              );
              smsError = "Unexpected SMS result";
            }
          } catch (smsError) {
            // Log but do not fail the request if SMS fails
            console.error("Failed to send reminder SMS:", smsError.message);
            smsError = smsError.message;
          }

          // Log final SMS status
          console.log(`Reminder SMS final status:`, {
            sent: smsSent,
            error: smsError,
            appointmentId: appt._id,
            clientPhone: appt.client.phone,
            reminderTime: appt.reminderTime,
            hoursBefore: hoursBefore,
          });
        } else {
          // Log when reminder is skipped due to timing
          console.log(
            `Skipping reminder for appointment ${appt._id}: Current time (${now}) is not within reminder window (${reminderWindowStart} to ${reminderWindowEnd})`
          );
        }
      }
    }
    return SuccessHandler(
      {
        message:
          totalReminders > 0
            ? "Reminders sent successfully"
            : "No reminders were sent (check SMS credits or appointment settings)",
        totalReminders,
        smsStatus: {
          remindersSent: totalReminders,
          totalAppointmentsChecked: appointments.length,
          businessCredits: business.smsCredits || 0,
        },
        diagnostics: {
          totalAppointments,
          appointmentsWithReminders,
          appointmentsWithReminderTime,
          appointmentsWithBoth,
          queryUsed: {
            appointmentReminder:
              appointmentReminder === undefined ? true : appointmentReminder,
            reminderTime: reminderTime || "all valid times",
            dateFilter: "from today onwards",
            statusFilter: ["Pending", "Confirmed"],
          },
          note:
            appointments.length === 0
              ? "No appointments found. Make sure appointments have appointmentReminder: true and a valid reminderTime set. Use PUT /api/appointments/:id/reminder-settings to configure reminders."
              : "Appointments found but may not be within reminder window or may have other issues (check logs for details).",
        },
      },
      200,
      res
    );
  } catch (error) {
    console.error("Automated reminder error:", error.message);
    return ErrorHandler(error.message, 500, req, res);
  }
};

/**
 * @desc Update appointment reminder settings (reminderTime and appointmentReminder)
 * @route PUT /api/appointments/:id/reminder-settings
 * @access Private (Business Owner/Barber)
 */
const updateAppointmentReminderSettings = async (req, res) => {
  // #swagger.tags = ['Appointments']
  /* #swagger.description = 'Update reminder time and enable/disable appointment reminder for an appointment.'
     #swagger.security = [{ "Bearer": [] }]
     #swagger.parameters['id'] = {
        in: 'path',
        description: 'Appointment ID',
        required: true,
        type: 'string'
     }
     #swagger.parameters['obj'] = {
        in: 'body',
        description: 'Reminder settings',
        required: true,
        schema: {
          reminderTime: '1_hour_before',
          appointmentReminder: true
        }
     }
     #swagger.responses[200] = {
        description: 'Reminder settings updated successfully',
        schema: {
          message: 'Reminder settings updated',
          appointment: { $ref: '#/definitions/Appointment' }
        }
     }
     #swagger.responses[404] = {
        description: 'Appointment not found'
     }
     #swagger.responses[400] = {
        description: 'Invalid input'
     }
  */
  try {
    const { reminderTime, appointmentReminder } = req.body;
    const appointmentId = req.params.id;
    // Validate input
    const validTimes = [
      "1_hour_before",
      "2_hours_before",
      "3_hours_before",
      "4_hours_before",
    ];
    if (reminderTime && !validTimes.includes(reminderTime)) {
      return ErrorHandler("Invalid reminder time", 400, req, res);
    }
    if (
      appointmentReminder !== undefined &&
      typeof appointmentReminder !== "boolean"
    ) {
      return ErrorHandler(
        "appointmentReminder must be a boolean",
        400,
        req,
        res
      );
    }
    // Find appointment
    const appointment = await Appointment.findById(appointmentId);
    if (!appointment) {
      return ErrorHandler("Appointment not found", 404, req, res);
    }
    // Update fields
    if (reminderTime) appointment.reminderTime = reminderTime;
    if (appointmentReminder !== undefined)
      appointment.appointmentReminder = appointmentReminder;
    await appointment.save();
    return SuccessHandler(
      {
        message: "Reminder settings updated",
        appointment,
      },
      200,
      res
    );
  } catch (error) {
    console.error("Update reminder settings error:", error.message);
    return ErrorHandler(error.message, 500, req, res);
  }
};

/**
 * @desc Get current reminder settings for the business
 * @route GET /api/appointments/reminder-settings
 * @access Private (Business Owner/Barber)
 */
const getReminderSettings = async (req, res) => {
  // #swagger.tags = ['Appointments']
  /* #swagger.description = 'Get current reminder settings for the business'
     #swagger.security = [{ "Bearer": [] }]
     #swagger.responses[200] = {
        description: 'Reminder settings retrieved successfully',
        schema: {
          appointmentReminder: true,
          reminderTime: '2_hours_before',
          messageReminder: 'Custom message'
        }
     }
     #swagger.responses[404] = {
        description: 'Business not found'
     }
  */
  try {
    const userId = req.user.id;

    // Find the business owned by the user
    const business = await Business.findOne({ owner: userId });
    if (!business) {
      return ErrorHandler(
        "No business found for the current user.",
        404,
        req,
        res
      );
    }

    // Get default reminder settings from business
    const defaultSettings = business.defaultReminderSettings || {
      appointmentReminder: false,
      reminderTime: null,
      messageReminder: "",
    };

    return SuccessHandler(
      {
        appointmentReminder: defaultSettings.appointmentReminder || false,
        reminderTime: defaultSettings.reminderTime || null,
        messageReminder: defaultSettings.messageReminder || "",
      },
      200,
      res
    );
  } catch (error) {
    console.error("Get reminder settings error:", error.message);
    return ErrorHandler(error.message, 500, req, res);
  }
};

/**
 * @desc Bulk update reminder settings for all future appointments
 * @route PUT /api/appointments/bulk-update-reminder-settings
 * @access Private (Business Owner/Barber)
 */
const bulkUpdateReminderSettings = async (req, res) => {
  // #swagger.tags = ['Appointments']
  /* #swagger.description = 'Bulk update reminder settings for all future appointments (from today onwards)'
     #swagger.security = [{ "Bearer": [] }]
     #swagger.parameters['obj'] = {
        in: 'body',
        description: 'Reminder settings to apply to all future appointments',
        required: true,
        schema: {
          reminderTime: '2_hours_before',
          appointmentReminder: true,
          messageReminder: 'Optional custom message'
        }
     }
     #swagger.responses[200] = {
        description: 'Reminder settings updated successfully',
        schema: {
          message: 'Reminder settings updated for X appointments',
          appointmentsUpdated: 10
        }
     }
     #swagger.responses[400] = {
        description: 'Invalid input'
     }
  */
  try {
    const { reminderTime, appointmentReminder, messageReminder } = req.body;
    const userId = req.user.id;

    // Find the business owned by the user
    const business = await Business.findOne({ owner: userId });
    if (!business) {
      return ErrorHandler(
        "No business found for the current user.",
        404,
        req,
        res
      );
    }

    // Validate input
    const validTimes = [
      "1_hour_before",
      "2_hours_before",
      "3_hours_before",
      "4_hours_before",
    ];
    if (reminderTime && !validTimes.includes(reminderTime)) {
      return ErrorHandler("Invalid reminder time", 400, req, res);
    }
    if (
      appointmentReminder !== undefined &&
      typeof appointmentReminder !== "boolean"
    ) {
      return ErrorHandler(
        "appointmentReminder must be a boolean",
        400,
        req,
        res
      );
    }

    // Build update object
    const updateData = {};
    if (reminderTime !== undefined) {
      // Allow null to clear reminder time when disabling reminders
      updateData.reminderTime = reminderTime;
    }
    if (appointmentReminder !== undefined)
      updateData.appointmentReminder = appointmentReminder;
    if (messageReminder !== undefined)
      updateData.messageReminder = messageReminder;

    // Get start of today
    const now = new Date();
    const startOfToday = new Date(now);
    startOfToday.setHours(0, 0, 0, 0);

    // Update all future appointments (from today onwards) with status Pending or Confirmed
    const result = await Appointment.updateMany(
      {
        business: business._id,
        date: { $gte: startOfToday },
        status: { $in: ["Pending", "Confirmed"] },
      },
      updateData
    );

    // Also save these settings as defaults for new appointments
    if (business.defaultReminderSettings) {
      if (appointmentReminder !== undefined) {
        business.defaultReminderSettings.appointmentReminder =
          appointmentReminder;
      }
      if (reminderTime !== undefined) {
        business.defaultReminderSettings.reminderTime = reminderTime;
      }
      if (messageReminder !== undefined) {
        business.defaultReminderSettings.messageReminder = messageReminder;
      }
      await business.save();
    }

    return SuccessHandler(
      {
        message: `Reminder settings updated for ${result.modifiedCount} appointment(s) and saved as default for new appointments`,
        appointmentsUpdated: result.modifiedCount,
        appointmentsMatched: result.matchedCount,
      },
      200,
      res
    );
  } catch (error) {
    console.error("Bulk update reminder settings error:", error.message);
    return ErrorHandler(error.message, 500, req, res);
  }
};

/**
 * @desc Generate review link for a client
 * @route POST /api/appointments/generate-review-link
 * @access Private (Business Owner/Barber)
 */
const generateReviewLink = async (req, res) => {
  // #swagger.tags = ['Appointments']
  /* #swagger.description = 'Generate and send a Google review link to a client via SMS'
     #swagger.security = [{ "Bearer": [] }]
     #swagger.parameters['obj'] = {
        in: 'body',
        description: 'Review link generation data',
        required: true,
        schema: {
          clientId: 'string',
          message: 'string'
        }
     }
     #swagger.responses[200] = {
        description: 'Review link sent successfully via SMS',
        schema: {
          message: 'Review link sent successfully',
          reviewLink: 'string',
          smsSent: true
        }
     }
     #swagger.responses[404] = {
        description: 'Client not found'
     }
     #swagger.responses[400] = {
        description: 'Client has no phone number or business has no review link configured'
     }
  */
  try {
    const userId = req.user.id;
    const { clientId, message } = req.body;

    // Find the business owned by the user
    const business = await Business.findOne({ owner: userId });
    if (!business) {
      return ErrorHandler(
        "No business found for the current user.",
        404,
        req,
        res
      );
    }

    // Find the client (Client model)
    const client = await Client.findOne({
      _id: clientId,
      business: business._id,
    });
    if (!client) {
      return ErrorHandler("Client not found", 404, req, res);
    }

    // Check if client has a phone number
    if (!client.phone) {
      return ErrorHandler(
        "Client does not have a phone number. Please add a phone number to the client profile first.",
        400,
        req,
        res
      );
    }

    // Generate the proper Google review link
    let reviewLink;

    if (business.googlePlaceId) {
      // Use Place ID to generate direct review link
      reviewLink = `https://search.google.com/local/writereview?placeid=${business.googlePlaceId}`;
    } else if (business.googleReviewUrl) {
      // Use stored direct review URL
      reviewLink = business.googleReviewUrl;
    } else {
      return ErrorHandler(
        "No Google review link configured for your business. Please add your Google Place ID or direct review URL in your business settings.",
        400,
        req,
        res
      );
    }

    // Prepare the SMS message
    const businessName = business.businessName || business.name || "Our Business";
    const clientName = `${client.firstName || ""} ${client.lastName || ""}`.trim();
    const customMessage = message || `Thank you for visiting ${businessName}! We'd love to hear about your experience. Please leave us a review:`;
    const fullMessage = `${customMessage} ${reviewLink}`;

    // Send SMS using the credit-aware messaging utility
    // Success check is handled by the utility
    const smsResult = await sendSMSWithCredits(
      client.phone,
      fullMessage,
      business._id,
      req,
      res
    );

    if (!smsResult.success) {
      return ErrorHandler(
        smsResult.error || "Failed to send SMS. Please check your SMS credits.",
        400,
        req,
        res
      );
    }

    return SuccessHandler(
      {
        message: "Review link sent successfully via SMS",
        reviewLink,
        clientName,
        smsSent: true,
        smsCreditsRemaining: smsResult.creditsRemaining,
      },
      200,
      res
    );
  } catch (error) {
    console.error("Generate review link error:", error.message);
    return ErrorHandler(error.message, 500, req, res);
  }
};

// const automatedReminder = async (req, res) => {
//   // #swagger.tags = ['Appointments']
//   /* #swagger.description = 'Send automated appointment reminders to clients based on their stored reminder settings, or filter by reminderTime and appointmentReminder toggle from the frontend.'
//      #swagger.security = [{ "Bearer": [] }]
//      #swagger.parameters['reminderTime'] = {
//         in: 'body',
//         description: 'Optional: Only send reminders for this reminderTime interval (e.g., 1_hour_before)',
//         required: false,
//         type: 'string',
//         enum: ['1_hour_before', '2_hours_before', '3_hours_before', '4_hours_before']
//      }
//      #swagger.parameters['appointmentReminder'] = {
//         in: 'body',
//         description: 'Whether to send reminders only for appointments with reminders enabled (toggle from frontend)',
//         required: false,
//         type: 'boolean'
//      }
//      #swagger.responses[200] = {
//         description: 'Reminders sent successfully',
//         schema: {
//           message: 'Reminders sent successfully',
//           totalReminders: 10
//         }
//      }
//      #swagger.responses[400] = {
//         description: 'No appointments found or no reminders sent'
//      }
//   */
//   try {
//     const userId = req.user.id;
//     const { appointmentReminder, reminderTime } = req.body;
//     // Find the business owned by the user
//     const business = await Business.findOne({ owner: userId });
//     if (!business) {
//       return ErrorHandler(
//         "No business found for the current user.",
//         404,
//         req,
//         res
//       );
//     }
//     // Map enum to hours
//     const reminderMap = {
//       "1_hour_before": 1,
//       "2_hours_before": 2,
//       "3_hours_before": 3,
//       "4_hours_before": 4,
//     };
//     const now = new Date();
//     // Build filter for appointments
//     const apptReminderFilter =
//       appointmentReminder === undefined
//         ? { appointmentReminder: true }
//         : { appointmentReminder: appointmentReminder };
//     const reminderTimeFilter =
//       reminderTime && reminderMap[reminderTime]
//         ? { reminderTime: reminderTime }
//         : { reminderTime: { $in: Object.keys(reminderMap) } };
//     const appointments = await Appointment.find({
//       business: business._id,
//       status: { $in: ["Pending", "Confirmed"] },
//       ...apptReminderFilter,
//       ...reminderTimeFilter,
//       date: { $gte: now },
//     }).populate("client", "firstName lastName email phone isActive status");
//     let totalReminders = 0;
//     for (const appt of appointments) {
//       // Only send to active/activated clients with a phone number
//       if (
//         appt.client &&
//         appt.client.phone &&
//         appt.client.isActive &&
//         appt.client.status === "activated"
//       ) {
//         // Calculate the reminder window for this appointment
//         const hoursBefore = reminderMap[appt.reminderTime];

//         // Skip if reminderTime is invalid or not in map
//         if (!hoursBefore || !appt.reminderTime) {
//           console.log(
//             `Skipping appointment ${appt._id}: Invalid reminderTime (${appt.reminderTime})`
//           );
//           continue;
//         }

//         // Create appointment date-time with proper timezone handling
//         const apptDateTime = new Date(appt.date);
//         const [h, m] = appt.startTime.split(":");
//         apptDateTime.setHours(parseInt(h, 10));
//         apptDateTime.setMinutes(parseInt(m, 10));
//         apptDateTime.setSeconds(0, 0);
//         apptDateTime.setMilliseconds(0);

//         // Calculate when the reminder should be sent (X hours before appointment)
//         const reminderTargetTime = new Date(
//           apptDateTime.getTime() - hoursBefore * 60 * 60 * 1000
//         );

//         // Reminder window: 30 minutes before and 30 minutes after the target time
//         // This gives a 1-hour window to catch the reminder
//         const reminderWindowStart = new Date(
//           reminderTargetTime.getTime() - 30 * 60 * 1000
//         );
//         const reminderWindowEnd = new Date(
//           reminderTargetTime.getTime() + 30 * 60 * 1000
//         );

//         // Check if current time is within the reminder window
//         if (now >= reminderWindowStart && now < reminderWindowEnd) {
//           console.log(
//             `Starting SMS credit validation for reminder to ${appt.client.phone}`
//           );
//           console.log(`Business ID: ${appt.business}`);
//           console.log(`Appointment ID: ${appt._id}`);
//           console.log(`Reminder target time: ${reminderTargetTime}`);
//           console.log(`Current time: ${now}`);
//           console.log(`Window: ${reminderWindowStart} to ${reminderWindowEnd}`);

//           let smsSent = false;
//           let smsError = null;

//           try {
//             // Format appointment date for message
//             const appointmentDateStr = appt.date.toLocaleDateString("en-US", {
//               weekday: "short",
//               year: "numeric",
//               month: "short",
//               day: "numeric",
//             });

//             // Send SMS with credit validation
//             const smsResult = await sendSMSWithCredits(
//               appt.client.phone,
//               `${
//                 appt.messageReminder || "Appointment Reminder"
//               } - Your appointment is at ${
//                 appt.startTime
//               } on ${appointmentDateStr}`,
//               appt.business,
//               req,
//               res
//             );

//             console.log(`SMS Result for reminder:`, smsResult);

//             // Check if SMS was sent successfully
//             if (smsResult && smsResult.error) {
//               console.error(
//                 "Insufficient SMS credits for reminder:",
//                 smsResult.message
//               );
//               smsError = smsResult.message;
//               // Don't increment counter if credits insufficient
//             } else if (smsResult && smsResult.success) {
//               smsSent = true;
//               totalReminders++;
//               console.log(
//                 `Reminder SMS sent successfully to ${appt.client.phone}`
//               );
//             } else {
//               // Handle case where result doesn't have expected structure
//               console.error(
//                 "Unexpected SMS result structure:",
//                 JSON.stringify(smsResult)
//               );
//               smsError = "Unexpected SMS result";
//             }
//           } catch (smsError) {
//             // Log but do not fail the request if SMS fails
//             console.error("Failed to send reminder SMS:", smsError.message);
//             smsError = smsError.message;
//           }

//           // Log final SMS status
//           console.log(`Reminder SMS final status:`, {
//             sent: smsSent,
//             error: smsError,
//             appointmentId: appt._id,
//             clientPhone: appt.client.phone,
//             reminderTime: appt.reminderTime,
//             hoursBefore: hoursBefore,
//           });
//         } else {
//           // Log when reminder is skipped due to timing
//           console.log(
//             `Skipping reminder for appointment ${appt._id}: Current time (${now}) is not within reminder window (${reminderWindowStart} to ${reminderWindowEnd})`
//           );
//         }
//       }
//     }
//     return SuccessHandler(
//       {
//         message:
//           totalReminders > 0
//             ? "Reminders sent successfully"
//             : "No reminders were sent (check SMS credits or appointment settings)",
//         totalReminders,
//         smsStatus: {
//           remindersSent: totalReminders,
//           totalAppointmentsChecked: appointments.length,
//           businessCredits: business.smsCredits || 0,
//         },
//       },
//       200,
//       res
//     );
//   } catch (error) {
//     console.error("Automated reminder error:", error.message);
//     return ErrorHandler(error.message, 500, req, res);
//   }
// };

module.exports = {
  createAppointment,
  getAppointments,
  getAppointmentById,
  updateAppointmentStatus,
  updateAppointment,
  getAvailableTimeSlots,
  getBusinessAppointments,
  getAppointmentHistory,
  createAppointmentByBarber,
  checkInAppointment,
  startAppointmentService,
  getAppointmentStats,
  getDashboardStats,
  getRevenueProjection,
  applyPenalty,
  getClientPenalties,
  payPenalty,
  notifyDelay,
  getDelayInfo,
  automatedReminder,
  updateAppointmentReminderSettings,
  getReminderSettings,
  bulkUpdateReminderSettings,
  generateReviewLink,
};
