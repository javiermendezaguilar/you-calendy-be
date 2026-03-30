const mongoose = require("mongoose");
const Client = require("../models/client");
const { generateInvitationToken } = require("./index");

/**
 * Migration script to generate invitation tokens for existing clients
 * Run this script once to ensure all existing clients have invitation tokens
 */
const migrateClientTokens = async () => {
  try {
    console.log("Starting client token migration...");

    // Find all clients without invitation tokens
    const clientsWithoutTokens = await Client.find({
      $or: [
        { invitationToken: { $exists: false } },
        { invitationToken: null },
        { invitationToken: "" },
      ],
    });

    console.log(
      `Found ${clientsWithoutTokens.length} clients without invitation tokens`
    );

    if (clientsWithoutTokens.length === 0) {
      console.log("All clients already have invitation tokens");
      return;
    }

    // Generate tokens for each client
    for (const client of clientsWithoutTokens) {
      const token = generateInvitationToken();
      await Client.findByIdAndUpdate(client._id, { invitationToken: token });
      console.log(
        `Generated token for client: ${client.firstName} ${client.lastName} (${client.email})`
      );
    }

    console.log("Migration completed successfully!");
  } catch (error) {
    console.error("Migration failed:", error);
    throw error;
  }
};

// Export for use in other scripts
module.exports = { migrateClientTokens };

// Run migration if this file is executed directly
if (require.main === module) {
  // Connect to database (you'll need to set up your connection)
  mongoose
    .connect(
      process.env.MONGODB_URI || "mongodb://localhost:27017/your-database"
    )
    .then(() => {
      console.log("Connected to database");
      return migrateClientTokens();
    })
    .then(() => {
      console.log("Migration completed");
      process.exit(0);
    })
    .catch((error) => {
      console.error("Migration failed:", error);
      process.exit(1);
    });
}
