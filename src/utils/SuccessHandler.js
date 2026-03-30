const SuccessHandler = (data, statusCode, res, options = {}) => {
  // Set cookie if provided in options
  if (options.cookieName && options.cookieValue) {
    // Determine if we're in production (check multiple ways for reliability)
    const isProduction = process.env.NODE_ENV === 'production' || 
                         process.env.VERCEL === '1' || 
                         process.env.RAILWAY_ENVIRONMENT === 'production';
    
    const cookieOptions = {
      httpOnly: true, // Prevents JavaScript access (XSS protection)
      secure: isProduction, // HTTPS only in production (required for sameSite: 'none')
      sameSite: isProduction ? 'none' : 'lax', // 'none' for cross-site (production), 'lax' for same-site (development)
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days (matches JWT_EXPIRE)
      path: '/', // Available site-wide
    };
    
    // Override with custom options if provided
    if (options.cookieOptions) {
      Object.assign(cookieOptions, options.cookieOptions);
    }
    
    // Ensure secure is true when sameSite is 'none' (browser requirement)
    if (cookieOptions.sameSite === 'none' && !cookieOptions.secure) {
      cookieOptions.secure = true;
    }
    
    res.cookie(options.cookieName, options.cookieValue, cookieOptions);
  }
  
  return res.status(statusCode).json({
    success: true,
    data: data,
  });
};
  // return next(new SuccessHandler("success", 200)); use it like this for success responses
  
  module.exports = SuccessHandler;