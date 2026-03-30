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

module.exports = mongoose.model("TranslationCache", translationCacheSchema);
