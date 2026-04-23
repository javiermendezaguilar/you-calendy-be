const FlashSale = require("../models/flashSale");
const Promotion = require("../models/promotion");
const Business = require("../models/User/business");
const Appointment = require("../models/appointment");
const SuccessHandler = require("../utils/SuccessHandler");
const ErrorHandler = require("../utils/ErrorHandler");
const moment = require("moment");
const {
  getCanonicalRevenueTotalByAppointmentIds,
} = require("../services/payment/revenueProjection");

/**
 * Helper function to check if a flash sale date range overlaps with active promotions
 * @param {Date} flashSaleStartDate - Start date of the flash sale
 * @param {Date} flashSaleEndDate - End date of the flash sale
 * @param {String} businessId - Business ID
 * @returns {Array} Array of overlapping promotions
 */
const findOverlappingPromotions = async (flashSaleStartDate, flashSaleEndDate, businessId) => {
  const activePromotions = await Promotion.find({
    business: businessId,
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

  const overlappingPromotions = [];

  for (const promotion of activePromotions) {
    const targetDayNumber = dayMap[promotion.dayOfWeek.toLowerCase()];
    
    // Check each day in the flash sale date range
    let currentDate = new Date(flashSaleStartDate);
    const endDate = new Date(flashSaleEndDate);
    
    while (currentDate <= endDate) {
      const currentDayOfWeek = currentDate.getDay();
      
      // If this day matches the promotion's day of week, check if it's within the flash sale range
      if (currentDayOfWeek === targetDayNumber) {
        overlappingPromotions.push(promotion);
        break; // Found overlap, no need to check further days for this promotion
      }
      
      // Move to next day
      currentDate.setDate(currentDate.getDate() + 1);
    }
  }

  return overlappingPromotions;
};

/**
 * @desc Create a new flash sale
 * @route POST /api/flash-sales
 * @access Private (Business Owner)
 */
const createFlashSale = async (req, res) => {
  // #swagger.tags = ['Flash Sales']
  /* #swagger.description = 'Create a new flash sale for the business'
     #swagger.security = [{ "Bearer": [] }]
     #swagger.parameters['obj'] = {
        in: 'body',
        description: 'Flash sale details',
        required: true,
        schema: {
          name: 'Summer Flash Sale',
          description: '30% off all services for 24 hours',
          startDate: '2024-06-15T10:00:00.000Z',
          endDate: '2024-06-16T10:00:00.000Z',
          discountPercentage: 30,
        }
     }
     #swagger.responses[201] = {
        description: 'Flash sale created successfully',
        schema: { $ref: '#/definitions/FlashSale' }
     }
     #swagger.responses[400] = {
        description: 'Validation error or time conflict'
     }
     #swagger.responses[404] = {
        description: 'Business not found'
     }
  */
  try {
    const { name, description, startDate, endDate, discountPercentage } =
      req.body;

    // Validate required fields
    if (!startDate || !endDate || !discountPercentage) {
      return ErrorHandler(
        "Start date, end date, and discount percentage are required",
        400,
        req,
        res
      );
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

    // Validate dates
    const start = new Date(startDate);
    const end = new Date(endDate);
    const now = new Date();

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      return ErrorHandler("Invalid date format", 400, req, res);
    }

    if (end <= start) {
      return ErrorHandler("End date must be after start date", 400, req, res);
    }

    // Get business
    const business = await Business.findOne({ owner: req.user.id });
    if (!business) {
      return ErrorHandler("Business not found", 404, req, res);
    }

    // Check for overlapping flash sales - only one flash sale can be active at a time
    const overlappingFlashSales = await FlashSale.find({
      business: business._id,
      isActive: true,
      $or: [
        {
          startDate: { $lte: end },
          endDate: { $gte: start },
        },
        {
          startDate: { $gte: start, $lt: end },
        },
        {
          endDate: { $gt: start, $lte: end },
        },
      ],
    });

    // Prevent overlapping flash sales - flash sales cannot overlap in time
    if (overlappingFlashSales.length > 0) {
      return ErrorHandler(
        "This flash sale overlaps with an existing active flash sale. Please choose a different date range or deactivate the existing flash sale.",
        400,
        req,
        res
      );
    }

    // Check for overlapping active promotions
    const overlappingPromotions = await findOverlappingPromotions(
      start,
      end,
      business._id
    );

    // If there are overlapping promotions and user hasn't confirmed, return warning
    if (overlappingPromotions.length > 0 && req.body.applyBothDiscounts === undefined) {
      const promotionNames = overlappingPromotions
        .map((promo) => `${promo.name} (${promo.dayOfWeek})`)
        .join(", ");
      return ErrorHandler(
        {
          message: `You have active happy hours "${promotionNames}". Do you want to apply both flash sale and happy hour discounts during overlapping times?`,
          code: "PROMOTION_OVERLAP_WARNING",
          existingPromotions: overlappingPromotions.map((promo) => ({
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

    // Create flash sale
    const flashSaleDataToSave = {
      business: business._id,
      name: name || "Flash Sale",
      description,
      startDate: start,
      endDate: end,
      discountPercentage,
    };

    const flashSale = await FlashSale.create(flashSaleDataToSave);

    // If applyBothDiscounts is provided and there are overlapping promotions, update them
    if (req.body.applyBothDiscounts !== undefined && overlappingPromotions.length > 0) {
      await Promotion.updateMany(
        { _id: { $in: overlappingPromotions.map((p) => p._id) } },
        { $set: { applyBothDiscounts: req.body.applyBothDiscounts === true } }
      );
    }

    return SuccessHandler(flashSale, 201, res);
  } catch (error) {
    console.error("Create flash sale error:", error.message);
    return ErrorHandler(error.message, 500, req, res);
  }
};

/**
 * @desc Get all flash sales for a business
 * @route GET /api/flash-sales
 * @access Private (Business Owner)
 */
const getFlashSales = async (req, res) => {
  // #swagger.tags = ['Flash Sales']
  /* #swagger.description = 'Get all flash sales for the business with filtering and pagination'
     #swagger.security = [{ "Bearer": [] }]
     #swagger.parameters['isActive'] = { in: 'query', description: 'Filter by active status', type: 'boolean' }
     #swagger.parameters['page'] = { in: 'query', description: 'Page number for pagination', type: 'integer' }
     #swagger.parameters['limit'] = { in: 'query', description: 'Number of items per page', type: 'integer' }
     #swagger.responses[200] = {
        description: 'Flash sales retrieved successfully',
        schema: {
          flashSales: [{ $ref: '#/definitions/FlashSale' }],
          pagination: {
            total: 10,
            page: 1,
            pages: 1
          }
        }
     }
  */
  try {
    const { isActive, page = 1, limit = 10 } = req.query;

    // Get business
    const business = await Business.findOne({ owner: req.user.id });
    if (!business) {
      return ErrorHandler("Business not found", 404, req, res);
    }

    // Build query
    let query = { business: business._id };

    if (isActive !== undefined) {
      query.isActive = isActive === "true";
    }

    // Pagination
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Get flash sales
    const flashSales = await FlashSale.find(query)
      .sort({ startDate: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    // Get total count
    const total = await FlashSale.countDocuments(query);

    return SuccessHandler(
      {
        flashSales,
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
    console.error("Get flash sales error:", error.message);
    return ErrorHandler(error.message, 500, req, res);
  }
};

/**
 * @desc Get a specific flash sale by ID
 * @route GET /api/flash-sales/:id
 * @access Private (Business Owner)
 */
const getFlashSaleById = async (req, res) => {
  // #swagger.tags = ['Flash Sales']
  /* #swagger.description = 'Get a specific flash sale by ID'
     #swagger.security = [{ "Bearer": [] }]
     #swagger.parameters['id'] = { in: 'path', description: 'Flash Sale ID', required: true, type: 'string' }
     #swagger.responses[200] = {
        description: 'Flash sale retrieved successfully',
        schema: { $ref: '#/definitions/FlashSale' }
     }
     #swagger.responses[404] = {
        description: 'Flash sale not found'
     }
  */
  try {
    const { id } = req.params;

    // Get business
    const business = await Business.findOne({ owner: req.user.id });
    if (!business) {
      return ErrorHandler("Business not found", 404, req, res);
    }

    // Get flash sale
    const flashSale = await FlashSale.findOne({
      _id: id,
      business: business._id,
    });

    if (!flashSale) {
      return ErrorHandler("Flash sale not found", 404, req, res);
    }

    return SuccessHandler(flashSale, 200, res);
  } catch (error) {
    console.error("Get flash sale by ID error:", error.message);
    return ErrorHandler(error.message, 500, req, res);
  }
};

/**
 * @desc Update a flash sale
 * @route PUT /api/flash-sales/:id
 * @access Private (Business Owner)
 */
const updateFlashSale = async (req, res) => {
  // #swagger.tags = ['Flash Sales']
  /* #swagger.description = 'Update a flash sale'
     #swagger.security = [{ "Bearer": [] }]
     #swagger.parameters['id'] = { in: 'path', description: 'Flash Sale ID', required: true, type: 'string' }
     #swagger.parameters['obj'] = {
        in: 'body',
        description: 'Flash sale details to update',
        required: true,
        schema: {
          name: 'Updated Flash Sale',
          description: 'Updated description',
          startDate: '2024-06-15T12:00:00.000Z',
          endDate: '2024-06-16T12:00:00.000Z',
          discountPercentage: 25,
          isActive: true,
        }
     }
     #swagger.responses[200] = {
        description: 'Flash sale updated successfully',
        schema: { $ref: '#/definitions/FlashSale' }
     }
     #swagger.responses[400] = {
        description: 'Validation error or time conflict'
     }
     #swagger.responses[404] = {
        description: 'Flash sale not found'
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

    // Get existing flash sale
    const existingFlashSale = await FlashSale.findOne({
      _id: id,
      business: business._id,
    });

    if (!existingFlashSale) {
      return ErrorHandler("Flash sale not found", 404, req, res);
    }

    // Validate dates if being updated
    if (updateData.startDate || updateData.endDate) {
      const start = updateData.startDate
        ? new Date(updateData.startDate)
        : existingFlashSale.startDate;
      const end = updateData.endDate
        ? new Date(updateData.endDate)
        : existingFlashSale.endDate;

      if (isNaN(start.getTime()) || isNaN(end.getTime())) {
        return ErrorHandler("Invalid date format", 400, req, res);
      }

      if (end <= start) {
        return ErrorHandler("End date must be after start date", 400, req, res);
      }

      // Check for overlapping flash sales (excluding current one) - only one flash sale can be active at a time
      const overlappingFlashSales = await FlashSale.find({
        business: business._id,
        isActive: true,
        _id: { $ne: id },
        $or: [
          {
            startDate: { $lte: end },
            endDate: { $gte: start },
          },
          {
            startDate: { $gte: start, $lt: end },
          },
          {
            endDate: { $gt: start, $lte: end },
          },
        ],
      });

      // Prevent overlapping flash sales - flash sales cannot overlap in time
      if (overlappingFlashSales.length > 0) {
        return ErrorHandler(
          "This flash sale overlaps with an existing active flash sale. Please choose a different date range or deactivate the existing flash sale.",
          400,
          req,
          res
        );
      }

      // Check for overlapping active promotions if dates are being updated
      const overlappingPromotions = await findOverlappingPromotions(
        start,
        end,
        business._id
      );

      // If there are overlapping promotions and user hasn't confirmed, return warning
      // Only check if flash sale is being activated or will be active
      const willBeActive = updateData.isActive !== undefined ? updateData.isActive : existingFlashSale.isActive;
      if (overlappingPromotions.length > 0 && willBeActive && req.body.applyBothDiscounts === undefined) {
        const promotionNames = overlappingPromotions
          .map((promo) => `${promo.name} (${promo.dayOfWeek})`)
          .join(", ");
        return ErrorHandler(
          {
            message: `You have active happy hours "${promotionNames}". Do you want to apply both flash sale and happy hour discounts during overlapping times?`,
            code: "PROMOTION_OVERLAP_WARNING",
            existingPromotions: overlappingPromotions.map((promo) => ({
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

      // If applyBothDiscounts is provided and there are overlapping promotions, update them
      if (req.body.applyBothDiscounts !== undefined && overlappingPromotions.length > 0) {
        await Promotion.updateMany(
          { _id: { $in: overlappingPromotions.map((p) => p._id) } },
          { $set: { applyBothDiscounts: req.body.applyBothDiscounts === true } }
        );
      }
    }

    // Update flash sale
    const updatedFlashSale = await FlashSale.findByIdAndUpdate(
      id,
      updateData,
      {
        new: true,
        runValidators: true,
      }
    );

    return SuccessHandler(updatedFlashSale, 200, res);
  } catch (error) {
    console.error("Update flash sale error:", error.message);
    return ErrorHandler(error.message, 500, req, res);
  }
};

/**
 * @desc Delete a flash sale
 * @route DELETE /api/flash-sales/:id
 * @access Private (Business Owner)
 */
const deleteFlashSale = async (req, res) => {
  // #swagger.tags = ['Flash Sales']
  /* #swagger.description = 'Delete a flash sale'
     #swagger.security = [{ "Bearer": [] }]
     #swagger.parameters['id'] = { in: 'path', description: 'Flash Sale ID', required: true, type: 'string' }
     #swagger.responses[200] = {
        description: 'Flash sale deleted successfully'
     }
     #swagger.responses[404] = {
        description: 'Flash sale not found'
     }
  */
  try {
    const { id } = req.params;

    // Get business
    const business = await Business.findOne({ owner: req.user.id });
    if (!business) {
      return ErrorHandler("Business not found", 404, req, res);
    }

    // Delete flash sale
    const flashSale = await FlashSale.findOneAndDelete({
      _id: id,
      business: business._id,
    });

    if (!flashSale) {
      return ErrorHandler("Flash sale not found", 404, req, res);
    }

    return SuccessHandler(
      { message: "Flash sale deleted successfully" },
      200,
      res
    );
  } catch (error) {
    console.error("Delete flash sale error:", error.message);
    return ErrorHandler(error.message, 500, req, res);
  }
};

/**
 * @desc Toggle flash sale active status
 * @route PATCH /api/flash-sales/:id/toggle
 * @access Private (Business Owner)
 */
const toggleFlashSaleStatus = async (req, res) => {
  // #swagger.tags = ['Flash Sales']
  /* #swagger.description = 'Toggle flash sale active status'
     #swagger.security = [{ "Bearer": [] }]
     #swagger.parameters['id'] = { in: 'path', description: 'Flash Sale ID', required: true, type: 'string' }
     #swagger.responses[200] = {
        description: 'Flash sale status toggled successfully',
        schema: { $ref: '#/definitions/FlashSale' }
     }
     #swagger.responses[404] = {
        description: 'Flash sale not found'
     }
  */
  try {
    const { id } = req.params;

    // Get business
    const business = await Business.findOne({ owner: req.user.id });
    if (!business) {
      return ErrorHandler("Business not found", 404, req, res);
    }

    // Get flash sale
    const flashSale = await FlashSale.findOne({
      _id: id,
      business: business._id,
    });

    if (!flashSale) {
      return ErrorHandler("Flash sale not found", 404, req, res);
    }

    // If activating, check for overlapping flash sales - only one flash sale can be active at a time
    if (!flashSale.isActive) {
      const now = new Date();
      const overlappingFlashSales = await FlashSale.find({
        business: business._id,
        isActive: true,
        _id: { $ne: id },
        $or: [
          {
            startDate: { $lte: flashSale.endDate },
            endDate: { $gte: flashSale.startDate },
          },
          {
            startDate: { $gte: flashSale.startDate, $lt: flashSale.endDate },
          },
          {
            endDate: { $gt: flashSale.startDate, $lte: flashSale.endDate },
          },
        ],
      });

      // Prevent overlapping flash sales - flash sales cannot overlap in time
      if (overlappingFlashSales.length > 0) {
        return ErrorHandler(
          "This flash sale overlaps with an existing active flash sale. Please deactivate the existing flash sale first.",
          400,
          req,
          res
        );
      }

      // Check for overlapping active promotions
      const overlappingPromotions = await findOverlappingPromotions(
        flashSale.startDate,
        flashSale.endDate,
        business._id
      );

      // If there are overlapping promotions and user hasn't confirmed, return warning
      if (overlappingPromotions.length > 0 && req.body.applyBothDiscounts === undefined) {
        const promotionNames = overlappingPromotions
          .map((promo) => `${promo.name} (${promo.dayOfWeek})`)
          .join(", ");
        return ErrorHandler(
          {
            message: `You have active happy hours "${promotionNames}". Do you want to apply both flash sale and happy hour discounts during overlapping times?`,
            code: "PROMOTION_OVERLAP_WARNING",
            existingPromotions: overlappingPromotions.map((promo) => ({
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

      // If applyBothDiscounts is provided and there are overlapping promotions, update them
      if (req.body.applyBothDiscounts !== undefined && overlappingPromotions.length > 0) {
        await Promotion.updateMany(
          { _id: { $in: overlappingPromotions.map((p) => p._id) } },
          { $set: { applyBothDiscounts: req.body.applyBothDiscounts === true } }
        );
      }
    }

    // Toggle status
    flashSale.isActive = !flashSale.isActive;
    await flashSale.save();

    return SuccessHandler(flashSale, 200, res);
  } catch (error) {
    console.error("Toggle flash sale status error:", error.message);
    return ErrorHandler(error.message, 500, req, res);
  }
};

/**
 * @desc Get active flash sales for a business
 * @route GET /api/flash-sales/active
 * @access Public
 */
const getActiveFlashSales = async (req, res) => {
  // #swagger.tags = ['Flash Sales']
  /* #swagger.description = 'Get active flash sales for a business'
     #swagger.parameters['businessId'] = { in: 'query', description: 'Business ID', required: true, type: 'string' }
     #swagger.responses[200] = {
        description: 'Active flash sales retrieved successfully',
        schema: {
          flashSales: [{ $ref: '#/definitions/FlashSale' }]
        }
     }
  */
  try {
    const { businessId } = req.query;

    if (!businessId) {
      return ErrorHandler("Business ID is required", 400, req, res);
    }

    // Get active flash sales
    const flashSales = await FlashSale.findActiveFlashSales(businessId);

    return SuccessHandler({ flashSales }, 200, res);
  } catch (error) {
    console.error("Get active flash sales error:", error.message);
    return ErrorHandler(error.message, 500, req, res);
  }
};

/**
 * @desc Get flash sale statistics
 * @route GET /api/flash-sales/stats
 * @access Private (Business Owner)
 */
const getFlashSaleStats = async (req, res) => {
  // #swagger.tags = ['Flash Sales']
  /* #swagger.description = 'Get flash sale statistics for the business'
     #swagger.security = [{ "Bearer": [] }]
     #swagger.responses[200] = {
        description: 'Flash sale statistics retrieved successfully',
        schema: {
          totalFlashSales: 5,
          activeFlashSales: 2,
          upcomingFlashSales: 1,
          totalBookings: 25,
          totalRevenue: 1500,
          averageDiscount: 25.5
        }
     }
  */
  try {
    // Get business
    const business = await Business.findOne({ owner: req.user.id });
    if (!business) {
      return ErrorHandler("Business not found", 404, req, res);
    }

    const now = new Date();

    // Get flash sale statistics
    const totalFlashSales = await FlashSale.countDocuments({
      business: business._id,
    });

    const activeFlashSales = await FlashSale.countDocuments({
      business: business._id,
      isActive: true,
      startDate: { $lte: now },
      endDate: { $gte: now },
    });

    const upcomingFlashSales = await FlashSale.countDocuments({
      business: business._id,
      isActive: true,
      startDate: { $gt: now },
    });

    // Get appointments with flash sales
    const flashSaleAppointments = await Appointment.find({
      business: business._id,
      "flashSale.applied": true,
    }).select("_id");

    const totalBookings = flashSaleAppointments.length;
    const totalRevenue = await getCanonicalRevenueTotalByAppointmentIds({
      appointmentIds: flashSaleAppointments.map((appointment) => appointment._id),
      paymentMatch: {
        status: { $in: ["captured", "refunded_partial", "refunded_full"] },
      },
    });

    // Calculate average discount
    const flashSales = await FlashSale.find({ business: business._id });
    const averageDiscount =
      flashSales.length > 0
        ? flashSales.reduce((sum, sale) => sum + sale.discountPercentage, 0) /
          flashSales.length
        : 0;

    return SuccessHandler(
      {
        totalFlashSales,
        activeFlashSales,
        upcomingFlashSales,
        totalBookings,
        totalRevenue,
        averageDiscount: Math.round(averageDiscount * 10) / 10,
      },
      200,
      res
    );
  } catch (error) {
    console.error("Get flash sale stats error:", error.message);
    return ErrorHandler(error.message, 500, req, res);
  }
};

module.exports = {
  createFlashSale,
  getFlashSales,
  getFlashSaleById,
  updateFlashSale,
  deleteFlashSale,
  toggleFlashSaleStatus,
  getActiveFlashSales,
  getFlashSaleStats,
};
