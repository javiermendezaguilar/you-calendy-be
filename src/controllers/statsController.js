const Appointment = require("../models/appointment");
const Payment = require("../models/payment");
const Staff = require("../models/staff");
const User = require("../models/User/user");
const { buildCommercePaymentFilter } = require("../services/payment/paymentScope");
const SuccessHandler = require("../utils/SuccessHandler");
const ErrorHandler = require("../utils/ErrorHandler");

const getDateBucketProjection = (fieldName, groupBy) => {
  const dateField = `$${fieldName}`;

  switch (groupBy) {
    case "year":
      return {
        $dateToString: {
          format: "%Y",
          date: dateField,
        },
      };
    case "week":
      return {
        $dateToString: {
          format: "%Y-W%U",
          date: dateField,
        },
      };
    case "month":
      return {
        $dateToString: {
          format: "%Y-%m",
          date: dateField,
        },
      };
    case "day":
    default:
      return {
        $dateToString: {
          format: "%Y-%m-%d",
          date: dateField,
        },
      };
  }
};

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

    let appointmentQuery = {};
    let paymentQuery = buildCommercePaymentFilter({
      status: { $in: ["captured", "refunded_partial", "refunded_full"] },
    });

    // Apply date range filter if provided
    if (startDate || endDate) {
      appointmentQuery.date = {};
      paymentQuery.capturedAt = {};
      if (startDate) {
        const parsedStartDate = new Date(startDate);
        appointmentQuery.date.$gte = parsedStartDate;
        paymentQuery.capturedAt.$gte = parsedStartDate;
      }
      if (endDate) {
        const parsedEndDate = new Date(endDate);
        appointmentQuery.date.$lte = parsedEndDate;
        paymentQuery.capturedAt.$lte = parsedEndDate;
      }
    }
    if (appointmentQuery.date && Object.keys(appointmentQuery.date).length === 0) {
      delete appointmentQuery.date;
    }
    if (paymentQuery.capturedAt && Object.keys(paymentQuery.capturedAt).length === 0) {
      delete paymentQuery.capturedAt;
    }

    const appointmentBucketProjection = getDateBucketProjection("date", groupBy);
    const paymentBucketProjection = getDateBucketProjection("capturedAt", groupBy);

    // Aggregation pipeline for revenue projection
    const appointmentProjectionPipeline = [
      { $match: appointmentQuery },
      {
        $addFields: {
          bucket: appointmentBucketProjection,
        },
      },
      {
        $group: {
          _id: "$bucket",
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
        $sort: { _id: 1 },
      },
    ];

    const paymentProjectionPipeline = [
      { $match: paymentQuery },
      {
        $addFields: {
          bucket: paymentBucketProjection,
          retainedRevenue: {
            $max: [
              {
                $subtract: [
                  { $ifNull: ["$amount", 0] },
                  { $ifNull: ["$refundedTotal", 0] },
                ],
              },
              0,
            ],
          },
        },
      },
      {
        $group: {
          _id: "$bucket",
          revenue: { $sum: "$retainedRevenue" },
        },
      },
      {
        $sort: { _id: 1 },
      },
    ];

    // Calculate summary statistics
    const summaryPipeline = [
      { $match: appointmentQuery },
      {
        $group: {
          _id: null,
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

    const [appointmentBuckets, paymentBuckets, summaryResult, revenueSummary] =
      await Promise.all([
        Appointment.aggregate(appointmentProjectionPipeline),
        Payment.aggregate(paymentProjectionPipeline),
        Appointment.aggregate(summaryPipeline),
        Payment.aggregate([
          { $match: paymentQuery },
          {
            $group: {
              _id: null,
              totalRevenue: {
                $sum: {
                  $max: [
                    {
                      $subtract: [
                        { $ifNull: ["$amount", 0] },
                        { $ifNull: ["$refundedTotal", 0] },
                      ],
                    },
                    0,
                  ],
                },
              },
            },
          },
        ]),
      ]);

    const summary = summaryResult[0] || {
      totalAppointments: 0,
      completedAppointments: 0,
      cancelledAppointments: 0,
      noShowAppointments: 0,
    };
    const totalRevenue = Number(revenueSummary[0]?.totalRevenue) || 0;

    const paymentBucketMap = new Map(
      paymentBuckets.map((bucket) => [bucket._id, Number(bucket.revenue) || 0])
    );
    const appointmentBucketMap = new Map(
      appointmentBuckets.map((bucket) => [bucket._id, bucket])
    );
    const allBuckets = Array.from(
      new Set([
        ...appointmentBuckets.map((bucket) => bucket._id),
        ...paymentBuckets.map((bucket) => bucket._id),
      ])
    ).sort();

    const revenueData = allBuckets.map((bucketKey) => {
      const appointmentBucket = appointmentBucketMap.get(bucketKey);
      return {
        date: bucketKey,
        revenue: paymentBucketMap.get(bucketKey) || 0,
        appointments: appointmentBucket?.appointments || 0,
        completedAppointments: appointmentBucket?.completedAppointments || 0,
        cancelledAppointments: appointmentBucket?.cancelledAppointments || 0,
        noShowAppointments: appointmentBucket?.noShowAppointments || 0,
      };
    });

    // Calculate additional metrics
    const averageRevenuePerAppointment =
      summary.totalAppointments > 0
        ? (totalRevenue / summary.totalAppointments).toFixed(2)
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
      totalRevenue,
      totalAppointments: summary.totalAppointments,
      averageRevenuePerAppointment: parseFloat(averageRevenuePerAppointment),
      revenueData,
      summary: {
        totalRevenue,
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
