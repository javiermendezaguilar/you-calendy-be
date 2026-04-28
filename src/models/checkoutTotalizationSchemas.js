const PRODUCT_LINE_SOURCES = ["manual"];

const DISCOUNT_LINE_SOURCES = [
  "promotion",
  "flash_sale",
  "manual",
  "other",
];

const TAX_LINE_SOURCES = ["manual", "vat", "sales_tax", "other"];

const stringField = ({ trim = false } = {}) => ({
  type: String,
  ...(trim ? { trim: true } : {}),
  default: "",
});

const numberField = ({ defaultValue = 0, min } = {}) => ({
  type: Number,
  default: defaultValue,
  ...(min === undefined ? {} : { min }),
});

const enumStringField = (values, defaultValue) => ({
  type: String,
  enum: values,
  default: defaultValue,
});

const createProductLineSnapshotSchema = (Schema) =>
  new Schema(
    {
      name: stringField({ trim: true }),
      quantity: numberField({ defaultValue: 1, min: 1 }),
      unitPrice: numberField({ min: 0 }),
      adjustmentAmount: numberField(),
      lineTotal: numberField({ min: 0 }),
      source: enumStringField(PRODUCT_LINE_SOURCES, "manual"),
      note: stringField({ trim: true }),
    },
    { _id: true }
  );

const createMoneyLineSnapshotSchema = (Schema, sources) =>
  new Schema(
    {
      label: stringField({ trim: true }),
      source: enumStringField(sources, "manual"),
      amount: numberField({ min: 0 }),
      rate: numberField({ min: 0 }),
      note: stringField({ trim: true }),
    },
    { _id: true }
  );

const createCheckoutTotalizationSchema = (Schema) =>
  new Schema(
    {
      serviceSubtotal: {
        type: Number,
        default: 0,
        min: 0,
      },
      productSubtotal: {
        type: Number,
        default: 0,
        min: 0,
      },
      subtotal: {
        type: Number,
        default: 0,
        min: 0,
      },
      discountTotal: {
        type: Number,
        default: 0,
        min: 0,
      },
      taxableSubtotal: {
        type: Number,
        default: 0,
        min: 0,
      },
      taxTotal: {
        type: Number,
        default: 0,
        min: 0,
      },
      tipTotal: {
        type: Number,
        default: 0,
        min: 0,
      },
      totalBeforeDeposit: {
        type: Number,
        default: 0,
        min: 0,
      },
      depositAppliedTotal: {
        type: Number,
        default: 0,
        min: 0,
      },
      amountDue: {
        type: Number,
        default: 0,
        min: 0,
      },
      refundTotal: {
        type: Number,
        default: 0,
        min: 0,
      },
    },
    { _id: false }
  );

const createCheckoutFinancialSnapshotFields = (Schema) => ({
  productLines: [createProductLineSnapshotSchema(Schema)],
  discountLines: [createMoneyLineSnapshotSchema(Schema, DISCOUNT_LINE_SOURCES)],
  taxLines: [createMoneyLineSnapshotSchema(Schema, TAX_LINE_SOURCES)],
  totalization: {
    type: createCheckoutTotalizationSchema(Schema),
    default: () => ({}),
  },
});

module.exports = {
  DISCOUNT_LINE_SOURCES,
  PRODUCT_LINE_SOURCES,
  TAX_LINE_SOURCES,
  createCheckoutFinancialSnapshotFields,
  createCheckoutTotalizationSchema,
  createMoneyLineSnapshotSchema,
  createProductLineSnapshotSchema,
};
