require("./instrument");

// Load environment variables first
const dotenv = require("dotenv");
const path = require("path");
const fs = require("fs");

// Only try to load from config/config.env file
const configEnvPath = path.join(__dirname, "config/config.env");
if (fs.existsSync(configEnvPath)) {
  console.log("Loading environment from config.env file");
  dotenv.config({ path: configEnvPath });
} else {
  console.log("No environment files found, using system environment variables");
}

// Log environment for debugging (don't log actual values in production)
console.log("Environment check:");
console.log("- MONGO_URI exists:", !!process.env.MONGO_URI);
console.log("- PORT:", process.env.PORT || "Not set, will use default");

// Then require other modules
const app = require("./app");
const connectDB = require("./config/db");
const http = require("http");
const { emailCampaignScheduler } = require("./utils/scheduler");
// Comment out socket.io to simplify
// const socket = require("socket.io");
// const { removeUser, addUser } = require("./functions/socketFunctions");

//global vars - commenting out for simplification
// global.io;
// global.onlineUsers = [];

//server setup
const PORT = process.env.PORT || 5000;

const server = http.createServer(app);

// Function to start server
function startServer() {
  server
    .listen(PORT)
    .on("listening", () => {
      console.log(`Server is running on port ${PORT}`);
      connectDB();

      // Initialize email campaign scheduler after database connection
      try {
        emailCampaignScheduler.initialize();
        console.log("Email campaign scheduler initialized");
      } catch (error) {
        console.error("Failed to initialize email campaign scheduler:", error);
      }
    })
    .on("error", (err) => {
      if (err.code === "EADDRINUSE") {
        console.error(`Port ${PORT} is already in use. Please free up the port or change the PORT environment variable.`);
        process.exit(1);
      } else {
        console.error("Server error:", err);
        process.exit(1);
      }
    });
}

// Start the server
startServer();

// Graceful shutdown
process.on("SIGTERM", () => {
  console.log("SIGTERM received, shutting down gracefully");
  emailCampaignScheduler.stop();
  server.close(() => {
    console.log("Server closed");
    process.exit(0);
  });
});

process.on("SIGINT", () => {
  console.log("SIGINT received, shutting down gracefully");
  emailCampaignScheduler.stop();
  server.close(() => {
    console.log("Server closed");
    process.exit(0);
  });
});

// Comment out socket.io functionality to simplify
/*
//socket.io
global.io = socket(server, {
  cors: {
    origin: "*",
  },
});

global.io.on("connection", (socket) => {
  console.log("connected to socket", socket.id);
  global.io.to(socket.id).emit("reconnect", socket.id);
  socket.on("join", (userId) => {
    console.log("user joined", userId);
    addUser(userId, socket.id);
  });
  socket.on("logout", () => {
    removeUser(socket.id);
  });
  socket.on("disconnect", () => {
    removeUser(socket.id);
    console.log("user disconnected", socket.id);
  });
});
*/
