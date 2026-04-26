const SERVICE_LINE_SOURCES = [
  "reserved_service_default",
  "manual_adjustment",
];

const createServiceLineSnapshotSchema = (Schema) =>
  new Schema(
    {
      service: {
        id: {
          type: Schema.Types.ObjectId,
          ref: "Service",
          default: null,
        },
        name: {
          type: String,
          default: "",
        },
      },
      staff: {
        id: {
          type: Schema.Types.ObjectId,
          ref: "Staff",
          default: null,
        },
        firstName: {
          type: String,
          default: "",
        },
        lastName: {
          type: String,
          default: "",
        },
      },
      quantity: {
        type: Number,
        default: 1,
        min: 1,
      },
      unitPrice: {
        type: Number,
        default: 0,
        min: 0,
      },
      durationMinutes: {
        type: Number,
        default: 0,
        min: 0,
      },
      adjustmentAmount: {
        type: Number,
        default: 0,
      },
      lineTotal: {
        type: Number,
        default: 0,
        min: 0,
      },
      source: {
        type: String,
        enum: SERVICE_LINE_SOURCES,
        default: "manual_adjustment",
      },
      note: {
        type: String,
        trim: true,
        default: "",
      },
    },
    { _id: true }
  );

module.exports = {
  createServiceLineSnapshotSchema,
  SERVICE_LINE_SOURCES,
};
