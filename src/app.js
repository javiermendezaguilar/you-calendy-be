const express = require("express");
const Sentry = require("./instrument");
const cors = require("cors");
const bodyParser = require("body-parser");
const cookieParser = require("cookie-parser");
const rateLimit = require("express-rate-limit");
const ApiError = require("./utils/ApiError");
const app = express();
const router = require("./router");
const loggerMiddleware = require("./middleware/loggerMiddleware");
const { analyticsMiddleware } = require("./middleware/analyticsMiddleware");
const swaggerUi = require("swagger-ui-express");
const swaggerFile = require("../swagger_output.json"); // Generated Swagger file
const path = require("path");
const mongoose = require("mongoose");
const createCsrfProtection = require("./middleware/csrfProtection");
const user = require("./models/User/user");
// const League = require("./models/League/league");
// const Team = require("./models/League/team");
const { CronJob } = require("cron");
const sendNotification = require("./utils/pushNotification");
// Remove webhook handler
// const { handlePayment } = require("./functions/webhook");
// No need to load dotenv here as it's already loaded in index.js
// const dotenv = require("dotenv");
const adminNotification = require("./utils/adminNotification");
// const Season = require("./models/League/season");
// dotenv.config({ path: "./config/config.env" });
const webhookController = require("./controllers/webhookController");
const {
  logStripeWebhookSecretMode,
} = require("./services/billing/stripeWebhookService");
const { stripeWebhookLimiter } = require("./middleware/economicRateLimit");

const parseAllowedOrigins = (value) =>
  (value || "")
    .split(/[\s,]+/)
    .map((origin) => origin.trim())
    .filter(Boolean);

const allowedOrigins = [
  "http://localhost:5000",
  "http://localhost:5173",
  "http://localhost",
  "https://you-calendy-fe-three.vercel.app",
  process.env.FRONTEND_URL,
  ...parseAllowedOrigins(process.env.ADDITIONAL_ALLOWED_ORIGINS),
].filter(Boolean);

const exposedHeaders = ["X-Groomnest-Perf"];
const mongoReadyStates = {
  0: "disconnected",
  1: "connected",
  2: "connecting",
  3: "disconnecting",
};

const appLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many requests, please try again later.",
  },
});

if (process.env.NODE_ENV !== "test") {
  logStripeWebhookSecretMode();
}

// League related global variable doesn't exist
// console.log(global.onlineUsers);

app.set("trust proxy", 1);

// Middlewares
app.use(
  cors({
    origin: allowedOrigins,
    credentials: true,
    exposedHeaders,
  })
);
app.options(
  "*",
  cors({ origin: allowedOrigins, credentials: true, exposedHeaders })
);
app.use(cookieParser()); // Parse cookies for authentication
app.use("/uploads", express.static(path.join(__dirname, "../uploads")));
app.use(loggerMiddleware);
app.use(analyticsMiddleware);

// Stripe webhook raw body parser
app.post(
  "/webhook/stripe",
  stripeWebhookLimiter,
  express.raw({ type: "application/json" }),
  (req, res, next) => {
    req.rawBody = req.body;
    next();
  },
  webhookController.handleStripeWebhook
);

app.use(express.urlencoded({ extended: true }));
app.use(bodyParser.urlencoded({ extended: false }));
app.use(express.json());
app.use(appLimiter);
app.use(createCsrfProtection({ allowedOrigins }));

app.get("/healthz", (req, res) => {
  res.status(200).json({
    success: true,
    status: "ok",
    service: "groomnest-backend",
    timestamp: new Date().toISOString(),
  });
});

app.get("/readyz", (req, res) => {
  const readyState = mongoose.connection.readyState;
  const database = mongoReadyStates[readyState] || "unknown";
  const isReady = readyState === 1;

  res.status(isReady ? 200 : 503).json({
    success: isReady,
    status: isReady ? "ready" : "not_ready",
    service: "groomnest-backend",
    checks: {
      database,
    },
    timestamp: new Date().toISOString(),
  });
});

// router index
app.use("/", router);
// api doc
app.use("/api-docs", swaggerUi.serve, swaggerUi.setup(swaggerFile));

app.get("/", async (req, res) => {
  // Commented out season-related code
  res.send("BE-boilerplate v1.1");
  // await user.updateMany({}, { $set: { isNotificationEnabled: true } });
});

// send back a 404 error for any unknown api request
app.use((req, res, next) => {
  next(new ApiError(404, "Not found"));
});

Sentry.setupExpressErrorHandler(app);

app.use((err, req, res, next) => {
  const statusCode = err.statusCode || 500;
  const message = err.message || "Internal Server Error";

  if (statusCode >= 500) {
    console.error("Unhandled application error:", message);
  }

  res.status(statusCode).json({
    success: false,
    message,
  });
});

// Cron jobs removed to simplify boilerplate

module.exports = app;
