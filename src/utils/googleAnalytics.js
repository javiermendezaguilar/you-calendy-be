const ApiKey = require("../models/apiKey");

/**
 * Google Analytics utility for tracking events
 * Uses dynamic API key management from database
 */
class GoogleAnalytics {
  constructor() {
    this.apiKey = null;
    this.isInitialized = false;
  }

  /**
   * Initialize Google Analytics with API key from database
   */
  async initialize() {
    try {
      let apiKey = null;

      try {
        const apiKeyDoc = await ApiKey.getActiveConfig();
        if (apiKeyDoc && apiKeyDoc.googleAnalyticsApiKey) {
          apiKey = apiKeyDoc.googleAnalyticsApiKey;
        }
      } catch (error) {
        console.warn(
          "Failed to fetch Google Analytics API key from database:",
          error.message
        );
      }

      // Fallback to environment variable if not found in database
      if (!apiKey) {
        apiKey = process.env.GOOGLE_ANALYTICS_API_KEY;
      }

      if (!apiKey) {
        // console.warn("Google Analytics API key not configured");
        return false;
      }

      this.apiKey = apiKey;
      this.isInitialized = true;
      console.log("Google Analytics initialized successfully");
      return true;
    } catch (error) {
      console.error("Failed to initialize Google Analytics:", error.message);
      return false;
    }
  }

  /**
   * Track an event
   * @param {string} eventName - Name of the event
   * @param {Object} parameters - Event parameters
   */
  async trackEvent(eventName, parameters = {}) {
    if (!this.isInitialized) {
      // console.warn("Google Analytics not initialized, skipping event tracking");
      return false;
    }

    try {
      // Here you would implement the actual Google Analytics tracking
      // For now, we'll just log the event
      console.log(`Google Analytics Event: ${eventName}`, {
        parameters,
        timestamp: new Date().toISOString(),
      });

      return true;
    } catch (error) {
      console.error("Failed to track Google Analytics event:", error.message);
      return false;
    }
  }

  /**
   * Track page view
   * @param {string} pagePath - Path of the page
   * @param {string} pageTitle - Title of the page
   */
  async trackPageView(pagePath, pageTitle = "") {
    return this.trackEvent("page_view", {
      page_path: pagePath,
      page_title: pageTitle,
    });
  }

  /**
   * Track user engagement
   * @param {string} userId - User ID
   * @param {string} action - Action performed
   * @param {Object} additionalData - Additional data
   */
  async trackUserEngagement(userId, action, additionalData = {}) {
    return this.trackEvent("user_engagement", {
      user_id: userId,
      action,
      ...additionalData,
    });
  }
}

// Create singleton instance
const googleAnalytics = new GoogleAnalytics();

module.exports = googleAnalytics;
