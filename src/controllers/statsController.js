const Appointment = require("../models/appointment");
const Staff = require("../models/staff");
const User = require("../models/User/user");
const SuccessHandler = require("../utils/SuccessHandler");
const ErrorHandler = require("../utils/ErrorHandler");

/**
 * @desc Get monthly appointment trends for a given year
 * @route GET /api/admin/stats/appointments-trend?year=2024
 * @access Private (Admin only)
 */
const getMonthlyAppointmentTrends = async (req, res) => {
  // #swagger.tags = ['Admin Stats']
  /* #swagger.description = 'Get the number of appointments for each month in a given year.'
     #swagger.security = [{ "Bearer": [] }]
     #swagger.parameters['year'] = { in: 'query', description: 'Year to filter by', required: false, type: 'integer' }
  */
  try {
    const year = parseInt(req.query.year) || new Date().getFullYear();
    const start = new Date(year, 0, 1);
    const end = new Date(year + 1, 0, 1);

    // Aggregate appointments by month
    const monthlyStats = await Appointment.aggregate([
      {
        $match: {
          date: { $gte: start, $lt: end },
        },
      },
      {
        $group: {
          _id: { $month: "$date" },
          count: { $sum: 1 },
        },
      },
      {
        $sort: { _id: 1 },
      },
    ]);

    // Map results to all months
    const months = [
      "January",
      "February",
      "March",
      "April",
      "May",
      "June",
      "July",
      "August",
      "September",
      "October",
      "November",
      "December",
    ];
    const monthlyCounts = months.map((month, idx) => {
      const found = monthlyStats.find((m) => m._id === idx + 1);
      return { month, count: found ? found.count : 0 };
    });

    return SuccessHandler({ year, monthlyCounts }, 200, res);
  } catch (error) {
    return ErrorHandler(error.message, 500, req, res);
  }
};

/**
 * @desc Get top barbers by completed appointments for a given year
 * @route GET /api/admin/stats/top-barbers?year=2024
 * @access Private (Admin only)
 */
const getTopBarberTrend = async (req, res) => {
  // #swagger.tags = ['Admin Stats']
  /* #swagger.description = 'Get top barbers ranked by completed appointments for a given year.'
     #swagger.security = [{ "Bearer": [] }]
     #swagger.parameters['year'] = { in: 'query', description: 'Year to filter by', required: false, type: 'integer' }
  */
  try {
    const year = parseInt(req.query.year) || new Date().getFullYear();
    const start = new Date(year, 0, 1);
    const end = new Date(year + 1, 0, 1);

    // Aggregate completed appointments by staff
    const topBarbers = await Appointment.aggregate([
      {
        $match: {
          date: { $gte: start, $lt: end },
          status: "Completed",
          staff: { $ne: null },
        },
      },
      {
        $group: {
          _id: "$staff",
          completedAppointments: { $sum: 1 },
        },
      },
      {
        $sort: { completedAppointments: -1 },
      },
      {
        $limit: 10,
      },
    ]);

    // Populate staff info
    const staffIds = topBarbers.map((b) => b._id);
    const staffDocs = await Staff.find({ _id: { $in: staffIds } }).select(
      "firstName lastName email"
    );
    const staffMap = {};
    staffDocs.forEach((s) => {
      staffMap[s._id.toString()] = s;
    });

    const result = topBarbers.map((b) => ({
      barberId: b._id,
      name: staffMap[b._id?.toString()]
        ? `${staffMap[b._id.toString()].firstName} ${
            staffMap[b._id.toString()].lastName
          }`
        : "Unknown",
      email: staffMap[b._id?.toString()]?.email || null,
      completedAppointments: b.completedAppointments,
    }));

    return SuccessHandler(result, 200, res);
  } catch (error) {
    return ErrorHandler(error.message, 500, req, res);
  }
};

/**
 * @desc Get global revenue projection data for dashboard charts with date range filtering
 * @route GET /api/admin/stats/revenue-projection?startDate=...&endDate=...&groupBy=...
 * @access Private (Admin only)
 */
const getGlobalRevenueProjection = async (req, res) => {
  try {
    const { startDate, endDate, groupBy = "year" } = req.query;

    let query = {};

    // Apply date range filter if provided
    if (startDate || endDate) {
      query.date = {};
      if (startDate) {
        query.date.$gte = new Date(startDate);
      }
      if (endDate) {
        query.date.$lte = new Date(endDate);
      }
    }

    // Build aggregation pipeline based on groupBy parameter
    let groupStage = {};
    let dateFormat = "";

    switch (groupBy) {
      case "year":
        groupStage = {
          year: { $year: "$date" },
        };
        dateFormat = "%Y";
        break;
      case "week":
        groupStage = {
          year: { $year: "$date" },
          week: { $week: "$date" },
        };
        dateFormat = "%Y-W%U";
        break;
      case "month":
        groupStage = {
          year: { $year: "$date" },
          month: { $month: "$date" },
        };
        dateFormat = "%Y-%m";
        break;
      case "day":
      default:
        groupStage = {
          year: { $year: "$date" },
          month: { $month: "$date" },
          day: { $dayOfMonth: "$date" },
        };
        dateFormat = "%Y-%m-%d";
        break;
    }

    // Aggregation pipeline for revenue projection
    const revenuePipeline = [
      { $match: query },
      {
        $group: {
          _id: groupStage,
          revenue: { $sum: "$price" },
          appointments: { $sum: 1 },
          completedAppointments: {
            $sum: { $cond: [{ $eq: ["$status", "Completed"] }, 1, 0] },
          },
          cancelledAppointments: {
            $sum: { $cond: [{ $eq: ["$status", "Canceled"] }, 1, 0] },
          },
          noShowAppointments: {
            $sum: { $cond: [{ $eq: ["$status", "No-Show"] }, 1, 0] },
          },
        },
      },
      {
        $addFields: {
          date: {
            $dateToString: {
              format: dateFormat,
              date: {
                $dateFromParts: {
                  year: "$_id.year",
                  month: "$_id.month",
                  day: "$_id.day",
                },
              },
            },
          },
        },
      },
      { $sort: { date: 1 } },
      {
        $project: {
          _id: 0,
          date: 1,
          revenue: 1,
          appointments: 1,
          completedAppointments: 1,
          cancelledAppointments: 1,
          noShowAppointments: 1,
        },
      },
    ];

    // Execute aggregation
    const revenueData = await Appointment.aggregate(revenuePipeline);

    // Calculate summary statistics
    const summaryPipeline = [
      { $match: query },
      {
        $group: {
          _id: null,
          totalRevenue: { $sum: "$price" },
          totalAppointments: { $sum: 1 },
          completedAppointments: {
            $sum: { $cond: [{ $eq: ["$status", "Completed"] }, 1, 0] },
          },
          cancelledAppointments: {
            $sum: { $cond: [{ $eq: ["$status", "Canceled"] }, 1, 0] },
          },
          noShowAppointments: {
            $sum: { $cond: [{ $eq: ["$status", "No-Show"] }, 1, 0] },
          },
        },
      },
    ];

    const summaryResult = await Appointment.aggregate(summaryPipeline);
    const summary = summaryResult[0] || {
      totalRevenue: 0,
      totalAppointments: 0,
      completedAppointments: 0,
      cancelledAppointments: 0,
      noShowAppointments: 0,
    };

    // Calculate additional metrics
    const averageRevenuePerAppointment =
      summary.totalAppointments > 0
        ? (summary.totalRevenue / summary.totalAppointments).toFixed(2)
        : 0;

    const completionRate =
      summary.totalAppointments > 0
        ? (
            (summary.completedAppointments / summary.totalAppointments) *
            100
          ).toFixed(1)
        : 0;

    // Format response
    const response = {
      totalRevenue: summary.totalRevenue,
      totalAppointments: summary.totalAppointments,
      averageRevenuePerAppointment: parseFloat(averageRevenuePerAppointment),
      revenueData: revenueData.map((item) => ({
        date: item.date,
        revenue: item.revenue,
        appointments: item.appointments,
        completedAppointments: item.completedAppointments,
        cancelledAppointments: item.cancelledAppointments,
        noShowAppointments: item.noShowAppointments,
      })),
      summary: {
        totalRevenue: summary.totalRevenue,
        totalAppointments: summary.totalAppointments,
        averageRevenuePerAppointment: parseFloat(averageRevenuePerAppointment),
        completionRate: parseFloat(completionRate),
        cancelledRate:
          summary.totalAppointments > 0
            ? parseFloat(
                (
                  (summary.cancelledAppointments / summary.totalAppointments) *
                  100
                ).toFixed(1)
              )
            : 0,
        noShowRate:
          summary.totalAppointments > 0
            ? parseFloat(
                (
                  (summary.noShowAppointments / summary.totalAppointments) *
                  100
                ).toFixed(1)
              )
            : 0,
      },
      filters: {
        startDate,
        endDate,
        groupBy,
      },
    };

    return SuccessHandler(response, 200, res);
  } catch (error) {
    return ErrorHandler(error.message, 500, req, res);
  }
};

module.exports = {
  getMonthlyAppointmentTrends,
  getTopBarberTrend,
  getGlobalRevenueProjection,
};
