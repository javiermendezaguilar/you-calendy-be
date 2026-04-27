const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const translationCacheSchema = new Schema({
  originalText: { type: String, required: true },
  targetLang: { type: String, required: true },
  translatedText: { type: String, required: true },
  sourceLang: { type: String },
  lastUsed: { type: Date, default: Date.now },
});

translationCacheSchema.index(
  { originalText: 1, targetLang: 1 },
  { unique: true }
);
translationCacheSchema.index(
  { lastUsed: 1 },
  {
    expireAfterSeconds: 90 * 24 * 60 * 60,
    name: "translation_cache_lastUsed_ttl_v1",
  }
);

module.exports = mongoose.model("TranslationCache", translationCacheSchema);
