const { buildAuthCookieOptions } = require("./authCookieOptions");

const SuccessHandler = (data, statusCode, res, options = {}) => {
  // Set cookie if provided in options
  if (options.cookieName && options.cookieValue) {
    const cookieOptions = buildAuthCookieOptions(
      process.env,
      options.cookieOptions || {}
    );

    res.cookie(options.cookieName, options.cookieValue, cookieOptions);
  }
  
  return res.status(statusCode).json({
    success: true,
    data: data,
  });
};
  // return next(new SuccessHandler("success", 200)); use it like this for success responses
  
  module.exports = SuccessHandler;
