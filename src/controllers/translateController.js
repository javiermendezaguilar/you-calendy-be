const { translateText, translateBatch } = require("../utils/translator");
const SuccessHandler = require("../utils/SuccessHandler");
const ErrorHandler = require("../utils/ErrorHandler");

/**
 * @desc Translate text using Google Cloud Translation API
 * @route POST /api/translate
 * @access Public
 */
const translate = async (req, res) => {
  // #swagger.tags = ['Translate']
  /* #swagger.description = 'Translate text using Google Cloud Translation API'
     #swagger.parameters['obj'] = {
        in: 'body',
        description: 'Translation request',
        required: true,
        schema: {
          text: ['Text to translate as array of strings'],
          targetLang: 'Target language code (e.g., es, fr)'
        }
     }
     #swagger.responses[200] = {
        description: 'Translated texts (array)',
        schema: { translated: ['Texto traducido'] }
     }
     #swagger.responses[400] = {
        description: 'Validation error'
     }
     #swagger.responses[500] = {
        description: 'Translation failed'
     }
  */
  try {
    const { text, targetLang } = req.body;
    if (!text || !targetLang) {
      return ErrorHandler("text and targetLang are required", 400, req, res);
    }

    // Always coerce to array to satisfy API requirement
    const textsArray = Array.isArray(text) ? text : [text];

    // Always return an array of translated texts
    const translated = await translateBatch(textsArray, targetLang);
    return SuccessHandler({ translated }, 200, res);
  } catch (error) {
    console.error("Translation API error:", error.message);
    return ErrorHandler("Translation failed", 500, req, res);
  }
};

/**
 * @desc Translate multiple texts in batch using Google Cloud Translation API
 * @route POST /api/translate/batch
 * @access Public
 */
const translateBatchTexts = async (req, res) => {
  // #swagger.tags = ['Translate']
  /* #swagger.description = 'Translate multiple texts in batch using Google Cloud Translation API'
     #swagger.parameters['obj'] = {
        in: 'body',
        description: 'Batch translation request',
        required: true,
        schema: {
          texts: ['Text 1', 'Text 2', 'Text 3'],
          targetLang: 'Target language code (e.g., es, fr)'
        }
     }
     #swagger.responses[200] = {
        description: 'Array of translated texts',
        schema: { translated: ['Texto 1', 'Texto 2', 'Texto 3'] }
     }
     #swagger.responses[400] = {
        description: 'Validation error'
     }
     #swagger.responses[500] = {
        description: 'Translation failed'
     }
  */
  try {
    const { texts, targetLang } = req.body;
    if (!texts || !Array.isArray(texts) || !targetLang) {
      return ErrorHandler(
        "texts (array) and targetLang are required",
        400,
        req,
        res
      );
    }

    const translated = await translateBatch(texts, targetLang);
    return SuccessHandler({ translated }, 200, res);
  } catch (error) {
    console.error("Batch translation API error:", error.message);
    return ErrorHandler("Batch translation failed", 500, req, res);
  }
};

module.exports = {
  translate,
  translateBatchTexts,
};
