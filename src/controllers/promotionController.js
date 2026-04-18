const Promotion = require("../models/promotion");
const FlashSale = require("../models/flashSale");
const Business = require("../models/User/business");
const Appointment = require("../models/appointment");
const Service = require("../models/service");
const SuccessHandler = require("../utils/SuccessHandler");
const ErrorHandler = require("../utils/ErrorHandler");
const moment = require("moment");

/**
 * @desc Create a new promotion (Happy Hours)
 * @route POST /api/promotions
 * @access Private (Business Owner)
 */
const createPromotion = async (req, res) => {
  // #swagger.tags = ['Promotions']
  /* #swagger.description = 'Create a new Happy Hours promotion for the business'
     #swagger.security = [{ "Bearer": [] }]
     #swagger.parameters['obj'] = {
        in: 'body',
        description: 'Promotion details',
        required: true,
        schema: {
          name: 'Monday Happy Hours',
          description: '20% off all haircuts on Monday afternoons',
          dayOfWeek: 'monday',
          startTime: '14:00',
          endTime: '18:00',
          discountPercentage: 20,
          services: ['service_id_1', 'service_id_2'],
          confirmMultiple: false
        }
     }
     #swagger.responses[409] = {
        description: 'Multiple discounts warning - requires confirmation',
        schema: {
          message: 'You already have Happy Hours active. Are you sure you want to activate Monday Happy Hours as well?',
          code: 'MULTIPLE_DISCOUNTS_WARNING',
          existingPromotions: []
        }
     }
     #swagger.responses[201] = {
        description: 'Promotion created successfully',
        schema: { $ref: '#/definitions/Promotion' }
     }
     #swagger.responses[400] = {
        description: 'Validation error or time conflict'
     }
     #swagger.responses[404] = {
        description: 'Business or services not found'
     }
  */
  try {
    const {
      name,
      description,
      dayOfWeek,
      startTime,
      endTime,
      discountPercentage,
      services,
    } = req.body;

    // Validate required fields
    if (
      !dayOfWeek ||
      !startTime ||
      !endTime ||
      !discountPercentage ||
      !services ||
      !Array.isArray(services) ||
      services.length === 0
    ) {
      return ErrorHandler(
        "Day of week, start time, end time, discount percentage, and at least one service are required",
        400,
        req,
        res
      );
    }

    // Validate day of week
    const validDays = [
      "monday",
      "tuesday",
      "wednesday",
      "thursday",
      "friday",
      "saturday",
      "sunday",
    ];
    if (!validDays.includes(dayOfWeek)) {
      return ErrorHandler("Invalid day of week", 400, req, res);
    }

    // Validate time format
    const timeRegex = /^([01]?[0-9]|2[0-3]):[0-5][0-9]$/;
    if (!timeRegex.test(startTime) || !timeRegex.test(endTime)) {
      return ErrorHandler("Time must be in HH:MM format", 400, req, res);
    }

    // Validate discount percentage
    if (discountPercentage < 1 || discountPercentage > 100) {
      return ErrorHandler(
        "Discount percentage must be between 1 and 100",
        400,
        req,
        res
      );
    }

    // Get business
    const business = await Business.findOne({ owner: req.user.id });
    if (!business) {
      return ErrorHandler("Business not found", 404, req, res);
    }

    const validServiceIds = (
      await Service.find({ business: business._id }).select("_id")
    ).map((service) => service._id.toString());
    const invalidServices = services.filter(
      (serviceId) => !validServiceIds.includes(serviceId)
    );

    if (invalidServices.length > 0) {
      return ErrorHandler(
        "One or more services not found or don't belong to this business",
        404,
        req,
        res
      );
    }

    // Check for time conflicts with existing promotions on the same day
    const existingPromotions = await Promotion.find({
      business: business._id,
      dayOfWeek,
      isActive: true,
    });

    const conflictingPromotions = [];
    for (const promotion of existingPromotions) {
      const hasConflict =
        (startTime >= promotion.startTime && startTime < promotion.endTime) ||
        (endTime > promotion.startTime && endTime <= promotion.endTime) ||
        (startTime <= promotion.startTime && endTime >= promotion.endTime);

      if (hasConflict) {
        conflictingPromotions.push(promotion);
      }
    }

    // If there are conflicting promotions and user hasn't confirmed, return warning
    if (conflictingPromotions.length > 0 && !req.body.confirmMultiple) {
      const activePromotionNames = conflictingPromotions
        .map((promo) => promo.name)
        .join(", ");
      return ErrorHandler(
        {
          message: `You already have ${activePromotionNames} active. Are you sure you want to activate ${
            name || "Happy Hours"
          } as well?`,
          code: "MULTIPLE_DISCOUNTS_WARNING",
          existingPromotions: conflictingPromotions.map((promo) => ({
            id: promo._id,
            name: promo.name,
            dayOfWeek: promo.dayOfWeek,
            startTime: promo.startTime,
            endTime: promo.endTime,
            discountPercentage: promo.discountPercentage,
          })),
        },
        409,
        req,
        res
      );
    }

    // Create promotion (exclude confirmMultiple from data)
    const { confirmMultiple, ...promotionData } = req.body;
    const promotionDataToSave = {
      business: business._id,
      name: name || "Happy Hours",
      description,
      dayOfWeek,
      startTime,
      endTime,
      discountPercentage,
      services,
    };

    const promotion = await Promotion.create(promotionDataToSave);

    return SuccessHandler(promotion, 201, res);
  } catch (error) {
    console.error("Create promotion error:", error.message);
    return ErrorHandler(error.message, 500, req, res);
  }
};

/**
 * @desc Get all promotions for a business
 * @route GET /api/promotions
 * @access Private (Business Owner)
 */
const getPromotions = async (req, res) => {
  // #swagger.tags = ['Promotions']
  /* #swagger.description = 'Get all promotions for the business with filtering and pagination'
     #swagger.security = [{ "Bearer": [] }]
     #swagger.parameters['dayOfWeek'] = { in: 'query', description: 'Filter by day of week', type: 'string' }
     #swagger.parameters['isActive'] = { in: 'query', description: 'Filter by active status', type: 'boolean' }
     #swagger.parameters['page'] = { in: 'query', description: 'Page number for pagination', type: 'integer' }
     #swagger.parameters['limit'] = { in: 'query', description: 'Number of items per page', type: 'integer' }
     #swagger.responses[200] = {
        description: 'Promotions retrieved successfully',
        schema: {
          promotions: [{ $ref: '#/definitions/Promotion' }],
          pagination: {
            total: 10,
            page: 1,
            pages: 1
          }
        }
     }
  */
  try {
    const { dayOfWeek, isActive, page = 1, limit = 10 } = req.query;

    // Get business
    const business = await Business.findOne({ owner: req.user.id });
    if (!business) {
      return ErrorHandler("Business not found", 404, req, res);
    }

    // Build query
    let query = { business: business._id };

    if (dayOfWeek) {
      query.dayOfWeek = dayOfWeek;
    }

    if (isActive !== undefined) {
      query.isActive = isActive === "true";
    }

    // Pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Get promotions
    const promotions = await Promotion.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    // Get total count
    const total = await Promotion.countDocuments(query);

    return SuccessHandler(
      {
        promotions,
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
    console.error("Get promotions error:", error.message);
    return ErrorHandler(error.message, 500, req, res);
  }
};

/**
 * @desc Get a specific promotion by ID
 * @route GET /api/promotions/:id
 * @access Private (Business Owner)
 */
const getPromotionById = async (req, res) => {
  // #swagger.tags = ['Promotions']
  /* #swagger.description = 'Get a specific promotion by ID'
     #swagger.security = [{ "Bearer": [] }]
     #swagger.parameters['id'] = { in: 'path', description: 'Promotion ID', required: true, type: 'string' }
     #swagger.responses[200] = {
        description: 'Promotion retrieved successfully',
        schema: { $ref: '#/definitions/Promotion' }
     }
     #swagger.responses[404] = {
        description: 'Promotion not found'
     }
  */
  try {
    const { id } = req.params;

    // Get business
    const business = await Business.findOne({ owner: req.user.id });
    if (!business) {
      return ErrorHandler("Business not found", 404, req, res);
    }

    // Get promotion
    const promotion = await Promotion.findOne({
      _id: id,
      business: business._id,
    });

    if (!promotion) {
      return ErrorHandler("Promotion not found", 404, req, res);
    }

    return SuccessHandler(promotion, 200, res);
  } catch (error) {
    console.error("Get promotion by ID error:", error.message);
    return ErrorHandler(error.message, 500, req, res);
  }
};

/**
 * @desc Update a promotion
 * @route PUT /api/promotions/:id
 * @access Private (Business Owner)
 */
const updatePromotion = async (req, res) => {
  // #swagger.tags = ['Promotions']
  /* #swagger.description = 'Update a promotion'
     #swagger.security = [{ "Bearer": [] }]
     #swagger.parameters['id'] = { in: 'path', description: 'Promotion ID', required: true, type: 'string' }
     #swagger.parameters['obj'] = {
        in: 'body',
        description: 'Promotion details to update',
        required: true,
        schema: {
          name: 'Updated Happy Hours',
          description: 'Updated description',
          startTime: '15:00',
          endTime: '19:00',
          discountPercentage: 25,
          services: ['service_id_1'],
          isActive: true,
          confirmMultiple: false
        }
     }
     #swagger.responses[409] = {
        description: 'Multiple discounts warning - requires confirmation',
        schema: {
          message: 'You already have Happy Hours active. Are you sure you want to activate this promotion as well?',
          code: 'MULTIPLE_DISCOUNTS_WARNING',
          existingPromotions: []
        }
     }
     #swagger.responses[200] = {
        description: 'Promotion updated successfully',
        schema: { $ref: '#/definitions/Promotion' }
     }
     #swagger.responses[400] = {
        description: 'Validation error or time conflict'
     }
     #swagger.responses[404] = {
        description: 'Promotion not found'
     }
  */
  try {
    const { id } = req.params;
    const updateData = req.body;

    // Get business
    const business = await Business.findOne({ owner: req.user.id });
    if (!business) {
      return ErrorHandler("Business not found", 404, req, res);
    }

    // Get existing promotion
    const existingPromotion = await Promotion.findOne({
      _id: id,
      business: business._id,
    });

    if (!existingPromotion) {
      return ErrorHandler("Promotion not found", 404, req, res);
    }

    // Validate services if provided (using embedded services)
    if (updateData.services !== undefined) {
      if (!Array.isArray(updateData.services) || updateData.services.length === 0) {
        return ErrorHandler(
          "At least one service is required",
          400,
          req,
          res
        );
      }
      
      const validServiceIds = (
        await Service.find({ business: business._id }).select("_id")
      ).map((service) => service._id.toString());
      const invalidServices = updateData.services.filter(
        (serviceId) => !validServiceIds.includes(serviceId)
      );

      if (invalidServices.length > 0) {
        return ErrorHandler(
          "One or more services not found or don't belong to this business",
          404,
          req,
          res
        );
      }
    }

    // Check for time conflicts if time is being updated
    if (updateData.startTime || updateData.endTime) {
      const startTime = updateData.startTime || existingPromotion.startTime;
      const endTime = updateData.endTime || existingPromotion.endTime;

      const existingPromotions = await Promotion.find({
        business: business._id,
        dayOfWeek: updateData.dayOfWeek || existingPromotion.dayOfWeek,
        isActive: true,
        _id: { $ne: id }, // Exclude current promotion
      });

      const conflictingPromotions = [];
      for (const promotion of existingPromotions) {
        const hasConflict =
          (startTime >= promotion.startTime && startTime < promotion.endTime) ||
          (endTime > promotion.startTime && endTime <= promotion.endTime) ||
          (startTime <= promotion.startTime && endTime >= promotion.endTime);

        if (hasConflict) {
          conflictingPromotions.push(promotion);
        }
      }

      // If there are conflicting promotions and user hasn't confirmed, return warning
      if (conflictingPromotions.length > 0 && !updateData.confirmMultiple) {
        const activePromotionNames = conflictingPromotions
          .map((promo) => promo.name)
          .join(", ");
        return ErrorHandler(
          {
            message: `You already have ${activePromotionNames} active. Are you sure you want to activate this promotion as well?`,
            code: "MULTIPLE_DISCOUNTS_WARNING",
            existingPromotions: conflictingPromotions.map((promo) => ({
              id: promo._id,
              name: promo.name,
              dayOfWeek: promo.dayOfWeek,
              startTime: promo.startTime,
              endTime: promo.endTime,
              discountPercentage: promo.discountPercentage,
            })),
          },
          409,
          req,
          res
        );
      }
    }

    // Update promotion (exclude confirmMultiple from update data)
    const { confirmMultiple, ...updateDataToSave } = updateData;
    const updatedPromotion = await Promotion.findByIdAndUpdate(
      id,
      updateDataToSave,
      {
        new: true,
        runValidators: true,
      }
    );

    return SuccessHandler(updatedPromotion, 200, res);
  } catch (error) {
    console.error("Update promotion error:", error.message);
    return ErrorHandler(error.message, 500, req, res);
  }
};

/**
 * @desc Delete a promotion
 * @route DELETE /api/promotions/:id
 * @access Private (Business Owner)
 */
const deletePromotion = async (req, res) => {
  // #swagger.tags = ['Promotions']
  /* #swagger.description = 'Delete a promotion'
     #swagger.security = [{ "Bearer": [] }]
     #swagger.parameters['id'] = { in: 'path', description: 'Promotion ID', required: true, type: 'string' }
     #swagger.responses[200] = {
        description: 'Promotion deleted successfully'
     }
     #swagger.responses[404] = {
        description: 'Promotion not found'
     }
  */
  try {
    const { id } = req.params;

    // Get business
    const business = await Business.findOne({ owner: req.user.id });
    if (!business) {
      return ErrorHandler("Business not found", 404, req, res);
    }

    // Delete promotion
    const promotion = await Promotion.findOneAndDelete({
      _id: id,
      business: business._id,
    });

    if (!promotion) {
      return ErrorHandler("Promotion not found", 404, req, res);
    }

    return SuccessHandler(
      { message: "Promotion deleted successfully" },
      200,
      res
    );
  } catch (error) {
    console.error("Delete promotion error:", error.message);
    return ErrorHandler(error.message, 500, req, res);
  }
};

/**
 * @desc Toggle promotion active status
 * @route PATCH /api/promotions/:id/toggle
 * @access Private (Business Owner)
 */
const togglePromotionStatus = async (req, res) => {
  // #swagger.tags = ['Promotions']
  /* #swagger.description = 'Toggle promotion active status'
     #swagger.security = [{ "Bearer": [] }]
     #swagger.parameters['id'] = { in: 'path', description: 'Promotion ID', required: true, type: 'string' }
     #swagger.responses[200] = {
        description: 'Promotion status toggled successfully',
        schema: { $ref: '#/definitions/Promotion' }
     }
     #swagger.responses[404] = {
        description: 'Promotion not found'
     }
  */
  try {
    const { id } = req.params;

    // Get business
    const business = await Business.findOne({ owner: req.user.id });
    if (!business) {
      return ErrorHandler("Business not found", 404, req, res);
    }

    // Get promotion
    const promotion = await Promotion.findOne({
      _id: id,
      business: business._id,
    });

    if (!promotion) {
      return ErrorHandler("Promotion not found", 404, req, res);
    }

    // If activating, check for overlapping flash sales
    if (!promotion.isActive) {
      const activeFlashSales = await FlashSale.find({
        business: business._id,
        isActive: true,
      });

      const dayMap = {
        sunday: 0,
        monday: 1,
        tuesday: 2,
        wednesday: 3,
        thursday: 4,
        friday: 5,
        saturday: 6,
      };

      const targetDayNumber = dayMap[promotion.dayOfWeek.toLowerCase()];
      const overlappingFlashSales = [];

      for (const flashSale of activeFlashSales) {
        const startDate = new Date(flashSale.startDate);
        const endDate = new Date(flashSale.endDate);

        let currentDate = new Date(startDate);
        const startDayOfWeek = currentDate.getDay();
        
        let daysToAdd = (targetDayNumber - startDayOfWeek + 7) % 7;
        
        if (daysToAdd === 0 && startDayOfWeek === targetDayNumber) {
          if (currentDate <= endDate) {
            overlappingFlashSales.push(flashSale);
            continue;
          }
        }
        
        currentDate.setDate(currentDate.getDate() + daysToAdd);
        
        if (currentDate <= endDate) {
          overlappingFlashSales.push(flashSale);
        }
      }

      // If there are overlapping flash sales and user hasn't confirmed, return warning
      if (overlappingFlashSales.length > 0 && req.body.applyBothDiscounts === undefined) {
        const flashSaleNames = overlappingFlashSales
          .map((sale) => sale.name)
          .join(", ");
        return ErrorHandler(
          {
            message: `You have an ongoing flash sale "${flashSaleNames}". Do you want to activate both happy hour and flash sale during this happy hour time?`,
            code: "FLASH_SALE_OVERLAP_WARNING",
            existingFlashSales: overlappingFlashSales.map((sale) => ({
              id: sale._id,
              name: sale.name,
              startDate: sale.startDate,
              endDate: sale.endDate,
              discountPercentage: sale.discountPercentage,
            })),
          },
          409,
          req,
          res
        );
      }

      // If applyBothDiscounts is provided, update the promotion
      if (req.body.applyBothDiscounts !== undefined) {
        promotion.applyBothDiscounts = req.body.applyBothDiscounts === true;
      }
    }

    // Toggle status
    promotion.isActive = !promotion.isActive;
    await promotion.save();

    const updatedPromotion = await Promotion.findById(id).populate(
      "services",
      "name price duration"
    );

    return SuccessHandler(updatedPromotion, 200, res);
  } catch (error) {
    console.error("Toggle promotion status error:", error.message);
    return ErrorHandler(error.message, 500, req, res);
  }
};

/**
 * @desc Get active promotions for a specific day and time
 * @route GET /api/promotions/active
 * @access Public
 */
const getActivePromotions = async (req, res) => {
  // #swagger.tags = ['Promotions']
  /* #swagger.description = 'Get active promotions for a business on a specific day and time'
     #swagger.parameters['businessId'] = { in: 'query', description: 'Business ID', required: true, type: 'string' }
     #swagger.parameters['dayOfWeek'] = { in: 'query', description: 'Day of week', required: true, type: 'string' }
     #swagger.parameters['timeSlot'] = { in: 'query', description: 'Time slot (HH:MM)', type: 'string' }
     #swagger.responses[200] = {
        description: 'Active promotions retrieved successfully',
        schema: {
          promotions: [{ $ref: '#/definitions/Promotion' }]
        }
     }
  */
  try {
    const { businessId, dayOfWeek, timeSlot } = req.query;

    if (!businessId || !dayOfWeek) {
      return ErrorHandler(
        "Business ID and day of week are required",
        400,
        req,
        res
      );
    }

    // Validate day of week
    const validDays = [
      "monday",
      "tuesday",
      "wednesday",
      "thursday",
      "friday",
      "saturday",
      "sunday",
    ];
    if (!validDays.includes(dayOfWeek)) {
      return ErrorHandler("Invalid day of week", 400, req, res);
    }

    // Get active promotions - return services as IDs (not populated) to match /promotions endpoint
    const promotions = await Promotion.find({
      business: businessId,
      dayOfWeek: dayOfWeek,
      isActive: true,
    });

    // Filter by time slot if provided
    let filteredPromotions = promotions;
    if (timeSlot) {
      filteredPromotions = promotions.filter((promotion) =>
        promotion.isTimeSlotInPromotion(timeSlot)
      );
    }

    return SuccessHandler({ promotions: filteredPromotions }, 200, res);
  } catch (error) {
    console.error("Get active promotions error:", error.message);
    return ErrorHandler(error.message, 500, req, res);
  }
};

/**
 * @desc Get promotion statistics
 * @route GET /api/promotions/stats
 * @access Private (Business Owner)
 */
const getPromotionStats = async (req, res) => {
  // #swagger.tags = ['Promotions']
  /* #swagger.description = 'Get promotion statistics for the business'
     #swagger.security = [{ "Bearer": [] }]
     #swagger.responses[200] = {
        description: 'Promotion statistics retrieved successfully',
        schema: {
          totalPromotions: 5,
          activePromotions: 3,
          totalBookings: 25,
          totalRevenue: 1500,
          averageDiscount: 15.5
        }
     }
  */
  try {
    // Get business
    const business = await Business.findOne({ owner: req.user.id });
    if (!business) {
      return ErrorHandler("Business not found", 404, req, res);
    }

    // Get promotion statistics
    const totalPromotions = await Promotion.countDocuments({
      business: business._id,
    });
    const activePromotions = await Promotion.countDocuments({
      business: business._id,
      isActive: true,
    });

    // Get appointments with promotions (you might need to add a promotion field to appointments)
    const promotionAppointments = await Appointment.find({
      business: business._id,
      // Add logic to identify appointments with promotions
    });

    const totalBookings = promotionAppointments.length;
    const totalRevenue = promotionAppointments.reduce(
      (sum, appt) => sum + appt.price,
      0
    );

    // Calculate average discount
    const promotions = await Promotion.find({ business: business._id });
    const averageDiscount =
      promotions.length > 0
        ? promotions.reduce((sum, promo) => sum + promo.discountPercentage, 0) /
          promotions.length
        : 0;

    return SuccessHandler(
      {
        totalPromotions,
        activePromotions,
        totalBookings,
        totalRevenue,
        averageDiscount: Math.round(averageDiscount * 10) / 10,
      },
      200,
      res
    );
  } catch (error) {
    console.error("Get promotion stats error:", error.message);
    return ErrorHandler(error.message, 500, req, res);
  }
};

module.exports = {
  createPromotion,
  getPromotions,
  getPromotionById,
  updatePromotion,
  deletePromotion,
  togglePromotionStatus,
  getActivePromotions,
  getPromotionStats,
};
