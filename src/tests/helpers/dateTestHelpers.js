const futureDateOnly = (daysAhead = 7) => {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + daysAhead);
  date.setUTCHours(0, 0, 0, 0);
  return date.toISOString().slice(0, 10);
};

module.exports = {
  futureDateOnly,
};
