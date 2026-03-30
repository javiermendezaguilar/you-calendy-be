const User = require("../models/User/user");
const Client = require("../models/client");
const sendMail = require("../utils/sendMail");
const SuccessHandler = require("../utils/SuccessHandler");
const ErrorHandler = require("../utils/ErrorHandler");

/**
 * @desc Send email to users based on recipient group (Admin functionality)
 * @route POST /api/admin/send-email
 * @access Private (Admin only)
 */
const sendEmailToUsers = async (req, res) => {
  // #swagger.tags = ['Admin']
  /* #swagger.description = 'Send plain text email to users based on recipient group selection (Admin only)'
     #swagger.security = [{ "Bearer": [] }]
     #swagger.parameters['obj'] = {
        in: 'body',
        description: 'Email content and recipient group',
        required: true,
        schema: {
          recipientGroup: 'all',
          message: 'This is a plain text message for all users.'
        }
     }
     #swagger.responses[200] = {
        description: 'Email sent successfully',
        schema: {
          success: true,
          message: 'Email sent to 150 users',
          data: {
            recipientGroup: 'all',
            totalRecipients: 150,
            successCount: 150,
            barbersCount: 50,
            clientsCount: 100,
            failedEmails: []
          }
        }
     }
     #swagger.responses[400] = {
        description: 'Missing required fields or invalid recipient group'
     }
  */
  try {
    const { recipientGroup, message } = req.body;

    // Validate required fields
    if (!recipientGroup || !message) {
      return ErrorHandler(
        "Recipient group and message are required.",
        400,
        req,
        res
      );
    }

    // Validate recipient group
    if (!["all", "barbers", "clients"].includes(recipientGroup)) {
      return ErrorHandler(
        "Recipient group must be 'all', 'barbers', or 'clients'.",
        400,
        req,
        res
      );
    }

    let recipients = [];

    // Get recipients based on recipient group
    if (recipientGroup === "all" || recipientGroup === "barbers") {
      const barbers = await User.find({
        role: "barber",
        isActive: true,
        email: { $exists: true, $ne: null, $ne: "" },
      }).select("email name");

      if (recipientGroup === "barbers") {
        recipients = barbers.map((barber) => ({
          email: barber.email,
          name: barber.name,
          type: "barber",
        }));
      } else {
        recipients.push(
          ...barbers.map((barber) => ({
            email: barber.email,
            name: barber.name,
            type: "barber",
          }))
        );
      }
    }

    if (recipientGroup === "all" || recipientGroup === "clients") {
      const clients = await Client.find({
        isActive: true,
        email: { $exists: true, $ne: null, $ne: "" },
      }).select("email firstName lastName");

      if (recipientGroup === "clients") {
        recipients = clients.map((client) => ({
          email: client.email,
          name: `${client.firstName} ${client.lastName}`.trim(),
          type: "client",
        }));
      } else {
        recipients.push(
          ...clients.map((client) => ({
            email: client.email,
            name: `${client.firstName} ${client.lastName}`.trim(),
            type: "client",
          }))
        );
      }
    }

    if (recipients.length === 0) {
      return ErrorHandler(
        `No active ${recipientGroup} found to send emails to.`,
        400,
        req,
        res
      );
    }

    // Generate subject based on recipient group
    const subject = `Message from Admin - ${
      recipientGroup.charAt(0).toUpperCase() + recipientGroup.slice(1)
    }`;

    // Send emails
    const failedEmails = [];
    let successCount = 0;

    for (const recipient of recipients) {
      try {
        await sendMail(recipient.email, subject, message);
        successCount++;
      } catch (error) {
        console.error(
          `Failed to send email to ${recipient.email}:`,
          error.message
        );
        failedEmails.push({
          email: recipient.email,
          name: recipient.name,
          type: recipient.type,
          error: error.message,
        });
      }
    }

    const barbersCount = recipients.filter((r) => r.type === "barber").length;
    const clientsCount = recipients.filter((r) => r.type === "client").length;

    return SuccessHandler(
      {
        message: `Email sent to ${successCount} ${recipientGroup}`,
        data: {
          recipientGroup,
          totalRecipients: recipients.length,
          successCount,
          barbersCount,
          clientsCount,
          failedEmails,
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
 * @desc Get user statistics for admin dashboard
 * @route GET /api/admin/user-stats
 * @access Private (Admin only)
 */
const getUserStats = async (req, res) => {
  // #swagger.tags = ['Admin']
  /* #swagger.description = 'Get user statistics for admin dashboard'
     #swagger.security = [{ "Bearer": [] }]
     #swagger.responses[200] = {
        description: 'User statistics retrieved successfully',
        schema: {
          success: true,
          data: {
            totalUsers: 150,
            barbers: {
              total: 50,
              withEmail: 48,
              active: 45
            },
            clients: {
              total: 100,
              withEmail: 95,
              active: 90
            }
          }
        }
     }
  */
  try {
    // Get barber statistics
    const totalBarbers = await User.countDocuments({
      role: "barber",
      isActive: true,
    });

    const barbersWithEmail = await User.countDocuments({
      role: "barber",
      isActive: true,
      email: { $exists: true, $ne: null, $ne: "" },
    });

    const activeBarbers = await User.countDocuments({
      role: "barber",
      isActive: true,
      status: "activated",
    });

    // Get client statistics
    const totalClients = await Client.countDocuments({
      isActive: true,
    });

    const clientsWithEmail = await Client.countDocuments({
      isActive: true,
      email: { $exists: true, $ne: null, $ne: "" },
    });

    const activeClients = await Client.countDocuments({
      isActive: true,
      status: "activated",
    });

    const stats = {
      totalUsers: totalBarbers + totalClients,
      barbers: {
        total: totalBarbers,
        withEmail: barbersWithEmail,
        active: activeBarbers,
      },
      clients: {
        total: totalClients,
        withEmail: clientsWithEmail,
        active: activeClients,
      },
    };

    return SuccessHandler(stats, 200, res);
  } catch (error) {
    return ErrorHandler(error.message, 500, req, res);
  }
};

/**
 * @desc Get recipient groups for email dropdown
 * @route GET /api/admin/recipient-groups
 * @access Private (Admin only)
 */
const getRecipientGroups = async (req, res) => {
  // #swagger.tags = ['Admin']
  /* #swagger.description = 'Get available recipient groups for email dropdown'
     #swagger.security = [{ "Bearer": [] }]
     #swagger.responses[200] = {
        description: 'Recipient groups retrieved successfully',
        schema: {
          success: true,
          data: [
            { value: 'all', label: 'All Users', count: 150 },
            { value: 'barbers', label: 'Barbers', count: 50 },
            { value: 'clients', label: 'Clients', count: 100 }
          ]
        }
     }
  */
  try {
    // Get counts for each group
    const barbersCount = await User.countDocuments({
      role: "barber",
      isActive: true,
      email: { $exists: true, $ne: null, $ne: "" },
    });

    const clientsCount = await Client.countDocuments({
      isActive: true,
      email: { $exists: true, $ne: null, $ne: "" },
    });

    const allUsersCount = barbersCount + clientsCount;

    const recipientGroups = [
      {
        value: "all",
        label: "All Users",
        count: allUsersCount,
      },
      {
        value: "barbers",
        label: "Barbers",
        count: barbersCount,
      },
      {
        value: "clients",
        label: "Clients",
        count: clientsCount,
      },
    ];

    return SuccessHandler(recipientGroups, 200, res);
  } catch (error) {
    return ErrorHandler(error.message, 500, req, res);
  }
};

const updateClientProfile = async (req, res) => {
  try {
    const { clientId } = req.params;
    const client = await Client.findByIdAndUpdate(clientId, req.body, {
      new: true,
      runValidators: true,
    });
    if (!client) {
      return ErrorHandler("Client not found", 404, req, res);
    }
    return SuccessHandler(client, 200, res);
  } catch (error) {
    return ErrorHandler(error.message, 500, req, res);
  }
};

/**
 * @desc Update client status (Admin functionality)
 * @route PATCH /api/admin/clients/:clientId/status
 * @access Private (Admin only)
 */
const updateClientStatusByAdmin = async (req, res) => {
  // #swagger.tags = ['Admin']
  /* #swagger.description = 'Update client status by admin (activate/deactivate)'
     #swagger.security = [{ "Bearer": [] }]
     #swagger.parameters['clientId'] = { in: 'path', description: 'Client ID', required: true, type: 'string' }
     #swagger.parameters['obj'] = {
        in: 'body',
        description: 'Status update data',
        required: true,
        schema: {
          status: 'activated'
        }
     }
  */
  try {
    const { clientId } = req.params;
    const { status } = req.body;

    if (!status || !["activated", "deactivated"].includes(status)) {
      return ErrorHandler("Valid status is required (activated or deactivated).", 400, req, res);
    }

    const client = await Client.findByIdAndUpdate(
      clientId,
      { 
        status: status,
        isActive: status === "activated" 
      },
      { new: true }
    );

    if (!client) {
      return ErrorHandler("Client not found.", 404, req, res);
    }

    return SuccessHandler("Client status updated successfully", 200, res);
  } catch (error) {
    return ErrorHandler(error.message, 500, req, res);
  }
};

/**
 * @desc Delete a client (Admin functionality)
 * @route DELETE /api/admin/clients/:clientId
 * @access Private (Admin only)
 */
const deleteClientByAdmin = async (req, res) => {
  // #swagger.tags = ['Admin']
  /* #swagger.description = 'Delete a client by admin (hard delete - removes from database)'
     #swagger.security = [{ "Bearer": [] }]
     #swagger.parameters['clientId'] = { in: 'path', description: 'Client ID', required: true, type: 'string' }
  */
  try {
    const { clientId } = req.params;

    const client = await Client.findByIdAndDelete(clientId);

    if (!client) {
      return ErrorHandler("Client not found.", 404, req, res);
    }

    return SuccessHandler("Client deleted successfully", 200, res);
  } catch (error) {
    return ErrorHandler(error.message, 500, req, res);
  }
};

module.exports = {
  sendEmailToUsers,
  getUserStats,
  getRecipientGroups,
  updateClientProfile,
  updateClientStatusByAdmin,
  deleteClientByAdmin,
};
