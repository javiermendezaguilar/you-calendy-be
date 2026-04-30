const Service = require("../models/service");
const Business = require("../models/User/business");
const SuccessHandler = require("../utils/SuccessHandler");
const ErrorHandler = require("../utils/ErrorHandler");
const { uploadFiles, deleteFile } = require("../utils/aws");
const { uploadToCloudinary, deleteImage } = require("../functions/cloudinary");
const Auditing = require("../models/auditing");
const {
  syncBusinessServicesShadow,
} = require("../services/business/serviceService");

/**
 * @desc Get all services for a business
 * @route GET /api/services
 * @access Private/Public
 */
const getServices = async (req, res) => {
  // #swagger.tags = ['Services']
  /* #swagger.description = 'Get all services for a business'
     #swagger.parameters['businessId'] = {
        in: 'query',
        description: 'Business ID',
        type: 'string'
     }
     #swagger.responses[200] = {
        description: 'List of services',
        schema: { $ref: '#/definitions/ServiceList' }
     }
  */
  try {
    const { businessId, category } = req.query;

    if (!businessId) {
      return ErrorHandler("Business ID is required", 400, req, res);
    }

    // Build query
    let query = { business: businessId, isActive: true };

    // Filter by category if provided
    if (category) {
      query.category = category;
    }

    const services = await Service.find(query).sort({ name: 1 });

    return SuccessHandler(services, 200, res);
  } catch (error) {
    console.error("Get services error:", error.message);
    return ErrorHandler(error.message, 500, req, res);
  }
};

/**
 * @desc Create a new service
 * @route POST /api/services
 * @access Private
 */
const createService = async (req, res) => {
  // #swagger.tags = ['Services']
  /* #swagger.description = 'Create a new service'
     #swagger.security = [{ "Bearer": [] }]
     #swagger.parameters['obj'] = {
        in: 'body',
        description: 'Service information',
        required: true,
        schema: {
          name: 'Haircut',
          description: 'Basic haircut service',
          price: 25,
          category: 'Hair'
        }
     }
     #swagger.responses[201] = {
        description: 'Service created successfully',
        schema: { $ref: '#/definitions/Service' }
     }
  */
  try {
    const { name, description, price, category, currency } = req.body;
    const userId = req.user.id;

    // Validate required fields
    if (!name || !price) {
      return ErrorHandler("Name and price are required", 400, req, res);
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

    // Get user's business
    const business = await Business.findOne({ owner: userId });
    if (!business) {
      return ErrorHandler("Business not found for this user", 404, req, res);
    }

    let imageData = null;

    // Handle image upload if provided
    if (req.files && req.files.image) {
      const result = await uploadToCloudinary(
        req.files.image.data,
        "service-images"
      );
      imageData = {
        url: result.secure_url,
        public_id: result.public_id,
      };
    }

    // Create service
    const newService = await Service.create({
      business: business._id,
      name,
      description,
      price: parseFloat(price),
      currency: currency || "USD",
      category: category || "General",
      image: imageData,
      isActive: true,
    });

    await syncBusinessServicesShadow(business._id);

    return SuccessHandler(newService, 201, res);
  } catch (error) {
    console.error("Create service error:", error.message);
    return ErrorHandler(error.message, 500, req, res);
  }
};

/**
 * @desc Update a service
 * @route PUT /api/services/:id
 * @access Private
 */
const updateService = async (req, res) => {
  // #swagger.tags = ['Services']
  /* #swagger.description = 'Update a service'
     #swagger.security = [{ "Bearer": [] }]
     #swagger.parameters['id'] = {
        in: 'path',
        description: 'Service ID',
        required: true,
        type: 'string'
     }
     #swagger.parameters['obj'] = {
        in: 'body',
        description: 'Updated service information',
        required: true,
        schema: {
          name: 'Updated Haircut',
          description: 'Updated description',
          price: 30,
          category: 'Hair',
          isActive: true
        }
     }
     #swagger.responses[200] = {
        description: 'Service updated successfully',
        schema: { $ref: '#/definitions/Service' }
     }
     #swagger.responses[404] = {
        description: 'Service not found'
     }
  */
  try {
    const { name, description, price, category, currency, isActive } = req.body;
    const serviceId = req.params.id;
    const userId = req.user.id;

    // Find the service
    const service = await Service.findById(serviceId);
    if (!service) {
      return ErrorHandler("Service not found", 404, req, res);
    }

    // Check if user owns the business that owns this service
    const business = await Business.findById(service.business);
    if (!business || business.owner.toString() !== userId) {
      return ErrorHandler(
        "Not authorized to update this service",
        403,
        req,
        res
      );
    }

    // Handle service image if provided
    let imageData = service.image;
    if (req.files && req.files.image) {
      // Delete old image if exists
      if (service.image && service.image.public_id) {
        await deleteImage(service.image.public_id);
      }

      // Upload new image
      const result = await uploadToCloudinary(
        req.files.image.data,
        "service-images"
      );
      imageData = {
        url: result.secure_url,
        public_id: result.public_id,
      };
    }

    // Update service
    const updates = {
      name: name || service.name,
      description: description || service.description,
      price: price !== undefined ? parseFloat(price) : service.price,
      currency: currency || service.currency,
      category: category || service.category,
      image: imageData,
      isActive: isActive !== undefined ? isActive : service.isActive,
    };

    const updatedService = await Service.findByIdAndUpdate(
      serviceId,
      { $set: updates },
      { new: true }
    );

    await syncBusinessServicesShadow(business._id);

    return SuccessHandler(updatedService, 200, res);
  } catch (error) {
    console.error("Update service error:", error.message);
    return ErrorHandler(error.message, 500, req, res);
  }
};

/**
 * @desc Delete a service
 * @route DELETE /api/services/:id
 * @access Private
 */
const deleteService = async (req, res) => {
  // #swagger.tags = ['Services']
  /* #swagger.description = 'Delete a service'
     #swagger.security = [{ "Bearer": [] }]
     #swagger.parameters['reason'] = {
        in: 'body',
        description: 'Reason for deletion',
        required: true,
        type: 'string'
     }
     #swagger.parameters['id'] = {
        in: 'path',
        description: 'Service ID',
        required: true,
        type: 'string'
     }
     #swagger.responses[200] = {
        description: 'Service deleted successfully'
     }
     #swagger.responses[404] = {
        description: 'Service not found'
     }
  */
  try {
    const serviceId = req.params.id;
    const userId = req.user.id;
    const { reason } = req.body; // Get reason from request body

    if (!reason || typeof reason !== "string" || reason.trim().length === 0) {
      return ErrorHandler("Deletion reason is required.", 400, req, res);
    }
    // Find the service
    const service = await Service.findById(serviceId);
    if (!service) {
      return ErrorHandler("Service not found", 404, req, res);
    }

    // Check if user owns the business that owns this service
    const business = await Business.findById(service.business);
    if (!business || business.owner.toString() !== userId) {
      return ErrorHandler(
        "Not authorized to delete this service",
        403,
        req,
        res
      );
    }

    // Delete image if exists
    if (service.image && service.image.public_id) {
      await deleteImage(service.image.public_id);
    }

    // Delete service
    await Service.findByIdAndDelete(serviceId);
    await syncBusinessServicesShadow(business._id);
    await Auditing.create({
      entityType: "Service",
      entityId: serviceId,
      action: "deleted",
      reason: reason.trim(),
      createdBy: req.user.id,
      metadata: {
        serviceName: `${service.name}`,
        businessId: business._id,
        businessName: business.name,
      },
    });
    return SuccessHandler(
      { message: "Service deleted successfully" },
      200,
      res
    );
  } catch (error) {
    console.error("Delete service error:", error.message);
    return ErrorHandler(error.message, 500, req, res);
  }
};

/**
 * @desc Get service by ID
 * @route GET /api/services/:id
 * @access Public
 */
const getServiceById = async (req, res) => {
  // #swagger.tags = ['Services']
  /* #swagger.description = 'Get service details by ID'
     #swagger.parameters['id'] = {
        in: 'path',
        description: 'Service ID',
        required: true,
        type: 'string'
     }
     #swagger.responses[200] = {
        description: 'Service details',
        schema: { $ref: '#/definitions/Service' }
     }
     #swagger.responses[404] = {
        description: 'Service not found'
     }
  */
  try {
    const serviceId = req.params.id;

    const service = await Service.findById(serviceId);
    if (!service) {
      return ErrorHandler("Service not found", 404, req, res);
    }

    return SuccessHandler(service, 200, res);
  } catch (error) {
    console.error("Get service by ID error:", error.message);
    return ErrorHandler(error.message, 500, req, res);
  }
};

/**
 * @desc Get service categories for a business
 * @route GET /api/services/categories
 * @access Public
 */
const getServiceCategories = async (req, res) => {
  // #swagger.tags = ['Services']
  /* #swagger.description = 'Get all service categories for a business'
     #swagger.parameters['businessId'] = {
        in: 'query',
        description: 'Business ID',
        required: true,
        type: 'string'
     }
     #swagger.responses[200] = {
        description: 'List of service categories',
        schema: { categories: ['Hair', 'Nails', 'Spa'] }
     }
  */
  try {
    const { businessId } = req.query;

    if (!businessId) {
      return ErrorHandler("Business ID is required", 400, req, res);
    }

    // Aggregate to get unique categories
    const categories = await Service.find({
      business: businessId,
      isActive: true,
    }).distinct("category");

    return SuccessHandler({ categories }, 200, res);
  } catch (error) {
    console.error("Get service categories error:", error.message);
    return ErrorHandler(error.message, 500, req, res);
  }
};

module.exports = {
  getServices,
  createService,
  updateService,
  deleteService,
  getServiceById,
  getServiceCategories,
};
