const Notification = require("../models/User/notification");
const SuccessHandler = require("../utils/SuccessHandler");
const ErrorHandler = require("../utils/ErrorHandler");

/**
 * @desc Get all notifications with filtering and pagination
 * @route GET /api/notifications
 * @access Private (Authenticated user or client)
 */
const getAllNotifications = async (req, res) => {
  // #swagger.tags = ['Notifications']
  /* #swagger.description = 'Get all notifications for the authenticated user or client, with filtering by read/unread and pagination.'
     #swagger.security = [{ "Bearer": [] }]
     #swagger.parameters['isRead'] = { in: 'query', description: 'Filter by read status (true/false)', type: 'boolean' }
     #swagger.parameters['page'] = { in: 'query', description: 'Page number for pagination', type: 'integer' }
     #swagger.parameters['limit'] = { in: 'query', description: 'Number of items per page', type: 'integer' }
  */
  try {
    const { isRead, page = 1, limit = 10 } = req.query;
    const skip = (parseInt(page) - 1) * parseInt(limit);
    
    // Build query based on user type (client or regular user)
    let baseQuery = {};
    const isClient = req.user?.type === 'client';
    
    if (isClient) {
      // For clients, query by client field
      baseQuery.client = req.user._id;
    } else {
      // For regular users (barbers/admins), query by user field
      baseQuery.user = req.user._id;
    }
    
    if (isRead !== undefined) {
      baseQuery.isRead = isRead === "true";
    }
    
    const notifications = await Notification.find(baseQuery)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .populate("user")
      .populate("client");
    const total = await Notification.countDocuments(baseQuery);
    return SuccessHandler(
      {
        notifications,
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
 * @desc Mark all notifications as read for the authenticated user or client
 * @route PATCH /api/notifications/mark-all-read
 * @access Private (Authenticated user or client)
 */
const markAsAllRead = async (req, res) => {
  // #swagger.tags = ['Notifications']
  /* #swagger.description = 'Mark all notifications as read for the authenticated user or client.'
     #swagger.security = [{ "Bearer": [] }]
  */
  try {
    // Build query based on user type (client or regular user)
    let query = { isRead: false };
    const isClient = req.user?.type === 'client';
    
    if (isClient) {
      query.client = req.user._id;
    } else {
      query.user = req.user._id;
    }
    
    await Notification.updateMany(query, { $set: { isRead: true } });
    return SuccessHandler(
      { message: "All notifications marked as read." },
      200,
      res
    );
  } catch (error) {
    return ErrorHandler(error.message, 500, req, res);
  }
};

module.exports = {
  getAllNotifications,
  markAsAllRead,
};
