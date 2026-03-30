// const dotenv = require("dotenv");
// // Commenting out sendGrid to avoid API key issues
// // const sendGrid = require("@sendgrid/mail");
// dotenv.config({ path: "./config/config.env" });
// // Commenting out sendGrid setup
// // sendGrid.setApiKey(process.env.SENDGRID_API_KEY);

// const sendMail = async (email, subject, text) => {
//   try {
//     console.log(`Email would be sent to: ${email}, Subject: ${subject}`);
//     // Comment out the actual sending to avoid errors
//     /*
//     const msg = {
//       from: "developer@dotclickllc.com",
//       to: email,
//       subject: subject,
//       html: text,
//     };

//     await sendGrid.send(msg);
//     */
//   } catch (error) {
//     console.log("Error in sendMail", error.message || "SendGrid disabled");
//   }
// };

// module.exports = sendMail;

const nodemailer = require("nodemailer");
const dotenv = require("dotenv");
const Transport = require("nodemailer-brevo-transport");
const ApiKey = require("../models/apiKey");

dotenv.config({ path: "./src/config/config.env" });
const { createTransport } = nodemailer;

const sendMail = async (email, subject, text) => {
  try {
    // Get Nodemailer API key from database with fallback to environment variable
    let apiKey = null;

    try {
      const apiKeyDoc = await ApiKey.getActiveConfig();
      if (apiKeyDoc && apiKeyDoc.nodemailerApiKey) {
        apiKey = apiKeyDoc.nodemailerApiKey;
        // Update usage statistics
        await apiKeyDoc.updateUsage();
      }
    } catch (error) {
      console.warn(
        "Failed to fetch Nodemailer API key from database:",
        error.message
      );
    }

    // Fallback to environment variable if not found in database
    if (!apiKey) {
      apiKey = process.env.NODEMAILER_API_KEY;
    }

    if (!apiKey) {
      console.error(
        "NODEMAILER_API_KEY not configured in database or environment"
      );
      throw new Error("Email service not configured");
    }

    const transport = createTransport(new Transport({ apiKey: apiKey }));
    const data = await transport.sendMail({
      // from: '"Dotclick" developerdev180@gmail.com',
      // from: '"youcalendly" javiermendezaguilar474@gmail.com',
      from: '"youcalendly" no-reply@groomnest.com',
      to: email,
      subject,
      html: text,
    });
    console.log("Email sent successfully:", data);
    console.log("Email sent successfully!");
  } catch (error) {
    console.error("Failed to send email:", error.message);
    throw error; // Re-throw to allow calling code to handle the error
  }
};

module.exports = sendMail;
