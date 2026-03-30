// Google Cloud Translation utility
const { TranslationServiceClient } = require("@google-cloud/translate").v3;
const path = require("path");
const TranslationCache = require("../models/translationCache");
const dotenv = require("dotenv");

// Load environment variables from config.env
dotenv.config({ path: path.join(__dirname, "../config/config.env") });

const projectId = process.env.GCLOUD_PROJECT_ID;
const location = "global";

console.log("Translation setup - Project ID:", projectId);
console.log(
  "Translation setup - Key file path:",
  process.env.GCLOUD_TRANSLATE_KEYFILE
);

// Handle the key file path robustly
const fs = require("fs");
const projectRoot = path.join(__dirname, "../../");
const srcDir = path.join(__dirname, "../");

function resolveKeyFilePathFromEnv(envPath) {
  if (!envPath) return null;

  // Absolute path
  if (path.isAbsolute(envPath)) return envPath;

  // Try project root
  const rootCandidate = path.resolve(projectRoot, envPath);
  if (fs.existsSync(rootCandidate)) return rootCandidate;

  // Try src directory
  const srcCandidate = path.resolve(srcDir, envPath);
  if (fs.existsSync(srcCandidate)) return srcCandidate;

  // Try removing any leading './'
  const cleaned = envPath.replace(/^\.\//, "");
  const rootClean = path.resolve(projectRoot, cleaned);
  if (fs.existsSync(rootClean)) return rootClean;
  const srcClean = path.resolve(srcDir, cleaned);
  if (fs.existsSync(srcClean)) return srcClean;

  return null;
}

let keyFilename = resolveKeyFilePathFromEnv(process.env.GCLOUD_TRANSLATE_KEYFILE);
if (!keyFilename) {
  // Fallback: assume key is placed under src directory next to this file
  keyFilename = path.join(srcDir, "global-approach-469211-g4-d88a01b7357d.json");
  if (!fs.existsSync(keyFilename)) {
    // Final fallback: project root
    const rootFallback = path.join(projectRoot, "global-approach-469211-g4-d88a01b7357d.json");
    if (fs.existsSync(rootFallback)) {
      keyFilename = rootFallback;
    }
  }
}

console.log("Resolved key file path:", keyFilename);

// If the key file still doesn't exist, disable translation gracefully
if (!fs.existsSync(keyFilename)) {
  console.error("Google Cloud key file not found at any expected location.");
  console.error("Checked:", process.env.GCLOUD_TRANSLATE_KEYFILE, "=>", keyFilename);
  console.error("Translation will be disabled.");
  module.exports = {
    translateText: async (text, targetLang) => {
      console.log(`Translation disabled - returning original text: "${text}"`);
      return text;
    },
    translateBatch: async (texts, targetLang) => {
      const inputArray = Array.isArray(texts) ? texts : [texts];
      console.log(`Translation disabled - returning original texts:`, inputArray);
      return inputArray;
    },
    detectLanguage: async () => "en",
  };
  return;
}

// Check if project ID is available
if (!projectId) {
  console.error(
    "GCLOUD_PROJECT_ID not found in environment variables. Translation will be disabled."
  );
  module.exports = {
    translateText: async (text, targetLang) => {
      console.log(`Translation disabled - returning original text: "${text}"`);
      return text;
    },
    translateBatch: async (texts, targetLang) => {
      const inputArray = Array.isArray(texts) ? texts : [texts];
      console.log(`Translation disabled - returning original texts:`, inputArray);
      return inputArray;
    },
    detectLanguage: async () => "en",
  };
  return;
}

console.log("Initializing Google Cloud Translation client...");
const client = new TranslationServiceClient({ keyFilename });
console.log("Google Cloud Translation client initialized successfully");

/**
 * Translate a single text string
 * @param {string} text - The text to translate
 * @param {string} targetLang - The target language code (e.g., 'es', 'fr')
 * @returns {Promise<string>} - The translated text
 */
async function translateText(text, targetLang) {
  if (!text || !targetLang || targetLang === "en") {
    console.log(
      `Skipping translation - text: "${text}", targetLang: ${targetLang}`
    );
    return text;
  }

  console.log(`Translating: "${text}" to ${targetLang}`);

  // Check cache first
  try {
    const cache = await TranslationCache.findOne({
      originalText: text,
      targetLang,
    }).lean();
    if (cache) {
      console.log(`Cache hit for: "${text}" -> "${cache.translatedText}"`);
      // Update lastUsed
      await TranslationCache.updateOne(
        { _id: cache._id },
        { $set: { lastUsed: new Date() } }
      );
      return cache.translatedText;
    }
  } catch (cacheError) {
    console.error("Cache error:", cacheError.message);
  }

  try {
    console.log(
      `Calling Google Cloud Translation API for: "${text}" to ${targetLang}`
    );
    console.log(`Using project: ${projectId}, location: ${location}`);

    const request = {
      parent: `projects/${projectId}/locations/${location}`,
      contents: [text],
      mimeType: "text/plain",
      targetLanguageCode: targetLang,
    };

    console.log("Translation request:", JSON.stringify(request, null, 2));

    const [response] = await client.translateText(request);

    console.log("Translation response:", JSON.stringify(response, null, 2));

    const translated = response.translations[0]?.translatedText || text;
    console.log(`Translation result: "${text}" -> "${translated}"`);

    // Save to cache
    try {
      await TranslationCache.create({
        originalText: text,
        targetLang,
        translatedText: translated,
        sourceLang: response.translations[0]?.detectedLanguageCode || "en",
        lastUsed: new Date(),
      });
      console.log("Translation saved to cache");
    } catch (cacheSaveError) {
      console.error("Failed to save to cache:", cacheSaveError.message);
    }

    return translated;
  } catch (err) {
    console.error("Translation error details:");
    console.error("- Message:", err.message);
    console.error("- Code:", err.code);
    console.error("- Status:", err.status);
    console.error("- Details:", err.details);
    console.error("- Full error:", JSON.stringify(err, null, 2));

    // Check for specific error types
    if (err.code === 7) {
      console.error(
        "ERROR: Permission denied. Check if the service account has the 'Cloud Translation API User' role."
      );
    } else if (err.code === 3) {
      console.error(
        "ERROR: Invalid argument. Check if the project ID is correct."
      );
    } else if (err.code === 12) {
      console.error(
        "ERROR: Unimplemented. Check if the Cloud Translation API is enabled for this project."
      );
    } else if (err.message && err.message.includes("billing")) {
      console.error(
        "ERROR: Billing not enabled for this project. Enable billing in Google Cloud Console."
      );
    }

    return text;
  }
}

/**
 * Translate an array of texts in a single API call
 * @param {string[] | string} texts - Array of texts to translate (or a single string which will be coerced)
 * @param {string} targetLang - The target language code
 * @returns {Promise<string[]>} - Array of translated texts
 */
async function translateBatch(texts, targetLang) {
  // Always coerce to array to maintain consistent API contract
  const inputArray = Array.isArray(texts) ? texts : [texts];
  if (!targetLang || targetLang === "en") return inputArray;

  console.log(`Batch translation: ${inputArray.length} texts to ${targetLang}`);

  // Filter out empty texts and get unique texts
  const uniqueTexts = [...new Set(inputArray.filter((text) => text && text.trim()))];

  if (uniqueTexts.length === 0) return inputArray;

  console.log(`Unique texts to translate: ${uniqueTexts.length}`);

  // Check cache first for all texts
  const cacheResults = [];
  const textsToTranslate = [];
  const textToIndexMap = new Map();

  for (let i = 0; i < uniqueTexts.length; i++) {
    const text = uniqueTexts[i];
    try {
      const cache = await TranslationCache.findOne({
        originalText: text,
        targetLang,
      }).lean();

      if (cache) {
        console.log(`Cache hit for: "${text}" -> "${cache.translatedText}"`);
        // Update lastUsed
        await TranslationCache.updateOne(
          { _id: cache._id },
          { $set: { lastUsed: new Date() } }
        );
        cacheResults.push({ text, translated: cache.translatedText, index: i });
      } else {
        textsToTranslate.push(text);
        textToIndexMap.set(text, i);
      }
    } catch (cacheError) {
      console.error("Cache error for text:", text, cacheError.message);
      textsToTranslate.push(text);
      textToIndexMap.set(text, i);
    }
  }

  // If all texts are cached, return results
  if (textsToTranslate.length === 0) {
    console.log("All texts found in cache");
    const results = new Array(uniqueTexts.length);
    cacheResults.forEach(({ text, translated, index }) => {
      results[index] = translated;
    });
    return results;
  }

  // Make single API call for uncached texts
  try {
    console.log(`Making batch API call for ${textsToTranslate.length} texts`);

    const request = {
      parent: `projects/${projectId}/locations/${location}`,
      contents: textsToTranslate,
      mimeType: "text/plain",
      targetLanguageCode: targetLang,
    };

    console.log("Batch translation request:", JSON.stringify(request, null, 2));

    const [response] = await client.translateText(request);

    console.log("Batch translation response received");

    // Process results and save to cache
    const translatedResults = [];
    for (let i = 0; i < response.translations.length; i++) {
      const originalText = textsToTranslate[i];
      const translatedText =
        response.translations[i]?.translatedText || originalText;

      console.log(`Batch result: "${originalText}" -> "${translatedText}"`);

      // Save to cache
      try {
        await TranslationCache.create({
          originalText,
          targetLang,
          translatedText,
          sourceLang: response.translations[i]?.detectedLanguageCode || "en",
          lastUsed: new Date(),
        });
      } catch (cacheSaveError) {
        console.error("Failed to save to cache:", cacheSaveError.message);
      }

      translatedResults.push({
        text: originalText,
        translated: translatedText,
        index: textToIndexMap.get(originalText),
      });
    }

    // Combine cached and new results
    const allResults = [...cacheResults, ...translatedResults];
    const results = new Array(uniqueTexts.length);

    allResults.forEach(({ text, translated, index }) => {
      results[index] = translated;
    });

    console.log(
      `Batch translation completed: ${results.length} texts processed`
    );
    return results;
  } catch (err) {
    console.error("Batch translation error details:");
    console.error("- Message:", err.message);
    console.error("- Code:", err.code);
    console.error("- Status:", err.status);
    console.error("- Details:", err.details);
    console.error("- Full error:", JSON.stringify(err, null, 2));

    // Check for specific error types
    if (err.code === 7) {
      console.error(
        "ERROR: Permission denied. Check if the service account has the 'Cloud Translation API User' role."
      );
    } else if (err.code === 3) {
      console.error(
        "ERROR: Invalid argument. Check if the project ID is correct."
      );
    } else if (err.code === 12) {
      console.error(
        "ERROR: Unimplemented. Check if the Cloud Translation API is enabled for this project."
      );
    } else if (err.message && err.message.includes("billing")) {
      console.error(
        "ERROR: Billing not enabled for this project. Enable billing in Google Cloud Console."
      );
    }

    // Return original texts on error (as array)
    return inputArray;
  }
}

/**
 * Detect the language of a text
 * @param {string} text
 * @returns {Promise<string>} - Detected language code
 */
async function detectLanguage(text) {
  if (!text) return "en";
  try {
    const [response] = await client.detectLanguage({
      parent: `projects/${projectId}/locations/${location}`,
      content: text,
      mimeType: "text/plain",
    });
    return response.languages[0]?.languageCode || "en";
  } catch (err) {
    console.error("Language detection error:", err.message);
    return "en";
  }
}

module.exports = {
  translateText,
  translateBatch,
  detectLanguage,
};
