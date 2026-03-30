const jwt = require("jsonwebtoken");
const User = require("../models/User/user");
const Business = require("../models/User/business");
const dotenv = require("dotenv");

dotenv.config({ path: ".././src/config/config.env" });

const isAuthenticated = async (req, res, next) => {
  try {
    let token = null;
    let decoded = null;
    const fullPath = req.originalUrl || req.url || req.path;
    const path = fullPath.split('?')[0];
    
    const isAdminRoute = path.includes('/admin') || 
                        path.includes('/auth/subadmins') ||
                        (path.includes('/auth/barbers') && path.includes('/status'));
    
    const normalizedPath = path.replace(/^\/api/, '');
    const isSharedAuthRoute = normalizedPath === '/auth/me' || 
                              normalizedPath === '/auth/profile-settings' ||
                              normalizedPath === '/auth/notification-settings';
    const isBusinessRoute = path.includes('/business');
    const isAdminClientRoute = path === '/client/all' || 
                               /\/client\/[^/]+\/status$/.test(path);
    const isClientRoute = path.includes('/client') && 
                         !isAdminClientRoute && 
                         !isBusinessRoute;
    const isNotificationRoute = path.includes('/notifications');
    const isAppointmentRoute = path.includes('/appointments') && 
                              !path.includes('/appointments/available') && 
                              !path.includes('/appointments/public');
    
    const verifyToken = (tokenToVerify) => {
      try {
        return jwt.verify(tokenToVerify, process.env.JWT_SECRET);
      } catch (error) {
        return null;
      }
    };
    
    const userContextHint = (req.headers['x-user-context'] || '').toLowerCase();
    
    if (userContextHint === 'admin' && req.cookies.adminToken) {
      decoded = verifyToken(req.cookies.adminToken);
      if (decoded) token = req.cookies.adminToken;
    } else if (userContextHint === 'client' && req.cookies.clientToken) {
      decoded = verifyToken(req.cookies.clientToken);
      if (decoded) token = req.cookies.clientToken;
    } else if ((userContextHint === 'barber' || userContextHint === 'user') && req.cookies.userToken) {
      decoded = verifyToken(req.cookies.userToken);
      if (decoded) token = req.cookies.userToken;
    }

    if (!token && (isAdminRoute || isAdminClientRoute)) {
      if (req.cookies.adminToken) {
        decoded = verifyToken(req.cookies.adminToken);
        if (decoded) token = req.cookies.adminToken;
      }
    } else if (!token && isSharedAuthRoute) {
      if (userContextHint === 'admin' && req.cookies.adminToken) {
        decoded = verifyToken(req.cookies.adminToken);
        if (decoded) token = req.cookies.adminToken;
      }
      if (!token && req.cookies.userToken) {
        decoded = verifyToken(req.cookies.userToken);
        if (decoded) token = req.cookies.userToken;
      }
      if (!token && req.cookies.adminToken) {
        decoded = verifyToken(req.cookies.adminToken);
        if (decoded) token = req.cookies.adminToken;
      }
    } else if (!token && isBusinessRoute) {
      if (req.cookies.userToken) {
        decoded = verifyToken(req.cookies.userToken);
        if (decoded) token = req.cookies.userToken;
      }
    } else if (!token && isClientRoute) {
      if (req.cookies.clientToken) {
        decoded = verifyToken(req.cookies.clientToken);
        if (decoded) token = req.cookies.clientToken;
      }
    } else if (!token && isNotificationRoute) {
      if (userContextHint === 'client' && req.cookies.clientToken) {
        decoded = verifyToken(req.cookies.clientToken);
        if (decoded) token = req.cookies.clientToken;
      }
      if (!token && req.cookies.userToken) {
        decoded = verifyToken(req.cookies.userToken);
        if (decoded) token = req.cookies.userToken;
      }
      if (!token && req.cookies.adminToken) {
        decoded = verifyToken(req.cookies.adminToken);
        if (decoded) token = req.cookies.adminToken;
      }
      if (!token && userContextHint !== 'client' && req.cookies.clientToken) {
        decoded = verifyToken(req.cookies.clientToken);
        if (decoded) token = req.cookies.clientToken;
      }
    } else if (!token && isAppointmentRoute) {
      if (req.cookies.userToken) {
        decoded = verifyToken(req.cookies.userToken);
        if (decoded) token = req.cookies.userToken;
      }
      if (!token && req.cookies.clientToken) {
        decoded = verifyToken(req.cookies.clientToken);
        if (decoded) token = req.cookies.clientToken;
      }
    } else if (!token) {
      if (req.cookies.userToken) {
        decoded = verifyToken(req.cookies.userToken);
        if (decoded) token = req.cookies.userToken;
      }
      if (!token && req.cookies.adminToken) {
        decoded = verifyToken(req.cookies.adminToken);
        if (decoded) token = req.cookies.adminToken;
      }
      if (!token && req.cookies.clientToken) {
        decoded = verifyToken(req.cookies.clientToken);
        if (decoded) token = req.cookies.clientToken;
      }
    }
    
    if (!token) {
      const authHeader = req.headers.authorization;
      if (authHeader) {
        const headerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;
        decoded = verifyToken(headerToken);
        if (decoded) token = headerToken;
      }
    }
    
    if (!token || !decoded) {
      return res.status(401).json({ success: false, message: "Not logged in" });
    }
    
    const userId = decoded.id || decoded._id;
    if (decoded.role === 'client' || decoded.type === 'client') {
      const Client = require('../models/client');
      req.client = await Client.findById(userId).populate('business').populate('staff');
      if (!req.client) {
        return res.status(404).json({ success: false, message: "Client not found" });
      }
      req.user = { 
        _id: userId, 
        id: userId.toString(), 
        role: 'client', 
        type: 'client',
        businessId: decoded.businessId 
      };
    } else {
      req.user = await User.findById(userId);
      if (!req.user) {
        return res.status(404).json({ success: false, message: "User not found" });
      }
      req.user.id = req.user._id.toString();
      req.user.type = req.user.role;
    }
    
    next();
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const isBusinessOwner = async (req, res, next) => {
  try {
    const userId = req.user._id || req.user.id;
    const business = await Business.findOne({ owner: userId });
    if (!business) {
      return res.status(403).json({ success: false, message: "User is not a business owner" });
    }
    req.business = business;
    next();
  } catch (error) {
    res.status(500).json({ success: false, message: error.message });
  }
};

const isAdmin = (req, res, next) => {
  if (req.user.role !== "admin") {
    return res.status(403).json({ success: false, message: "Forbidden" });
  }
  next();
};

const tryAuthenticate = async (req, res, next) => {
  try {
    const clientToken = req.cookies?.clientToken;
    const userToken = req.cookies?.userToken;
    const adminToken = req.cookies?.adminToken;
    const authHeaderToken = req.headers.authorization?.startsWith("Bearer ") 
      ? req.headers.authorization.split(" ")[1] 
      : null;

    let decoded = null;
    const verifyToken = (t) => {
      try { return jwt.verify(t, process.env.JWT_SECRET); } catch (e) { return null; }
    };

    decoded = verifyToken(clientToken) || verifyToken(userToken) || verifyToken(adminToken) || verifyToken(authHeaderToken);

    if (decoded) {
      const userId = decoded.id || decoded._id;
      if (decoded.role === "client" || decoded.type === 'client') {
        const Client = require("../models/client");
        const client = await Client.findById(userId);
        if (client) {
          req.client = client;
          req.user = { _id: client._id, id: client._id, role: "client", type: "client" };
        }
      } else {
        const user = await User.findById(userId);
        if (user) {
          req.user = user;
          req.user.type = user.role;
        }
      }
    }
  } catch (error) { }
  next();
};

module.exports = {
  isAuthenticated,
  isAdmin,
  isBusinessOwner,
  tryAuthenticate
};
