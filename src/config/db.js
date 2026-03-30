const mongoose = require("mongoose");
// No need to load dotenv here as it's already loaded in index.js
// const dotenv = require("dotenv");
// dotenv.config({
//   path: "./config/config.env",
// });

const connectDB = async () => {
  try {
    // Log to help troubleshoot
    console.log(`Attempting to connect to MongoDB. URI exists: ${process.env.MONGO_URI ? 'Yes' : 'No'}`);
    
    if (!process.env.MONGO_URI) {
      throw new Error("MongoDB URI is missing. Please check your environment variables.");
    }
    
    const { connection } = await mongoose.connect(process.env.MONGO_URI);
    console.log(`DB connected: ${connection.host}`);
  } catch (error) {
    console.log(`Error connecting database: ${error}`);
    process.exit(1);
  }
};

module.exports = connectDB;
