const MAX_PRODUCT_LINES = 50;
const MAX_MONEY_LINES = 50;
const MAX_QUANTITY = 999;
const MAX_LABEL_LENGTH = 120;
const MAX_NOTE_LENGTH = 500;
const MAX_TAX_RATE = 100;

const PRODUCT_LINE_SOURCE = Object.freeze({
  MANUAL: "manual",
});

const DISCOUNT_LINE_SOURCE = Object.freeze({
  PROMOTION: "promotion",
  FLASH_SALE: "flash_sale",
  MANUAL: "manual",
  OTHER: "other",
});

const TAX_LINE_SOURCE = Object.freeze({
  MANUAL: "manual",
  VAT: "vat",
  SALES_TAX: "sales_tax",
  OTHER: "other",
});

const PRODUCT_LINE_SOURCES = new Set(Object.values(PRODUCT_LINE_SOURCE));
const DISCOUNT_LINE_SOURCES = new Set(Object.values(DISCOUNT_LINE_SOURCE));
const TAX_LINE_SOURCES = new Set(Object.values(TAX_LINE_SOURCE));

const createTotalizationError = (message, statusCode = 400) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const roundMoney = (value) =>
  Math.round((Number(value) + Number.EPSILON) * 100) / 100;

const normalizeNumber = (value, fieldName, { allowNegative = false } = {}) => {
  const number = value === undefined || value === null || value === ""
    ? 0
    : Number(value);

  if (!Number.isFinite(number) || (!allowNegative && number < 0)) {
    throw createTotalizationError(
      `${fieldName} must be a ${allowNegative ? "" : "non-negative "}number`
    );
  }

  return number;
};

const normalizeMoney = (value, fieldName, options = {}) =>
  roundMoney(normalizeNumber(value, fieldName, options));

const normalizeQuantity = (value) => {
  const quantity = value === undefined || value === null || value === ""
    ? 1
    : Number(value);

  if (
    !Number.isInteger(quantity) ||
    quantity < 1 ||
    quantity > MAX_QUANTITY
  ) {
    throw createTotalizationError(
      `quantity must be an integer from 1 to ${MAX_QUANTITY}`
    );
  }

  return quantity;
};

const normalizeText = (value, fieldName, maxLength) => {
  const text = String(value || "").trim();
  if (text.length > maxLength) {
    throw createTotalizationError(
      `${fieldName} must be ${maxLength} characters or fewer`
    );
  }

  return text;
};

const normalizeSource = (value, allowedSources, fallback, fieldName) => {
  const source = String(value || fallback).trim();
  if (!allowedSources.has(source)) {
    throw createTotalizationError(`Invalid ${fieldName}`);
  }

  return source;
};

const ensureArray = (value, fieldName, maxItems) => {
  const lines = value === undefined || value === null ? [] : value;
  if (!Array.isArray(lines)) {
    throw createTotalizationError(`${fieldName} must be an array`);
  }

  if (lines.length > maxItems) {
    throw createTotalizationError(
      `${fieldName} must include ${maxItems} lines or fewer`
    );
  }

  return lines;
};

const normalizeProductLines = (value = []) =>
  ensureArray(value, "productLines", MAX_PRODUCT_LINES).map((line) => {
    if (!line || typeof line !== "object" || Array.isArray(line)) {
      throw createTotalizationError("Each product line must be an object");
    }

    const quantity = normalizeQuantity(line.quantity);
    const unitPrice = normalizeMoney(line.unitPrice, "unitPrice");
    const adjustmentAmount = normalizeMoney(
      line.adjustmentAmount,
      "adjustmentAmount",
      { allowNegative: true }
    );
    const lineTotal = roundMoney(quantity * unitPrice + adjustmentAmount);

    if (lineTotal < 0) {
      throw createTotalizationError("Product line total cannot be negative");
    }

    const name = normalizeText(line.name, "product line name", MAX_LABEL_LENGTH);
    if (!name) {
      throw createTotalizationError("Product line name is required");
    }

    return {
      name,
      quantity,
      unitPrice,
      adjustmentAmount,
      lineTotal,
      source: normalizeSource(
        line.source,
        PRODUCT_LINE_SOURCES,
        PRODUCT_LINE_SOURCE.MANUAL,
        "product line source"
      ),
      note: normalizeText(line.note, "product line note", MAX_NOTE_LENGTH),
    };
  });

const normalizeMoneyLines = ({
  value = [],
  fieldName,
  allowedSources,
  fallbackSource,
  defaultLabel,
}) =>
  ensureArray(value, fieldName, MAX_MONEY_LINES).map((line) => {
    if (!line || typeof line !== "object" || Array.isArray(line)) {
      throw createTotalizationError(`Each ${fieldName} entry must be an object`);
    }

    const source = normalizeSource(
      line.source,
      allowedSources,
      fallbackSource,
      `${fieldName} source`
    );
    const label =
      normalizeText(line.label, `${fieldName} label`, MAX_LABEL_LENGTH) ||
      defaultLabel;
    const amount = normalizeMoney(line.amount, `${fieldName} amount`);
    const rate = normalizeNumber(line.rate, `${fieldName} rate`);

    if (rate > MAX_TAX_RATE) {
      throw createTotalizationError(
        `${fieldName} rate must be ${MAX_TAX_RATE} or lower`
      );
    }

    return {
      label,
      source,
      amount,
      rate: roundMoney(rate),
      note: normalizeText(line.note, `${fieldName} note`, MAX_NOTE_LENGTH),
    };
  });

const normalizeDiscountLines = (value = []) =>
  normalizeMoneyLines({
    value,
    fieldName: "discountLines",
    allowedSources: DISCOUNT_LINE_SOURCES,
    fallbackSource: DISCOUNT_LINE_SOURCE.MANUAL,
    defaultLabel: "Discount",
  });

const normalizeTaxLines = (value = [], taxableSubtotal = 0) =>
  ensureArray(value, "taxLines", MAX_MONEY_LINES).map((line) => {
    if (!line || typeof line !== "object" || Array.isArray(line)) {
      throw createTotalizationError("Each taxLines entry must be an object");
    }

    const rate = normalizeNumber(line.rate, "taxLines rate");
    if (rate > MAX_TAX_RATE) {
      throw createTotalizationError(
        `taxLines rate must be ${MAX_TAX_RATE} or lower`
      );
    }

    const amount = line.amount === undefined || line.amount === null || line.amount === ""
      ? roundMoney((taxableSubtotal * rate) / 100)
      : normalizeMoney(line.amount, "taxLines amount");

    return {
      label:
        normalizeText(line.label, "taxLines label", MAX_LABEL_LENGTH) || "Tax",
      source: normalizeSource(
        line.source,
        TAX_LINE_SOURCES,
        TAX_LINE_SOURCE.MANUAL,
        "taxLines source"
      ),
      amount,
      rate: roundMoney(rate),
      note: normalizeText(line.note, "taxLines note", MAX_NOTE_LENGTH),
    };
  });

const sumAmounts = (lines = [], fieldName = "amount") =>
  roundMoney(
    lines.reduce((sum, line) => sum + (Number(line[fieldName]) || 0), 0)
  );

const sumServiceLines = (serviceLines = []) =>
  sumAmounts(serviceLines, "lineTotal");

const buildAppointmentDiscountLines = (appointment) => {
  const lines = [];
  const promotionAmount = normalizeMoney(
    appointment?.promotion?.discountAmount,
    "promotion discount amount"
  );
  const flashSaleAmount = normalizeMoney(
    appointment?.flashSale?.discountAmount,
    "flash sale discount amount"
  );

  if (appointment?.promotion?.applied === true && promotionAmount > 0) {
    lines.push({
      label: "Promotion",
      source: DISCOUNT_LINE_SOURCE.PROMOTION,
      amount: promotionAmount,
      rate: Number(appointment?.promotion?.discountPercentage) || 0,
      note: "",
    });
  }

  if (appointment?.flashSale?.applied === true && flashSaleAmount > 0) {
    lines.push({
      label: "Flash sale",
      source: DISCOUNT_LINE_SOURCE.FLASH_SALE,
      amount: flashSaleAmount,
      rate: Number(appointment?.flashSale?.discountPercentage) || 0,
      note: "",
    });
  }

  return normalizeDiscountLines(lines);
};

const buildTotalizationFromNormalizedLines = ({
  serviceLines = [],
  productLines = [],
  discountLines = [],
  taxLines = [],
  tip = 0,
  depositAppliedTotal = 0,
  refundTotal = 0,
}) => {
  const serviceSubtotal = sumServiceLines(serviceLines);
  const productSubtotal = sumAmounts(productLines, "lineTotal");
  const subtotal = roundMoney(serviceSubtotal + productSubtotal);
  const discountTotal = sumAmounts(discountLines, "amount");

  if (discountTotal > subtotal) {
    throw createTotalizationError(
      "Discount total cannot exceed service and product subtotal"
    );
  }

  const taxableSubtotal = roundMoney(subtotal - discountTotal);
  const taxTotal = sumAmounts(taxLines, "amount");
  const tipTotal = normalizeMoney(tip, "tip");
  const normalizedDepositAppliedTotal = normalizeMoney(
    depositAppliedTotal,
    "depositAppliedTotal"
  );
  const totalBeforeDeposit = roundMoney(taxableSubtotal + taxTotal + tipTotal);

  if (normalizedDepositAppliedTotal > totalBeforeDeposit) {
    throw createTotalizationError(
      "Deposit applied total cannot exceed checkout total"
    );
  }

  return {
    serviceSubtotal,
    productSubtotal,
    subtotal,
    discountTotal,
    taxableSubtotal,
    taxTotal,
    tipTotal,
    totalBeforeDeposit,
    depositAppliedTotal: normalizedDepositAppliedTotal,
    amountDue: roundMoney(totalBeforeDeposit - normalizedDepositAppliedTotal),
    refundTotal: normalizeMoney(refundTotal, "refundTotal"),
  };
};

const buildCheckoutTotalization = ({
  serviceLines = [],
  productLines = [],
  discountLines = [],
  taxLines = [],
  tip = 0,
  depositAppliedTotal = 0,
  refundTotal = 0,
}) => {
  const normalizedProductLines = normalizeProductLines(productLines);
  const normalizedDiscountLines = normalizeDiscountLines(discountLines);
  const serviceSubtotal = sumServiceLines(serviceLines);
  const productSubtotal = sumAmounts(normalizedProductLines, "lineTotal");
  const subtotal = roundMoney(serviceSubtotal + productSubtotal);
  const discountTotal = sumAmounts(normalizedDiscountLines, "amount");

  if (discountTotal > subtotal) {
    throw createTotalizationError(
      "Discount total cannot exceed service and product subtotal"
    );
  }

  const normalizedTaxLines = normalizeTaxLines(
    taxLines,
    roundMoney(subtotal - discountTotal)
  );
  const totalization = buildTotalizationFromNormalizedLines({
    serviceLines,
    productLines: normalizedProductLines,
    discountLines: normalizedDiscountLines,
    taxLines: normalizedTaxLines,
    tip,
    depositAppliedTotal,
    refundTotal,
  });

  return {
    productLines: normalizedProductLines,
    discountLines: normalizedDiscountLines,
    taxLines: normalizedTaxLines,
    totalization,
  };
};

const applyTotalizationToCheckout = (checkout, overrides = {}) => {
  const result = buildCheckoutTotalization({
    serviceLines: overrides.serviceLines || checkout.serviceLines || [],
    productLines:
      overrides.productLines === undefined
        ? checkout.productLines || []
        : overrides.productLines,
    discountLines:
      overrides.discountLines === undefined
        ? checkout.discountLines || []
        : overrides.discountLines,
    taxLines:
      overrides.taxLines === undefined ? checkout.taxLines || [] : overrides.taxLines,
    tip: overrides.tip === undefined ? checkout.tip || 0 : overrides.tip,
    depositAppliedTotal:
      overrides.depositAppliedTotal === undefined
        ? checkout.totalization?.depositAppliedTotal || 0
        : overrides.depositAppliedTotal,
    refundTotal: checkout.refundSummary?.refundedTotal || 0,
  });

  checkout.serviceLines = overrides.serviceLines || checkout.serviceLines || [];
  checkout.productLines = result.productLines;
  checkout.discountLines = result.discountLines;
  checkout.taxLines = result.taxLines;
  checkout.totalization = result.totalization;
  checkout.subtotal = result.totalization.subtotal;
  checkout.discountTotal = result.totalization.discountTotal;
  checkout.tip = result.totalization.tipTotal;
  checkout.total = result.totalization.amountDue;

  return checkout;
};

module.exports = {
  DISCOUNT_LINE_SOURCE,
  PRODUCT_LINE_SOURCE,
  TAX_LINE_SOURCE,
  applyTotalizationToCheckout,
  buildAppointmentDiscountLines,
  buildCheckoutTotalization,
  createTotalizationError,
  normalizeDiscountLines,
  normalizeProductLines,
  normalizeTaxLines,
  roundMoney,
};
