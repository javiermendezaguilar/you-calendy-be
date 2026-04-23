const summarizeCashPayments = (payments = []) => {
  const summarizedPayments = payments
    .map((payment) => {
      const amount = Number(payment.amount) || 0;
      const refundedTotal = Number(payment.refundedTotal) || 0;
      const netAmount = Math.max(amount - refundedTotal, 0);

      return {
        payment,
        netAmount,
      };
    })
    .filter(({ netAmount }) => netAmount > 0);

  const cashSalesTotal = summarizedPayments.reduce(
    (sum, { netAmount }) => sum + netAmount,
    0
  );
  const tipsTotal = payments.reduce(
    (sum, payment) => sum + (Number(payment.tip) || 0),
    0
  );

  return {
    summarizedPayments,
    cashSalesTotal,
    tipsTotal,
    transactionCount: summarizedPayments.length,
  };
};

const buildCashSessionSnapshot = (cashSession, payments = []) => {
  const {
    summarizedPayments,
    cashSalesTotal,
    tipsTotal,
    transactionCount,
  } = summarizeCashPayments(payments);
  const expectedDrawerTotal =
    (Number(cashSession.openingFloat) || 0) + cashSalesTotal;
  const closingDeclared = Number(cashSession.closingDeclared) || 0;

  return {
    paymentIds: summarizedPayments.map(({ payment }) => payment._id),
    payments: summarizedPayments.map(({ payment }) => payment),
    summary: {
      cashSalesTotal,
      tipsTotal,
      transactionCount,
      expectedDrawerTotal,
    },
    closingExpected: expectedDrawerTotal,
    variance: closingDeclared - expectedDrawerTotal,
    closing: {
      ready: transactionCount > 0,
      transactionCount,
      cashSalesTotal,
      expectedDrawerTotal,
    },
  };
};

module.exports = {
  summarizeCashPayments,
  buildCashSessionSnapshot,
};
