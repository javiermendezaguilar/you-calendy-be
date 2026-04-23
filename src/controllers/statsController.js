const Appointment = require("../models/appointment");
const Staff = require("../models/staff");
const User = require("../models/User/user");
const {
  buildDateRangeClause,
  getCanonicalRevenueProjection,
} = require("../services/payment/revenueProjection");
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

    const appointmentDateClause = buildDateRangeClause("date", startDate, endDate);
    const paymentDateClause = buildDateRangeClause(
      "capturedAt",
      startDate,
      endDate
    );

    const response = await getCanonicalRevenueProjection({
      appointmentMatch: appointmentDateClause || {},
      paymentMatch: {
        ...(paymentDateClause || {}),
        status: { $in: ["captured", "refunded_partial", "refunded_full"] },
      },
      groupBy,
    });

    response.filters = {
      startDate,
      endDate,
      groupBy,
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
