const { hasConsentForChannel } = require("../client/consentService");

const EMAIL_SKIP_REASONS = Object.freeze({
  MISSING_EMAIL: "missing_email",
  CLIENT_OPTED_OUT: "client_opted_out",
  MISSING_MARKETING_EMAIL_CONSENT: "missing_marketing_email_consent",
});

const hasUsableEmail = (client) =>
  typeof client?.email === "string" &&
  client.email.trim().length > 0 &&
  client.email.includes("@");

const isClientEmailOptedOut = (client) =>
  client?.notificationsEnabled === false;

const getMarketingEmailSkipReason = (client) => {
  if (!hasUsableEmail(client)) {
    return EMAIL_SKIP_REASONS.MISSING_EMAIL;
  }

  if (isClientEmailOptedOut(client)) {
    return EMAIL_SKIP_REASONS.CLIENT_OPTED_OUT;
  }

  if (!hasConsentForChannel(client, "marketingEmail")) {
    return EMAIL_SKIP_REASONS.MISSING_MARKETING_EMAIL_CONSENT;
  }

  return null;
};

const canSendMarketingEmail = (client) =>
  getMarketingEmailSkipReason(client) === null;

const buildEmailRecipient = (client) => ({
  clientId: client._id,
  email: client.email.trim(),
});

const filterMarketingEmailRecipients = (clients = []) => {
  return clients.reduce(
    (acc, client) => {
      const reason = getMarketingEmailSkipReason(client);

      if (reason) {
        acc.skippedRecipients.push({
          client: client._id,
          reason,
        });
        return acc;
      }

      acc.recipients.push(buildEmailRecipient(client));
      return acc;
    },
    {
      recipients: [],
      skippedRecipients: [],
    }
  );
};

module.exports = {
  EMAIL_SKIP_REASONS,
  canSendMarketingEmail,
  filterMarketingEmailRecipients,
  getMarketingEmailSkipReason,
  isClientEmailOptedOut,
};
