/**
 * Client notification utility
 * Sends notifications to clients about appointments
 * Currently a stub - notifications disabled
 */

const clientNotification = async (clientId, notificationData) => {
  // Notifications disabled - stub function
  console.log('Client notification disabled:', { clientId, type: notificationData?.type });
  return null;
};

module.exports = clientNotification;
