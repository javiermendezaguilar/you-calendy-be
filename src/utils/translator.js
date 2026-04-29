// Google Cloud Translation utility
const path = require("path");
const TranslationCache = require("../models/translationCache");
const dotenv = require("dotenv");
const {
  loadServiceAccount,
  describeServiceAccountSource,
} = require("./serviceAccount");
const { getGoogleAccessToken } = require("./googleServiceAccountAuth");

// Load environment variables from config.env
dotenv.config({ path: path.join(__dirname, "../config/config.env") });

const projectId = process.env.GCLOUD_PROJECT_ID;
const location = "global";
const TRANSLATION_API_BASE_URL = "https://translation.googleapis.com/v3";
const TRANSLATION_API_SCOPE =
  "https://www.googleapis.com/auth/cloud-translation";

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

const translationFallbackPaths = [
  path.join(srcDir, "global-approach-469211-g4-d88a01b7357d.json"),
  path.join(projectRoot, "global-approach-469211-g4-d88a01b7357d.json"),
];

const translationServiceAccount = loadServiceAccount({
  jsonEnvVar: "GCLOUD_TRANSLATE_SERVICE_ACCOUNT_JSON",
  base64EnvVar: "GCLOUD_TRANSLATE_SERVICE_ACCOUNT_BASE64",
  filePathEnvVar: "GCLOUD_TRANSLATE_KEYFILE",
  fallbackPaths: translationFallbackPaths,
});

let keyFilename = translationServiceAccount.keyFilename;
if (!keyFilename && process.env.GCLOUD_TRANSLATE_KEYFILE) {
  keyFilename = resolveKeyFilePathFromEnv(process.env.GCLOUD_TRANSLATE_KEYFILE);
}

console.log("Resolved key file path:", keyFilename);
console.log(
  "Translation credential source:",
  describeServiceAccountSource(
    translationServiceAccount.source,
    translationFallbackPaths
  )
);

const hasInlineCredentials = Boolean(translationServiceAccount.credentials);
const hasKeyFile = Boolean(keyFilename && fs.existsSync(keyFilename));
const translationEnabled =
  (hasInlineCredentials || hasKeyFile) && Boolean(projectId);

// If the key file still doesn't exist, disable translation gracefully
if (!hasInlineCredentials && !hasKeyFile) {
  console.error("Google Cloud key file not found at any expected location.");
  console.error("Checked:", process.env.GCLOUD_TRANSLATE_KEYFILE, "=>", keyFilename);
  console.error("Translation will be disabled.");
}

// Check if project ID is available
if (!projectId) {
  console.error(
    "GCLOUD_PROJECT_ID not found in environment variables. Translation will be disabled."
  );
}

let translationAuthOptions = null;
if (translationEnabled) {
  console.log("Initializing Google Cloud Translation REST auth options...");
  translationAuthOptions = {
    ...(hasInlineCredentials
      ? { credentials: translationServiceAccount.credentials }
      : { keyFilename }),
    scopes: [TRANSLATION_API_SCOPE],
  };
  console.log("Google Cloud Translation REST auth options initialized");
}

async function requestTranslationApi(action, payload) {
  const accessToken = await getGoogleAccessToken(translationAuthOptions);
  if (!accessToken) {
    throw new Error("Google Translation access token not available");
  }

  const parent = `projects/${projectId}/locations/${location}`;
  const response = await fetch(
    `${TRANSLATION_API_BASE_URL}/${parent}:${action}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    }
  );

  let result = {};
  try {
    result = await response.json();
  } catch (error) {
    result = {};
  }

  if (!response.ok) {
    const apiError = result.error || {};
    const error = new Error(
      apiError.message ||
        `Google Translation request failed with status ${response.status}`
    );
    error.code = apiError.code || response.status;
    error.status = apiError.status;
    error.details = apiError.details;
    throw error;
  }

  return result;
}

function logTranslationApiError(context, err) {
  console.error(`${context} error details:`);
  console.error("- Message:", err.message);
  console.error("- Code:", err.code);
  console.error("- Status:", err.status);
  console.error("- Details:", err.details);
  console.error("- Full error:", JSON.stringify(err, null, 2));

  if (err.code === 7 || err.code === 403 || err.status === "PERMISSION_DENIED") {
    console.error(
      "ERROR: Permission denied. Check if the service account has the 'Cloud Translation API User' role."
    );
  } else if (err.code === 3 || err.code === 400) {
    console.error(
      "ERROR: Invalid argument. Check if the project ID is correct."
    );
  } else if (err.code === 12 || err.code === 501) {
    console.error(
      "ERROR: Unimplemented. Check if the Cloud Translation API is enabled for this project."
    );
  } else if (err.message && err.message.includes("billing")) {
    console.error(
      "ERROR: Billing not enabled for this project. Enable billing in Google Cloud Console."
    );
  }
}

/**
 * Translate a single text string
 * @param {string} text - The text to translate
 * @param {string} targetLang - The target language code (e.g., 'es', 'fr')
 * @returns {Promise<string>} - The translated text
 */
async function translateText(text, targetLang) {
  if (!translationEnabled || !translationAuthOptions) {
    console.log(`Translation disabled - returning original text: "${text}"`);
    return text;
  }

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
      contents: [text],
      mimeType: "text/plain",
      targetLanguageCode: targetLang,
    };

    console.log("Translation request:", JSON.stringify(request, null, 2));

    const response = await requestTranslationApi("translateText", request);

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
    logTranslationApiError("Translation", err);
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
  if (!translationEnabled || !translationAuthOptions) {
    console.log(`Translation disabled - returning original texts:`, inputArray);
    return inputArray;
  }

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
      contents: textsToTranslate,
      mimeType: "text/plain",
      targetLanguageCode: targetLang,
    };

    console.log("Batch translation request:", JSON.stringify(request, null, 2));

    const response = await requestTranslationApi("translateText", request);

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
    logTranslationApiError("Batch translation", err);
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
  if (!translationEnabled || !translationAuthOptions) return "en";
  if (!text) return "en";
  try {
    const response = await requestTranslationApi("detectLanguage", {
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
