const { hasConsentForChannel } = require("../client/consentService");

const SMS_SKIP_REASONS = Object.freeze({
  MISSING_PHONE: "missing_phone",
  CLIENT_OPTED_OUT: "client_opted_out",
  MISSING_MARKETING_SMS_CONSENT: "missing_marketing_sms_consent",
});

const hasUsablePhone = (client) =>
  typeof client?.phone === "string" && client.phone.trim().length > 0;

const isClientSmsOptedOut = (client) => client?.notificationsEnabled === false;

const getMarketingSmsSkipReason = (client) => {
  if (!hasUsablePhone(client)) {
    return SMS_SKIP_REASONS.MISSING_PHONE;
  }

  if (isClientSmsOptedOut(client)) {
    return SMS_SKIP_REASONS.CLIENT_OPTED_OUT;
  }

  if (!hasConsentForChannel(client, "marketingSms")) {
    return SMS_SKIP_REASONS.MISSING_MARKETING_SMS_CONSENT;
  }

  return null;
};

const canSendMarketingSms = (client) => getMarketingSmsSkipReason(client) === null;

const buildSmsRecipient = (client) => ({
  clientId: client._id,
  phone: client.phone.trim(),
});

const filterMarketingSmsRecipients = (clients = []) => {
  return clients.reduce(
    (acc, client) => {
      const reason = getMarketingSmsSkipReason(client);

      if (reason) {
        acc.skippedRecipients.push({
          client: client._id,
          reason,
        });
        return acc;
      }

      acc.recipients.push(buildSmsRecipient(client));
      return acc;
    },
    {
      recipients: [],
      skippedRecipients: [],
    }
  );
};

module.exports = {
  SMS_SKIP_REASONS,
  canSendMarketingSms,
  filterMarketingSmsRecipients,
  getMarketingSmsSkipReason,
  isClientSmsOptedOut,
};
