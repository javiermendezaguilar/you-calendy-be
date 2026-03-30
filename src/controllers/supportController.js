const Support = require("../models/support");
const SuccessHandler = require("../utils/SuccessHandler");
const ErrorHandler = require("../utils/ErrorHandler");

/**
 * @desc Create a new support ticket
 * @route POST /api/support
 * @access Private (Barber/Staff)
 */
const createSupport = async (req, res) => {
  // #swagger.tags = ['Support']
  /* #swagger.description = 'Create a new support ticket.'
     #swagger.security = [{ "Bearer": [] }]
     #swagger.parameters['obj'] = {
        in: 'body',
        description: 'Support ticket details.',
        required: true,
        schema: {
          title: 'Support Ticket Title',
          issue: 'Brief issue description',
          issueDescription: 'Detailed description of the issue'
        }
     }
  */
  try {
    const { title, issueDescription } = req.body;
    // const barber = req.staff ? req.staff._id : req.user._id;
    const barber = req.user._id;

    if (!title || !issueDescription) {
      return ErrorHandler(
        "Title and issue description are required.",
        400,
        req,
        res
      );
    }

    const support = await Support.create({
      barber,
      title,
      issueDescription,
    });

    const populatedSupport = await Support.findById(support._id).populate(
      "barber",
      "firstName lastName email"
    );

    return SuccessHandler(populatedSupport, 201, res);
  } catch (error) {
    return ErrorHandler(error.message, 500, req, res);
  }
};

/**
 * @desc Get all support tickets (with filtering options)
 * @route GET /api/support
 * @access Private (Barber/Staff, Admin)
 */
const getAllSupport = async (req, res) => {
  // #swagger.tags = ['Support']
  /* #swagger.description = 'Get all support tickets with optional filtering.'
     #swagger.security = [{ "Bearer": [] }]
     #swagger.parameters['status'] = { in: 'query', description: 'Filter by status (pending, resolved, completed)', required: false, type: 'string' }
     #swagger.parameters['page'] = { in: 'query', description: 'Page number for pagination', required: false, type: 'integer' }
     #swagger.parameters['limit'] = { in: 'query', description: 'Number of items per page', required: false, type: 'integer' }
  */
  try {
    const { priority, status, page = 1, limit = 10 } = req.query;
    const query = {};

    // Apply filters
    if (priority) {
      query.priority = priority;
    }
    if (status) {
      query.status = status;
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const supportTickets = await Support.find(query)
      .populate("barber", "name email")
      .populate("resolvedBy", "name email")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Support.countDocuments(query);

    return SuccessHandler(
      {
        supportTickets,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(total / parseInt(limit)),
          totalItems: total,
          itemsPerPage: parseInt(limit),
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
 * @desc Get support tickets for the current barber
 * @route GET /api/support/my-tickets
 * @access Private (Barber/Staff)
 */
const getMySupportTickets = async (req, res) => {
  // #swagger.tags = ['Support']
  /* #swagger.description = 'Get support tickets created by the current barber.'
     #swagger.security = [{ "Bearer": [] }]
     #swagger.parameters['priority'] = { in: 'query', description: 'Filter by priority (Low, Medium, High, Critical)', required: false, type: 'string' }
     #swagger.parameters['status'] = { in: 'query', description: 'Filter by status (pending, resolved, completed)', required: false, type: 'string' }
     #swagger.parameters['page'] = { in: 'query', description: 'Page number for pagination', required: false, type: 'integer' }
     #swagger.parameters['limit'] = { in: 'query', description: 'Number of items per page', required: false, type: 'integer' }
  */
  try {
    const { priority, status, page = 1, limit = 10 } = req.query;
    const barber = req.staff ? req.staff._id : req.user._id;
    const query = { barber };

    // Apply filters
    if (priority) {
      query.priority = priority;
    }
    if (status) {
      query.status = status;
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const supportTickets = await Support.find(query)
      .populate("barber", "firstName lastName email")
      .populate("resolvedBy", "firstName lastName email")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit));

    const total = await Support.countDocuments(query);

    return SuccessHandler(
      {
        supportTickets,
        pagination: {
          currentPage: parseInt(page),
          totalPages: Math.ceil(total / parseInt(limit)),
          totalItems: total,
          itemsPerPage: parseInt(limit),
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
 * @desc Get a single support ticket by ID
 * @route GET /api/support/:id
 * @access Private (Barber/Staff, Admin)
 */
const getSupportById = async (req, res) => {
  // #swagger.tags = ['Support']
  /* #swagger.description = 'Get a single support ticket by its ID.'
     #swagger.security = [{ "Bearer": [] }]
     #swagger.parameters['id'] = { in: 'path', description: 'Support ticket ID', required: true, type: 'string' }
  */
  try {
    const { id } = req.params;
    const support = await Support.findById(id)
      .populate("barber", "firstName lastName email")
      .populate("resolvedBy", "firstName lastName email");

    if (!support) {
      return ErrorHandler("Support ticket not found.", 404, req, res);
    }

    return SuccessHandler(support, 200, res);
  } catch (error) {
    return ErrorHandler(error.message, 500, req, res);
  }
};

/**
 * @desc Update a support ticket (barber can only update title, issue, issueDescription)
 * @route PUT /api/support/:id
 * @access Private (Barber/Staff)
 */
const updateSupport = async (req, res) => {
  // #swagger.tags = ['Support']
  /* #swagger.description = 'Update a support ticket (barber can only update title, issue, issueDescription).'
     #swagger.security = [{ "Bearer": [] }]
     #swagger.parameters['id'] = { in: 'path', description: 'Support ticket ID', required: true, type: 'string' }
     #swagger.parameters['obj'] = {
        in: 'body',
        description: 'Fields to update.',
        required: true,
        schema: {
          title: 'Updated Support Ticket Title',
          issueDescription: 'Updated detailed description'
        }
     }
  */
  try {
    const { id } = req.params;
    const { title, issueDescription } = req.body;
    const barber = req.staff ? req.staff._id : req.user._id;

    const support = await Support.findById(id);
    if (!support) {
      return ErrorHandler("Support ticket not found.", 404, req, res);
    }

    // Check if the barber owns this ticket or is admin
    if (
      support.barber.toString() !== barber.toString() &&
      req.user?.role !== "admin"
    ) {
      return ErrorHandler(
        "Not authorized to update this support ticket.",
        403,
        req,
        res
      );
    }

    // Only allow updating title, issue, and issueDescription for non-admin users
    if (title) support.title = title;
    if (issueDescription) support.issueDescription = issueDescription;

    await support.save();

    const updatedSupport = await Support.findById(id)
      .populate("barber", "firstName lastName email")
      .populate("resolvedBy", "firstName lastName email");

    return SuccessHandler(updatedSupport, 200, res);
  } catch (error) {
    return ErrorHandler(error.message, 500, req, res);
  }
};

/**
 * @desc Delete a support ticket
 * @route DELETE /api/support/:id
 * @access Private (Barber/Staff)
 */
const deleteSupport = async (req, res) => {
  // #swagger.tags = ['Support']
  /* #swagger.description = 'Delete a support ticket.'
     #swagger.security = [{ "Bearer": [] }]
     #swagger.parameters['id'] = { in: 'path', description: 'Support ticket ID', required: true, type: 'string' }
  */
  try {
    const { id } = req.params;
    const barber = req.staff ? req.staff._id : req.user._id;

    const support = await Support.findById(id);
    if (!support) {
      return ErrorHandler("Support ticket not found.", 404, req, res);
    }

    // Check if the barber owns this ticket or is admin
    if (
      support.barber.toString() !== barber.toString() &&
      req.user?.role !== "admin"
    ) {
      return ErrorHandler(
        "Not authorized to delete this support ticket.",
        403,
        req,
        res
      );
    }

    await Support.findByIdAndDelete(id);
    return SuccessHandler({ message: "Support ticket deleted." }, 200, res);
  } catch (error) {
    return ErrorHandler(error.message, 500, req, res);
  }
};

/**
 * @desc Update support ticket priority (Admin only)
 * @route PUT /api/support/:id/priority
 * @access Private (Admin only)
 */
const updateSupportPriority = async (req, res) => {
  // #swagger.tags = ['Support']
  /* #swagger.description = 'Update support ticket priority (Admin only).'
     #swagger.security = [{ "Bearer": [] }]
     #swagger.parameters['id'] = { in: 'path', description: 'Support ticket ID', required: true, type: 'string' }
     #swagger.parameters['obj'] = {
        in: 'body',
        description: 'Priority to set.',
        required: true,
        schema: {
          priority: 'High'
        }
     }
  */
  try {
    const { id } = req.params;
    const { priority } = req.body;

    if (
      !priority ||
      !["Low", "Medium", "High", "Critical"].includes(priority)
    ) {
      return ErrorHandler(
        "Priority must be one of: Low, Medium, High, Critical",
        400,
        req,
        res
      );
    }

    const support = await Support.findById(id);
    if (!support) {
      return ErrorHandler("Support ticket not found.", 404, req, res);
    }

    support.priority = priority;
    await support.save();

    const updatedSupport = await Support.findById(id)
      .populate("barber", "firstName lastName email")
      .populate("resolvedBy", "firstName lastName email");

    return SuccessHandler(updatedSupport, 200, res);
  } catch (error) {
    return ErrorHandler(error.message, 500, req, res);
  }
};

/**
 * @desc Update support ticket status (Admin only)
 * @route PUT /api/support/:id/status
 * @access Private (Admin only)
 */
const updateSupportStatus = async (req, res) => {
  // #swagger.tags = ['Support']
  /* #swagger.description = 'Update support ticket status (Admin only).'
     #swagger.security = [{ "Bearer": [] }]
     #swagger.parameters['id'] = { in: 'path', description: 'Support ticket ID', required: true, type: 'string' }
     #swagger.parameters['obj'] = {
        in: 'body',
        description: 'Status.',
        required: true,
        schema: {
          status: 'resolved',
        }
     }
  */
  try {
    const { id } = req.params;
    const { status } = req.body;
    const admin = req.user._id;

    if (!status || !["pending", "resolved", "completed"].includes(status)) {
      return ErrorHandler(
        "Status must be one of: pending, resolved, completed",
        400,
        req,
        res
      );
    }

    const support = await Support.findById(id);
    if (!support) {
      return ErrorHandler("Support ticket not found.", 404, req, res);
    }

    support.status = status;

    // Update resolvedAt and resolvedBy when status changes from pending
    if (status !== "pending") {
      support.resolvedAt = new Date();
      support.resolvedBy = admin;
    } else {
      // If status is set back to pending, clear resolution fields
      support.resolvedAt = null;
      support.resolvedBy = null;
    }

    await support.save();

    const updatedSupport = await Support.findById(id)
      .populate("barber", "firstName lastName email")
      .populate("resolvedBy", "firstName lastName email");

    return SuccessHandler(updatedSupport, 200, res);
  } catch (error) {
    return ErrorHandler(error.message, 500, req, res);
  }
};

/**
 * @desc Get support statistics for admin dashboard
 * @route GET /api/support/stats
 * @access Private (Admin only)
 */
const getSupportStats = async (req, res) => {
  // #swagger.tags = ['Support']
  /* #swagger.description = 'Get support ticket statistics for admin dashboard.'
     #swagger.security = [{ "Bearer": [] }]
  */
  try {
    const totalTickets = await Support.countDocuments();
    const pendingTickets = await Support.countDocuments({ status: "pending" });
    const resolvedTickets = await Support.countDocuments({
      status: "resolved",
    });
    const completedTickets = await Support.countDocuments({
      status: "completed",
    });

    const priorityStats = await Support.aggregate([
      {
        $group: {
          _id: "$priority",
          count: { $sum: 1 },
        },
      },
    ]);

    const priorityBreakdown = {};
    priorityStats.forEach((stat) => {
      priorityBreakdown[stat._id] = stat.count;
    });

    // Ensure all priorities are represented
    ["Low", "Medium", "High", "Critical"].forEach((priority) => {
      if (!priorityBreakdown[priority]) {
        priorityBreakdown[priority] = 0;
      }
    });

    const statusBreakdown = {
      pending: pendingTickets,
      resolved: resolvedTickets,
      completed: completedTickets,
    };

    const recentTickets = await Support.find()
      .populate("barber", "firstName lastName email")
      .sort({ createdAt: -1 })
      .limit(5);

    return SuccessHandler(
      {
        totalTickets,
        pendingTickets,
        resolvedTickets,
        completedTickets,
        resolutionRate:
          totalTickets > 0
            ? ((resolvedTickets + completedTickets) / totalTickets) * 100
            : 0,
        priorityBreakdown,
        statusBreakdown,
        recentTickets,
      },
      200,
      res
    );
  } catch (error) {
    return ErrorHandler(error.message, 500, req, res);
  }
};

module.exports = {
  createSupport,
  getAllSupport,
  getMySupportTickets,
  getSupportById,
  updateSupport,
  deleteSupport,
  updateSupportPriority,
  updateSupportStatus,
  getSupportStats,
};
