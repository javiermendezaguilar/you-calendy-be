const Sentry = require("@sentry/node");

const dsn = process.env.SENTRY_DSN;
const tracesSampleRate = Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0.2);

if (dsn && process.env.SENTRY_ENABLED !== "false") {
  Sentry.init({
    dsn,
    environment: process.env.NODE_ENV || "development",
    sendDefaultPii: false,
    tracesSampleRate: Number.isFinite(tracesSampleRate)
      ? tracesSampleRate
      : 0.2,
  });
}

module.exports = Sentry;
