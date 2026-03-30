const googleAnalytics = require("../utils/googleAnalytics");

/**
 * Middleware to track API requests with Google Analytics
 * Uses dynamic API key management from database
 */
const analyticsMiddleware = async (req, res, next) => {
  // Skip analytics for certain paths
  const skipPaths = ["/health", "/metrics", "/favicon.ico"];
  if (skipPaths.some((path) => req.path.includes(path))) {
    return next();
  }

  // Track the request asynchronously (don't block the response)
  setImmediate(async () => {
    try {
      // Initialize Google Analytics if not already done
      if (!googleAnalytics.isInitialized) {
        await googleAnalytics.initialize();
      }

      // Track page view
      await googleAnalytics.trackPageView(
        req.path,
        `${req.method} ${req.path}`
      );

      // Track user engagement if user is authenticated
      if (req.user) {
        await googleAnalytics.trackUserEngagement(
          req.user._id.toString(),
          "api_request",
          {
            method: req.method,
            path: req.path,
            user_agent: req.get("User-Agent"),
            ip_address: req.ip,
          }
        );
      }
    } catch (error) {
      // Don't let analytics errors affect the main application
      console.error("Analytics tracking error:", error.message);
    }
  });

  next();
};

/**
 * Middleware to track specific events
 * @param {string} eventName - Name of the event to track
 * @param {Function} getParameters - Function to get event parameters from req/res
 */
const trackEvent = (eventName, getParameters = () => ({})) => {
  return async (req, res, next) => {
    const originalSend = res.send;

    res.send = function (data) {
      // Track event asynchronously after response is sent
      setImmediate(async () => {
        try {
          if (!googleAnalytics.isInitialized) {
            await googleAnalytics.initialize();
          }

          const parameters = getParameters(req, res, data);
          await googleAnalytics.trackEvent(eventName, parameters);
        } catch (error) {
          console.error("Event tracking error:", error.message);
        }
      });

      return originalSend.call(this, data);
    };

    next();
  };
};

module.exports = {
  analyticsMiddleware,
  trackEvent,
};
