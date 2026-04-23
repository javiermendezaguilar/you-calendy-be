const Appointment = require("../../models/appointment");
const Payment = require("../../models/payment");
const { buildCommercePaymentFilter } = require("./paymentScope");

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

const buildDateRangeClause = (fieldName, startDate, endDate) => {
  if (!startDate && !endDate) {
    return null;
  }

  const clause = {};
  if (startDate) {
    clause.$gte = new Date(startDate);
  }
  if (endDate) {
    clause.$lte = new Date(endDate);
  }

  return Object.keys(clause).length > 0 ? { [fieldName]: clause } : null;
};

const buildRetainedRevenueExpression = () => ({
  $max: [
    {
      $subtract: [{ $ifNull: ["$amount", 0] }, { $ifNull: ["$refundedTotal", 0] }],
    },
    0,
  ],
});

const getPercentage = (numerator, denominator) =>
  denominator > 0 ? Number(((numerator / denominator) * 100).toFixed(1)) : 0;

const buildRevenueGroupStage = (groupId) => ({
  $group: {
    _id: groupId,
    totalRevenue: {
      $sum: buildRetainedRevenueExpression(),
    },
  },
});

const getCanonicalRevenueTotalsByBusiness = async ({
  businessIds = [],
  paymentMatch = {},
} = {}) => {
  if (!Array.isArray(businessIds) || businessIds.length === 0) {
    return [];
  }

  return Payment.aggregate([
    {
      $match: buildCommercePaymentFilter({
        ...paymentMatch,
        business: { $in: businessIds },
      }),
    },
    buildRevenueGroupStage("$business"),
  ]);
};

const getCanonicalRevenueTotalsByStaff = async ({
  staffIds = [],
  paymentMatch = {},
} = {}) => {
  if (!Array.isArray(staffIds) || staffIds.length === 0) {
    return [];
  }

  return Payment.aggregate([
    {
      $match: buildCommercePaymentFilter({
        ...paymentMatch,
        staff: { $in: staffIds },
      }),
    },
    buildRevenueGroupStage("$staff"),
  ]);
};

const getCanonicalRevenueTotalByAppointmentIds = async ({
  appointmentIds = [],
  paymentMatch = {},
} = {}) => {
  if (!Array.isArray(appointmentIds) || appointmentIds.length === 0) {
    return 0;
  }

  const revenueAgg = await Payment.aggregate([
    {
      $match: buildCommercePaymentFilter({
        ...paymentMatch,
        appointment: { $in: appointmentIds },
      }),
    },
    buildRevenueGroupStage(null),
  ]);

  return Number(revenueAgg[0]?.totalRevenue) || 0;
};

const getCanonicalRevenueProjection = async ({
  appointmentMatch = {},
  paymentMatch = {},
  groupBy = "year",
  appointmentDateField = "date",
  paymentDateField = "capturedAt",
}) => {
  const appointmentBucketProjection = getDateBucketProjection(
    appointmentDateField,
    groupBy
  );
  const paymentBucketProjection = getDateBucketProjection(paymentDateField, groupBy);

  const appointmentProjectionPipeline = [
    { $match: appointmentMatch },
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
    { $match: buildCommercePaymentFilter(paymentMatch) },
    {
      $addFields: {
        bucket: paymentBucketProjection,
        retainedRevenue: buildRetainedRevenueExpression(),
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

  const appointmentSummaryPipeline = [
    { $match: appointmentMatch },
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

  const revenueSummaryPipeline = [
    { $match: buildCommercePaymentFilter(paymentMatch) },
    buildRevenueGroupStage(null),
  ];

  const [appointmentBuckets, paymentBuckets, appointmentSummary, revenueSummary] =
    await Promise.all([
      Appointment.aggregate(appointmentProjectionPipeline),
      Payment.aggregate(paymentProjectionPipeline),
      Appointment.aggregate(appointmentSummaryPipeline),
      Payment.aggregate(revenueSummaryPipeline),
    ]);

  const summary = appointmentSummary[0] || {
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

  const averageRevenuePerAppointment =
    summary.totalAppointments > 0
      ? Number((totalRevenue / summary.totalAppointments).toFixed(2))
      : 0;

  const completionRate = getPercentage(
    summary.completedAppointments,
    summary.totalAppointments
  );
  const cancelledRate = getPercentage(
    summary.cancelledAppointments,
    summary.totalAppointments
  );
  const noShowRate = getPercentage(
    summary.noShowAppointments,
    summary.totalAppointments
  );

  return {
    totalRevenue,
    totalAppointments: summary.totalAppointments,
    averageRevenuePerAppointment,
    revenueData,
    summary: {
      totalRevenue,
      totalAppointments: summary.totalAppointments,
      averageRevenuePerAppointment,
      completionRate,
      cancelledRate,
      noShowRate,
    },
  };
};

module.exports = {
  buildDateRangeClause,
  getCanonicalRevenueTotalByAppointmentIds,
  getCanonicalRevenueTotalsByBusiness,
  getCanonicalRevenueTotalsByStaff,
  getCanonicalRevenueProjection,
};
