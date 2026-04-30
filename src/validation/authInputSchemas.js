const {
  idParams,
  numberInput,
  optionalBoolean,
  optionalString,
  requiredString,
  z,
} = require("./requestSchemaPrimitives");

const emailAddress = z.preprocess(
  (value) => (typeof value === "string" ? value.trim() : value),
  z.string().email().max(320)
);

const existingPassword = z.string().min(1).max(256);
const newPassword = z.string().min(6).max(256);

const optionalEmailAddress = z.preprocess(
  (value) => {
    if (value === undefined || value === null) return undefined;
    if (typeof value === "string" && value.trim() === "") return undefined;
    return typeof value === "string" ? value.trim() : value;
  },
  z.string().email().max(320).optional()
);

const optionalUrl = optionalString(2048);

const registerAddress = z
  .object({
    streetName: requiredString(200),
    houseNumber: requiredString(50),
    city: requiredString(120),
    postalCode: requiredString(40),
  })
  .passthrough();

const coordinate = numberInput(z.number().finite());

const registerLocation = z
  .object({
    coordinates: z.array(coordinate).length(2),
    address: requiredString(500),
  })
  .passthrough();

const registerBody = z
  .object({
    email: emailAddress,
    password: newPassword,
    personalName: requiredString(120),
    surname: requiredString(120),
    phone: requiredString(60),
    businessName: requiredString(200),
    address: registerAddress,
    location: registerLocation,
    businessHours: z.object({}).passthrough(),
    services: z.array(z.any()).max(100).optional(),
    googlePlaceId: optionalString(500),
  })
  .passthrough();

const loginBody = z
  .object({
    email: emailAddress,
    password: existingPassword,
    deviceToken: optionalString(512),
    userType: z.enum(["admin", "user"]).optional(),
  })
  .passthrough();

const logoutUserType = z.enum(["admin", "client", "user"]).optional();

const logoutBody = z
  .object({
    userType: logoutUserType,
  })
  .passthrough();

const forgotPasswordBody = z
  .object({
    email: emailAddress,
  })
  .passthrough();

const resetPasswordBody = z
  .object({
    email: emailAddress,
    passwordResetToken: z.preprocess(
      (value) => {
        if (typeof value === "number") return String(value);
        return typeof value === "string" ? value.trim() : value;
      },
      z.string().regex(/^\d{6}$/, "must be a 6 digit token")
    ),
    password: newPassword,
  })
  .passthrough();

const updatePasswordBody = z
  .object({
    currentPassword: existingPassword,
    newPassword,
  })
  .passthrough();

const socialAuthBody = z
  .object({
    email: optionalEmailAddress,
    name: requiredString(200),
    provider: z.enum(["google", "facebook"]),
    photoURL: optionalUrl,
    deviceToken: optionalString(512),
  })
  .passthrough()
  .superRefine((value, ctx) => {
    if (value.provider === "google" && !value.email) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["email"],
        message: "is required for google provider",
      });
    }
  });

const barberStatusBody = z
  .object({
    status: z.enum(["activated", "deactivated"]),
  })
  .passthrough();

const notificationSettingsBody = z
  .object({
    isNotificationEnabled: optionalBoolean,
    barberRegistration: optionalBoolean,
    subscriptionExpiry: optionalBoolean,
    bookingSpike: optionalBoolean,
  })
  .passthrough();

module.exports = {
  authInputSchemas: {
    register: {
      body: registerBody,
    },
    login: {
      body: loginBody,
    },
    logout: {
      body: logoutBody,
      query: logoutBody,
    },
    forgotPassword: {
      body: forgotPasswordBody,
    },
    resetPassword: {
      body: resetPasswordBody,
    },
    updatePassword: {
      body: updatePasswordBody,
    },
    socialAuth: {
      body: socialAuthBody,
    },
    barberById: {
      params: idParams,
    },
    updateBarberStatus: {
      params: idParams,
      body: barberStatusBody,
    },
    notificationSettings: {
      body: notificationSettingsBody,
    },
  },
};
