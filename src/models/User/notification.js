const mongoose = require("mongoose");
const { Schema } = mongoose;

const notificationSchema = new Schema(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: false, // Not required when notification is for a client
    },
    client: {
      type: Schema.Types.ObjectId,
      ref: "Client",
      required: false, // Not required when notification is for a user
    },
    type: {
      type: String,
      required: true,
      enum: ["barber", "client", "admin"],
    },
    message: {
      type: String,
      required: true,
    },
    data: {
      type: Object,
    },
    isRead: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true }
);

notificationSchema.index({ user: 1, createdAt: -1 });
notificationSchema.index({ client: 1, createdAt: -1 });

const Notification = mongoose.model("Notification", notificationSchema);
module.exports = Notification;
