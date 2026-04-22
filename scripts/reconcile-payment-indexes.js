const mongoose = require("mongoose");
const Payment = require("../src/models/payment");

const resolveMongoUri = () =>
  process.env.DATABASE_URL || process.env.MONGO_URI || process.env.MONGODB_URI || "";

const legacyIndexName = "checkout_1_status_1";

const main = async () => {
  const mongoUri = resolveMongoUri();

  if (!mongoUri) {
    throw new Error("Missing Mongo connection string");
  }

  await mongoose.connect(mongoUri);

  const collection = Payment.collection;
  const beforeIndexes = await collection.indexes();
  const hadLegacyIndex = beforeIndexes.some((index) => index.name === legacyIndexName);

  if (hadLegacyIndex) {
    await collection.dropIndex(legacyIndexName);
  }

  await Payment.syncIndexes();
  const afterIndexes = await collection.indexes();

  console.log(
    JSON.stringify(
      {
        hadLegacyIndex,
        legacyIndexRemoved: hadLegacyIndex
          ? !afterIndexes.some((index) => index.name === legacyIndexName)
          : true,
        indexes: afterIndexes.map((index) => ({
          name: index.name,
          key: index.key,
          unique: Boolean(index.unique),
          partialFilterExpression: index.partialFilterExpression || null,
        })),
      },
      null,
      2
    )
  );
};

main()
  .catch((error) => {
    console.error(error.message);
    process.exit(1);
  })
  .finally(async () => {
    try {
      await mongoose.disconnect();
    } catch (_) {}
  });
