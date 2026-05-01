#!/usr/bin/env node

const mongoose = require("mongoose");
const jwt = require("jsonwebtoken");

const User = require("../src/models/User/user");
const Business = require("../src/models/User/business");
const Client = require("../src/models/client");
const Service = require("../src/models/service");
const Staff = require("../src/models/staff");
const Appointment = require("../src/models/appointment");
const Checkout = require("../src/models/checkout");
const Payment = require("../src/models/payment");
const Refund = require("../src/models/refund");
const CashSession = require("../src/models/cashSession");
const DomainEvent = require("../src/models/domainEvent");
const { PAYMENT_SCOPE } = require("../src/services/payment/paymentScope");

const CONFIRMATION_PHRASE = "staging-fixture";
const SEED_TAG = "fe-core-staging-v1";
const SEED_MARKER = "[FE-CORE-SEED]";
const DEFAULT_STAGING_BASE_URL = "https://you-calendy-be-staging.up.railway.app";

const OWNER_EMAIL = "fe-core-owner@groomnest.dev";
const OWNER_PHONE = "+34910000001";
const CLIENT_EMAIL = "fe-core-client@groomnest.dev";
const CLIENT_PHONE = "+34910000101";
const BUSINESS_NAME = "Groomnest FE Core Seed";

const SEED_COUNTS = {
  users: 1,
  businesses: 1,
  services: 3,
  staff: 2,
  clients: 4,
  appointments: 6,
  checkouts: 2,
  payments: 2,
  refunds: 1,
  cashSessions: 1,
  domainEvents: 6,
};

const parseArgs = (argv = []) => {
  const args = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) continue;

    const [rawKey, inlineValue] = arg.slice(2).split("=", 2);
    const key = rawKey.replace(/-([a-z])/g, (_, char) => char.toUpperCase());

    if (inlineValue !== undefined) {
      args[key] = inlineValue;
      continue;
    }

    const next = argv[index + 1];
    if (next && !next.startsWith("--")) {
      args[key] = next;
      index += 1;
    } else {
      args[key] = true;
    }
  }

  return args;
};

const normalizeEnvironmentValue = (value) =>
  String(value || "")
    .trim()
    .toLowerCase();

const inferDatabaseName = (mongoUri) => {
  const uri = String(mongoUri || "").trim();
  if (!uri) return "";

  try {
    const parsed = new URL(uri);
    return decodeURIComponent(parsed.pathname || "")
      .replace(/^\/+/, "")
      .split("/")[0]
      .split("?")[0];
  } catch (_error) {
    const withoutQuery = uri.split("?")[0];
    const match = withoutQuery.match(/^mongodb(?:\+srv)?:\/\/[^/]+\/([^/?]+)/i);
    return match ? decodeURIComponent(match[1]) : "";
  }
};

const buildSeedTargetContext = (env = process.env, args = {}) => {
  const mongoUri = args.mongoUri || env.MONGO_URI || "";
  const confirm = args.confirm || env.FE_CORE_SEED_CONFIRM || "";
  const dryRun =
    args.dryRun === true ||
    String(args.dryRun || env.FE_CORE_SEED_DRY_RUN || "").toLowerCase() ===
      "true";

  return {
    mongoUri,
    databaseName: inferDatabaseName(mongoUri),
    confirm,
    dryRun,
    nodeEnv: normalizeEnvironmentValue(env.NODE_ENV),
    appEnv: normalizeEnvironmentValue(env.APP_ENV),
    railwayEnvironmentName: normalizeEnvironmentValue(
      env.RAILWAY_ENVIRONMENT_NAME || env.RAILWAY_ENVIRONMENT
    ),
  };
};

const getProductionSignals = (context) => {
  const signals = [];
  const envValues = [
    context.nodeEnv,
    context.appEnv,
    context.railwayEnvironmentName,
  ].filter(Boolean);

  if (envValues.some((value) => ["production", "prod", "live"].includes(value))) {
    signals.push("environment=production");
  }

  const databaseName = normalizeEnvironmentValue(context.databaseName);
  if (
    databaseName === "you-calendy-be" ||
    databaseName === "groomnest" ||
    databaseName.includes("production")
  ) {
    signals.push(`database=${context.databaseName}`);
  }

  return signals;
};

const getSafeTargetSignals = (context) => {
  const signals = [];
  const databaseName = normalizeEnvironmentValue(context.databaseName);

  if (databaseName === "you-calendy-be-staging") {
    signals.push("canonical staging database");
  }

  if (databaseName.includes("staging")) {
    signals.push("database contains staging");
  }

  if (databaseName.includes("test") || databaseName.includes("local")) {
    signals.push("database contains test/local");
  }

  if (["test", "development", "local"].includes(context.nodeEnv)) {
    signals.push(`NODE_ENV=${context.nodeEnv}`);
  }

  if (context.railwayEnvironmentName === "staging") {
    signals.push("Railway staging environment");
  }

  return signals;
};

const assertSeedTargetCanWrite = (context) => {
  const productionSignals = getProductionSignals(context);
  const safeSignals = getSafeTargetSignals(context);

  if (context.dryRun) {
    return {
      allowed: false,
      dryRun: true,
      productionSignals,
      safeSignals,
    };
  }

  if (!context.mongoUri) {
    throw new Error("MONGO_URI is required for FE core staging seed");
  }

  if (!context.databaseName) {
    throw new Error("Could not infer Mongo database name from MONGO_URI");
  }

  if (context.confirm !== CONFIRMATION_PHRASE) {
    throw new Error(
      `Refusing to seed without FE_CORE_SEED_CONFIRM=${CONFIRMATION_PHRASE}`
    );
  }

  if (productionSignals.length > 0) {
    throw new Error(
      `Refusing to seed because production was detected: ${productionSignals.join(
        ", "
      )}`
    );
  }

  if (safeSignals.length === 0) {
    throw new Error(
      "Refusing to seed because target is not explicitly staging, test or local"
    );
  }

  return {
    allowed: true,
    dryRun: false,
    productionSignals,
    safeSignals,
  };
};

const addDays = (date, days) => {
  const next = new Date(date);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
};

const atUtcTime = (date, hours, minutes = 0) => {
  const next = new Date(
    Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate())
  );
  next.setUTCHours(hours, minutes, 0, 0);
  return next;
};

const toDateOnly = (date) => date.toISOString().slice(0, 10);

const buildSeedDates = (referenceDate = new Date()) => {
  const base = new Date(
    Date.UTC(
      referenceDate.getUTCFullYear(),
      referenceDate.getUTCMonth(),
      referenceDate.getUTCDate()
    )
  );

  const smokeDate = addDays(base, 1);
  const completedDate = addDays(base, -1);
  const noShowDate = addDays(base, -7);
  const rebookingDate = addDays(base, 14);

  return {
    smokeDate,
    smokeDateOnly: toDateOnly(smokeDate),
    completedDate,
    noShowDate,
    rebookingDate,
    cashOpenedAt: atUtcTime(completedDate, 8),
    cashClosedAt: atUtcTime(completedDate, 18, 15),
  };
};

const buildSeedPlan = (referenceDate = new Date()) => {
  const dates = buildSeedDates(referenceDate);

  return {
    seedTag: SEED_TAG,
    marker: SEED_MARKER,
    businessName: BUSINESS_NAME,
    ownerEmail: OWNER_EMAIL,
    clientEmail: CLIENT_EMAIL,
    smoke: {
      SMOKE_BASE_URL: DEFAULT_STAGING_BASE_URL,
      SMOKE_DATE: dates.smokeDateOnly,
    },
    counts: { ...SEED_COUNTS },
  };
};

const getPasswordFromEnv = (env = process.env) =>
  String(env.FE_CORE_SEED_PASSWORD || "").trim();

const upsertUser = async (password) => {
  let user = await User.findOne({ email: OWNER_EMAIL });
  const fields = {
    name: "Groomnest FE Core Owner",
    email: OWNER_EMAIL,
    phone: OWNER_PHONE,
    role: "barber",
    status: "activated",
    isActive: true,
    provider: "seed",
    privateNotes: `${SEED_MARKER} ${SEED_TAG}`,
    language: "es",
  };

  if (!user) {
    user = new User(fields);
  } else {
    Object.assign(user, fields);
  }

  if (password) {
    user.password = password;
  }

  await user.save();
  return user;
};

const upsertClient = async ({ business, key, password, ...fields }) => {
  let client = await Client.findOne({ business: business._id, email: fields.email });
  const update = {
    business: business._id,
    registrationStatus: "registered",
    hasAcceptedTerms: true,
    termsAcceptedAt: new Date("2026-01-01T00:00:00.000Z"),
    isActive: true,
    status: "activated",
    privateNotes: `${SEED_MARKER} ${SEED_TAG}:${key}`,
    ...fields,
  };

  if (!client) {
    client = new Client(update);
  } else {
    Object.assign(client, update);
  }

  if (password) {
    client.password = password;
  }

  await client.save();
  return client;
};

const upsertDocument = async (Model, query, update) =>
  Model.findOneAndUpdate(
    query,
    { $set: update },
    {
      new: true,
      runValidators: true,
      setDefaultsOnInsert: true,
      upsert: true,
    }
  );

const businessHours = () => ({
  monday: { enabled: true, shifts: [{ start: "09:00", end: "18:00" }] },
  tuesday: { enabled: true, shifts: [{ start: "09:00", end: "18:00" }] },
  wednesday: { enabled: true, shifts: [{ start: "09:00", end: "18:00" }] },
  thursday: { enabled: true, shifts: [{ start: "09:00", end: "18:00" }] },
  friday: { enabled: true, shifts: [{ start: "09:00", end: "18:00" }] },
  saturday: { enabled: true, shifts: [{ start: "10:00", end: "15:00" }] },
  sunday: { enabled: false, shifts: [] },
});

const staffHours = () => [
  {
    day: "monday",
    enabled: true,
    shifts: [{ start: "09:00", end: "18:00", breaks: [] }],
  },
  {
    day: "tuesday",
    enabled: true,
    shifts: [{ start: "09:00", end: "18:00", breaks: [] }],
  },
  {
    day: "wednesday",
    enabled: true,
    shifts: [{ start: "09:00", end: "18:00", breaks: [] }],
  },
  {
    day: "thursday",
    enabled: true,
    shifts: [{ start: "09:00", end: "18:00", breaks: [] }],
  },
  {
    day: "friday",
    enabled: true,
    shifts: [{ start: "09:00", end: "18:00", breaks: [] }],
  },
  {
    day: "saturday",
    enabled: true,
    shifts: [{ start: "10:00", end: "15:00", breaks: [] }],
  },
  {
    day: "sunday",
    enabled: false,
    shifts: [],
  },
];

const createNoDiscount = () => ({
  applied: false,
  originalPrice: 0,
  discountAmount: 0,
  discountPercentage: 0,
});

const buildServiceLine = ({ service, staff, price, duration }) => ({
  service: {
    id: service._id,
    name: service.name,
  },
  staff: {
    id: staff._id,
    firstName: staff.firstName,
    lastName: staff.lastName,
  },
  quantity: 1,
  unitPrice: price,
  durationMinutes: duration,
  adjustmentAmount: 0,
  lineTotal: price,
  source: "reserved_service_default",
  note: `${SEED_MARKER} ${SEED_TAG}`,
});

const buildCheckoutSnapshot = ({ appointment, client, service, staff }) => ({
  appointmentStatus: appointment.status,
  bookingStatus: appointment.bookingStatus,
  visitStatus: appointment.visitStatus,
  service: {
    id: service._id,
    name: service.name,
  },
  client: {
    id: client._id,
    firstName: client.firstName,
    lastName: client.lastName,
    phone: client.phone,
  },
  staff: {
    id: staff._id,
    firstName: staff.firstName,
    lastName: staff.lastName,
  },
  discounts: {
    promotion: { applied: false, id: null, amount: 0 },
    flashSale: { applied: false, id: null, amount: 0 },
  },
});

const buildTotalization = ({ subtotal, discountTotal = 0, taxTotal = 0, tip = 0 }) => {
  const amountDue = subtotal - discountTotal + taxTotal + tip;

  return {
    serviceSubtotal: subtotal,
    productSubtotal: 0,
    subtotal,
    discountTotal,
    taxableSubtotal: subtotal - discountTotal,
    taxTotal,
    tipTotal: tip,
    totalBeforeDeposit: amountDue,
    depositAppliedTotal: 0,
    amountDue,
    refundTotal: 0,
  };
};

const upsertBusiness = async (owner) =>
  upsertDocument(
    Business,
    { owner: owner._id, name: BUSINESS_NAME },
    {
      owner: owner._id,
      personalName: "Groomnest",
      surname: "Seed",
      name: BUSINESS_NAME,
      contactInfo: {
        email: "hello@groomnest.dev",
        phone: "+34910000000",
        publicUrl: "https://staging.groomnest.com/fe-core-seed",
        description: `${SEED_MARKER} ${SEED_TAG}`,
      },
      address: {
        streetName: "Calle Operativa",
        houseNumber: "1",
        city: "Madrid",
        postalCode: "28001",
      },
      businessHours: businessHours(),
      bookingBuffer: 0,
      penaltySettings: {
        noShowPenalty: true,
        noShowPenaltyAmount: 15,
      },
      timeFormatPreference: "24h",
      isActive: true,
      subscriptionStatus: "active",
      smsCredits: 250,
      emailCredits: 500,
    }
  );

const seedServices = async (business) => {
  const signatureCut = await upsertDocument(
    Service,
    { business: business._id, name: "Signature Cut" },
    {
      business: business._id,
      name: "Signature Cut",
      type: "Barber",
      category: "Cuts",
      description: `${SEED_MARKER} corte principal para smoke FE core`,
      duration: 45,
      price: 35,
      currency: "EUR",
      isActive: true,
      isFromEnabled: false,
    }
  );

  const beardTrim = await upsertDocument(
    Service,
    { business: business._id, name: "Beard Trim" },
    {
      business: business._id,
      name: "Beard Trim",
      type: "Barber",
      category: "Beard",
      description: `${SEED_MARKER} barba para agenda y rebooking`,
      duration: 30,
      price: 20,
      currency: "EUR",
      isActive: true,
      isFromEnabled: false,
    }
  );

  const cutAndBeard = await upsertDocument(
    Service,
    { business: business._id, name: "Cut + Beard" },
    {
      business: business._id,
      name: "Cut + Beard",
      type: "Barber",
      category: "Packages",
      description: `${SEED_MARKER} paquete completo para checkout`,
      duration: 60,
      price: 50,
      currency: "EUR",
      isActive: true,
      isFromEnabled: false,
    }
  );

  business.services = [signatureCut, beardTrim, cutAndBeard].map((service) => ({
    _id: service._id,
    name: service.name,
    type: service.type,
    price: service.price,
    currency: service.currency,
    isFromEnabled: service.isFromEnabled,
  }));
  await business.save();

  return {
    signatureCut,
    beardTrim,
    cutAndBeard,
  };
};

const seedStaff = async (business, services) => {
  const serviceAssignments = [
    { service: services.signatureCut._id, timeInterval: 45 },
    { service: services.beardTrim._id, timeInterval: 30 },
    { service: services.cutAndBeard._id, timeInterval: 60 },
  ];

  const alex = await upsertDocument(
    Staff,
    { business: business._id, email: "alex.fade@groomnest.dev" },
    {
      business: business._id,
      firstName: "Alex",
      lastName: "Fade",
      email: "alex.fade@groomnest.dev",
      phone: "+34910000011",
      role: "Senior barber",
      position: "Lead barber",
      services: serviceAssignments,
      workingHours: staffHours(),
      timeInterval: 15,
      bookingBuffer: 0,
      showInCalendar: true,
      availableForBooking: true,
    }
  );

  const mara = await upsertDocument(
    Staff,
    { business: business._id, email: "mara.blend@groomnest.dev" },
    {
      business: business._id,
      firstName: "Mara",
      lastName: "Blend",
      email: "mara.blend@groomnest.dev",
      phone: "+34910000012",
      role: "Barber",
      position: "Barber",
      services: serviceAssignments,
      workingHours: staffHours(),
      timeInterval: 15,
      bookingBuffer: 0,
      showInCalendar: true,
      availableForBooking: true,
    }
  );

  return { alex, mara };
};

const seedClients = async (business, password) => {
  const primary = await upsertClient({
    business,
    key: "primary",
    password,
    firstName: "Daniel",
    lastName: "Core",
    email: CLIENT_EMAIL,
    phone: CLIENT_PHONE,
    lifecycleStatus: "active",
    firstPaidVisitAt: new Date("2026-01-15T11:00:00.000Z"),
    lastPaidVisitAt: new Date("2026-04-20T11:00:00.000Z"),
    lifecycleUpdatedAt: new Date("2026-04-20T11:00:00.000Z"),
    notes: "Cliente principal para smoke FE core",
    preferences: {
      haircutStyle: "Low fade",
      specialInstructions: "Prefiere terminar con barba perfilada",
    },
    consentFlags: {
      transactionalEmail: {
        granted: true,
        source: "owner_update",
        grantedAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      },
      transactionalSms: {
        granted: true,
        source: "owner_update",
        grantedAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: new Date("2026-01-01T00:00:00.000Z"),
      },
    },
  });

  const walkIn = await upsertClient({
    business,
    key: "walk-in",
    firstName: "Laura",
    lastName: "Walkin",
    email: "fe-core-walkin@groomnest.dev",
    phone: "+34910000102",
    lifecycleStatus: "new",
    notes: "Cliente walk-in para cola operativa",
  });

  const noShow = await upsertClient({
    business,
    key: "no-show",
    firstName: "Mario",
    lastName: "NoShow",
    email: "fe-core-noshow@groomnest.dev",
    phone: "+34910000103",
    lifecycleStatus: "at_risk",
    appBookingBlocked: true,
    lastNoShowDate: new Date("2026-04-01T10:00:00.000Z"),
    blockAppliedDate: new Date("2026-04-01T10:30:00.000Z"),
    notes: "Cliente con no-show para riesgo CRM",
  });

  const rebooking = await upsertClient({
    business,
    key: "rebooking",
    firstName: "Sofia",
    lastName: "Rebook",
    email: "fe-core-rebooking@groomnest.dev",
    phone: "+34910000104",
    lifecycleStatus: "won_back",
    wonBackAt: new Date("2026-04-22T12:00:00.000Z"),
    notes: "Cliente para rebooking desde checkout",
  });

  return {
    primary,
    walkIn,
    noShow,
    rebooking,
  };
};

const appointmentKey = (key) => `${SEED_MARKER} ${SEED_TAG}:${key}`;

const upsertAppointment = async ({
  key,
  business,
  client,
  service,
  staff,
  date,
  startTime,
  endTime,
  duration,
  price,
  status = "Confirmed",
  bookingStatus = "confirmed",
  visitStatus = "not_started",
  visitType = "appointment",
  queueStatus = "none",
  queuePosition = null,
  paymentStatus = "Pending",
  extra = {},
}) =>
  upsertDocument(
    Appointment,
    { business: business._id, notes: appointmentKey(key) },
    {
      client: client._id,
      business: business._id,
      service: service._id,
      staff: staff._id,
      date,
      startTime,
      endTime,
      duration,
      status,
      bookingStatus,
      visitStatus,
      visitType,
      queueStatus,
      queuePosition,
      estimatedWaitMinutes: queueStatus === "waiting" ? 20 : 0,
      queueEnteredAt: queueStatus === "waiting" ? atUtcTime(date, 10, 50) : null,
      queueLeftAt: ["completed", "abandoned", "cancelled"].includes(queueStatus)
        ? atUtcTime(date, 12)
        : null,
      queueOutcomeReason: queueStatus === "abandoned" ? "client_left" : "",
      paymentStatus,
      price,
      notes: appointmentKey(key),
      clientNotes: `${SEED_MARKER} ${key}`,
      policySnapshot: Appointment.buildPolicySnapshot(business),
      promotion: createNoDiscount(),
      flashSale: createNoDiscount(),
      ...extra,
    }
  );

const seedAppointments = async ({ business, services, staff, clients, dates }) => {
  const upcoming = await upsertAppointment({
    key: "upcoming",
    business,
    client: clients.primary,
    service: services.signatureCut,
    staff: staff.alex,
    date: dates.smokeDate,
    startTime: "10:00",
    endTime: "10:45",
    duration: 45,
    price: 35,
  });

  const completed = await upsertAppointment({
    key: "completed-paid",
    business,
    client: clients.primary,
    service: services.cutAndBeard,
    staff: staff.alex,
    date: dates.completedDate,
    startTime: "10:00",
    endTime: "11:00",
    duration: 60,
    price: 50,
    status: "Completed",
    bookingStatus: "confirmed",
    visitStatus: "completed",
    paymentStatus: "Partially Refunded",
  });

  const noShow = await upsertAppointment({
    key: "no-show",
    business,
    client: clients.noShow,
    service: services.signatureCut,
    staff: staff.mara,
    date: dates.noShowDate,
    startTime: "12:00",
    endTime: "12:45",
    duration: 45,
    price: 35,
    status: "No-Show",
    bookingStatus: "confirmed",
    visitStatus: "no_show",
    extra: {
      penalty: {
        applied: true,
        amount: 15,
        paid: false,
        type: "no_show",
        source: "policy_snapshot",
        waived: false,
        assessedAt: atUtcTime(dates.noShowDate, 12, 50),
        assessedBy: staff.mara._id,
        notes: `${SEED_MARKER} no-show seed`,
      },
      policyOutcome: {
        type: "no_show",
        reason: "client_absent",
        note: `${SEED_MARKER} no-show seed`,
        decidedAt: atUtcTime(dates.noShowDate, 12, 50),
        decidedBy: staff.mara._id,
        waived: false,
        feeApplied: true,
        feeAmount: 15,
        blockApplied: true,
        policySource: "business_policy",
        policyVersion: 1,
        scheduledStartAt: atUtcTime(dates.noShowDate, 12),
      },
    },
  });

  const walkInWaiting = await upsertAppointment({
    key: "walk-in-waiting",
    business,
    client: clients.walkIn,
    service: services.beardTrim,
    staff: staff.mara,
    date: dates.smokeDate,
    startTime: "11:30",
    endTime: "12:00",
    duration: 30,
    price: 20,
    status: "Pending",
    bookingStatus: "booked",
    visitStatus: "checked_in",
    visitType: "walk_in",
    queueStatus: "waiting",
    queuePosition: 1,
  });

  const walkInCompleted = await upsertAppointment({
    key: "walk-in-completed",
    business,
    client: clients.walkIn,
    service: services.beardTrim,
    staff: staff.mara,
    date: dates.completedDate,
    startTime: "15:00",
    endTime: "15:30",
    duration: 30,
    price: 20,
    status: "Completed",
    bookingStatus: "confirmed",
    visitStatus: "completed",
    visitType: "walk_in",
    queueStatus: "completed",
    paymentStatus: "Paid",
  });

  const rebooked = await upsertAppointment({
    key: "rebooked",
    business,
    client: clients.rebooking,
    service: services.signatureCut,
    staff: staff.alex,
    date: dates.rebookingDate,
    startTime: "16:00",
    endTime: "16:45",
    duration: 45,
    price: 35,
    status: "Confirmed",
    bookingStatus: "booked",
    visitStatus: "not_started",
  });

  return {
    upcoming,
    completed,
    noShow,
    walkInWaiting,
    walkInCompleted,
    rebooked,
  };
};

const upsertCheckout = async ({
  key,
  appointment,
  business,
  client,
  staff,
  service,
  status,
  subtotal,
  tip,
  total,
  openedAt,
  closedAt,
  closedBy,
  rebooking,
  refundSummary,
}) => {
  const serviceLines = [
    buildServiceLine({
      service,
      staff,
      price: subtotal,
      duration: appointment.duration,
    }),
  ];

  return upsertDocument(
    Checkout,
    { business: business._id, appointment: appointment._id, status },
    {
      appointment: appointment._id,
      business: business._id,
      client: client._id,
      staff: staff._id,
      status,
      currency: "EUR",
      subtotal,
      discountTotal: 0,
      tip,
      total,
      refundSummary: refundSummary || { refundedTotal: 0, status: "none" },
      sourcePrice: subtotal,
      serviceLines,
      productLines: [],
      discountLines: [],
      taxLines: [],
      totalization: buildTotalization({ subtotal, tip }),
      snapshot: buildCheckoutSnapshot({ appointment, client, service, staff }),
      openedAt,
      closedAt,
      closedBy,
      rebooking: rebooking || {
        status: "none",
        appointment: null,
        service: null,
        staff: null,
        createdAt: null,
        createdBy: null,
        source: "checkout",
        note: "",
        offeredAt: null,
        outcomeAt: null,
        outcomeBy: null,
      },
      updatedAt: new Date(),
      seedKey: key,
    }
  );
};

const seedCommerce = async ({ owner, business, services, staff, clients, appointments, dates }) => {
  const completedCheckout = await upsertCheckout({
    key: "completed-paid",
    appointment: appointments.completed,
    business,
    client: clients.primary,
    staff: staff.alex,
    service: services.cutAndBeard,
    status: "paid",
    subtotal: 50,
    tip: 5,
    total: 55,
    openedAt: atUtcTime(dates.completedDate, 10, 50),
    closedAt: atUtcTime(dates.completedDate, 11, 5),
    closedBy: owner._id,
    refundSummary: { refundedTotal: 10, status: "partial" },
    rebooking: {
      status: "booked",
      appointment: appointments.rebooked._id,
      service: services.signatureCut._id,
      staff: staff.alex._id,
      createdAt: atUtcTime(dates.completedDate, 11, 10),
      createdBy: owner._id,
      source: "checkout",
      note: `${SEED_MARKER} rebooking booked`,
      offeredAt: atUtcTime(dates.completedDate, 11, 5),
      outcomeAt: atUtcTime(dates.completedDate, 11, 10),
      outcomeBy: owner._id,
    },
  });

  const walkInCheckout = await upsertCheckout({
    key: "walk-in-completed",
    appointment: appointments.walkInCompleted,
    business,
    client: clients.walkIn,
    staff: staff.mara,
    service: services.beardTrim,
    status: "paid",
    subtotal: 20,
    tip: 0,
    total: 20,
    openedAt: atUtcTime(dates.completedDate, 15, 25),
    closedAt: atUtcTime(dates.completedDate, 15, 35),
    closedBy: owner._id,
  });

  const cashSession = await upsertDocument(
    CashSession,
    { business: business._id, status: "closed", openedAt: dates.cashOpenedAt },
    {
      business: business._id,
      status: "closed",
      currency: "EUR",
      openingFloat: 80,
      openingSource: "manual",
      openingReason: "manual_start",
      openingNote: `${SEED_MARKER} apertura seed`,
      closingExpected: 100,
      closingDeclared: 98,
      summary: {
        cashSalesTotal: 20,
        tipsTotal: 0,
        transactionCount: 1,
        expectedDrawerTotal: 100,
      },
      variance: -2,
      varianceStatus: "short",
      closingNote: `${SEED_MARKER} descuadre controlado para FE`,
      payments: [],
      openedAt: dates.cashOpenedAt,
      openedBy: owner._id,
      closedAt: dates.cashClosedAt,
      closedBy: owner._id,
    }
  );

  const cardPayment = await upsertDocument(
    Payment,
    {
      business: business._id,
      paymentScope: PAYMENT_SCOPE.COMMERCE_CHECKOUT,
      idempotencyKey: `${SEED_TAG}:card-completed-paid`,
    },
    {
      paymentScope: PAYMENT_SCOPE.COMMERCE_CHECKOUT,
      checkout: completedCheckout._id,
      appointment: appointments.completed._id,
      business: business._id,
      client: clients.primary._id,
      staff: staff.alex._id,
      status: "captured",
      method: "card_manual",
      provider: "internal",
      providerReference: `${SEED_TAG}:card-completed-paid`,
      currency: "EUR",
      amount: 55,
      tip: 5,
      reference: `${SEED_MARKER} card manual seed`,
      idempotencyKey: `${SEED_TAG}:card-completed-paid`,
      capturedAt: atUtcTime(dates.completedDate, 11, 6),
      capturedBy: owner._id,
      refundedTotal: 10,
      snapshot: {
        subtotal: 50,
        discountTotal: 0,
        total: 55,
        sourcePrice: 50,
        service: {
          id: services.cutAndBeard._id,
          name: services.cutAndBeard.name,
        },
        serviceLines: completedCheckout.serviceLines,
        productLines: [],
        discountLines: [],
        taxLines: [],
        totalization: buildTotalization({ subtotal: 50, tip: 5 }),
        client: {
          id: clients.primary._id,
          firstName: clients.primary.firstName,
          lastName: clients.primary.lastName,
        },
        discounts: {
          promotionAmount: 0,
          flashSaleAmount: 0,
        },
      },
    }
  );

  const cashPayment = await upsertDocument(
    Payment,
    {
      business: business._id,
      paymentScope: PAYMENT_SCOPE.COMMERCE_CHECKOUT,
      idempotencyKey: `${SEED_TAG}:cash-walkin-completed`,
    },
    {
      paymentScope: PAYMENT_SCOPE.COMMERCE_CHECKOUT,
      checkout: walkInCheckout._id,
      appointment: appointments.walkInCompleted._id,
      business: business._id,
      client: clients.walkIn._id,
      staff: staff.mara._id,
      cashSession: cashSession._id,
      status: "captured",
      method: "cash",
      provider: "internal",
      providerReference: `${SEED_TAG}:cash-walkin-completed`,
      currency: "EUR",
      amount: 20,
      tip: 0,
      reference: `${SEED_MARKER} cash seed`,
      idempotencyKey: `${SEED_TAG}:cash-walkin-completed`,
      capturedAt: atUtcTime(dates.completedDate, 15, 36),
      capturedBy: owner._id,
      refundedTotal: 0,
      snapshot: {
        subtotal: 20,
        discountTotal: 0,
        total: 20,
        sourcePrice: 20,
        service: {
          id: services.beardTrim._id,
          name: services.beardTrim.name,
        },
        serviceLines: walkInCheckout.serviceLines,
        productLines: [],
        discountLines: [],
        taxLines: [],
        totalization: buildTotalization({ subtotal: 20 }),
        client: {
          id: clients.walkIn._id,
          firstName: clients.walkIn.firstName,
          lastName: clients.walkIn.lastName,
        },
        discounts: {
          promotionAmount: 0,
          flashSaleAmount: 0,
        },
      },
    }
  );

  cashSession.payments = [cashPayment._id];
  await cashSession.save();

  const refund = await upsertDocument(
    Refund,
    { payment: cardPayment._id, idempotencyKey: `${SEED_TAG}:partial-refund` },
    {
      payment: cardPayment._id,
      checkout: completedCheckout._id,
      appointment: appointments.completed._id,
      business: business._id,
      client: clients.primary._id,
      staff: staff.alex._id,
      amount: 10,
      currency: "EUR",
      reason: `${SEED_MARKER} partial refund seed`,
      idempotencyKey: `${SEED_TAG}:partial-refund`,
      refundedAt: atUtcTime(dates.completedDate, 11, 30),
      refundedBy: owner._id,
    }
  );

  return {
    completedCheckout,
    walkInCheckout,
    cashSession,
    cardPayment,
    cashPayment,
    refund,
  };
};

const seedDomainEvents = async ({ owner, business, appointments, commerce }) => {
  const events = [
    {
      key: "appointment-booked",
      type: "appointment.booked",
      entityId: appointments.upcoming._id,
    },
    {
      key: "walk-in-created",
      type: "walk_in.created",
      entityId: appointments.walkInWaiting._id,
    },
    {
      key: "checkout-paid",
      type: "checkout.paid",
      entityId: commerce.completedCheckout._id,
    },
    {
      key: "refund-created",
      type: "payment.refund.created",
      entityId: commerce.refund._id,
    },
    {
      key: "cash-session-closed",
      type: "cash_session.closed",
      entityId: commerce.cashSession._id,
    },
    {
      key: "rebooking-booked",
      type: "rebooking.booked",
      entityId: appointments.rebooked._id,
    },
  ];

  const saved = [];
  for (const event of events) {
    saved.push(
      await upsertDocument(
        DomainEvent,
        { eventId: `${SEED_TAG}:${event.key}` },
        {
          eventId: `${SEED_TAG}:${event.key}`,
          idempotencyKey: `${SEED_TAG}:${event.key}`,
          type: event.type,
          occurredAt: new Date("2026-05-01T10:00:00.000Z"),
          recordedAt: new Date("2026-05-01T10:00:00.000Z"),
          actorType: "user",
          actorId: owner._id,
          shopId: business._id,
          source: "seed",
          correlationId: SEED_TAG,
          payload: {
            seedTag: SEED_TAG,
            entityId: event.entityId.toString(),
          },
        }
      )
    );
  }

  return saved;
};

const buildSmokeEnvironment = ({ owner, client, business, services, staff, dates, env }) => {
  const smokeEnvironment = {
    SMOKE_BASE_URL: env.SMOKE_BASE_URL || DEFAULT_STAGING_BASE_URL,
    SMOKE_BUSINESS_ID: business._id.toString(),
    SMOKE_SERVICE_ID: services.signatureCut._id.toString(),
    SMOKE_STAFF_ID: staff.alex._id.toString(),
    SMOKE_DATE: dates.smokeDateOnly,
  };

  if (env.JWT_SECRET) {
    smokeEnvironment.SMOKE_OWNER_TOKEN = jwt.sign(
      { _id: owner._id },
      env.JWT_SECRET,
      { expiresIn: env.JWT_EXPIRE || "7d" }
    );
    smokeEnvironment.SMOKE_CLIENT_TOKEN = jwt.sign(
      {
        _id: client._id,
        type: "client",
        businessId: client.business,
      },
      env.JWT_SECRET,
      { expiresIn: env.JWT_EXPIRE || "7d" }
    );
  }

  return smokeEnvironment;
};

const runSeed = async (options = {}) => {
  const env = options.env || process.env;
  const args = options.args || parseArgs(process.argv.slice(2));
  const context = buildSeedTargetContext(env, args);
  const safety = assertSeedTargetCanWrite(context);
  const plan = buildSeedPlan(options.referenceDate || new Date());

  if (context.dryRun) {
    return {
      success: true,
      dryRun: true,
      target: {
        databaseName: context.databaseName || null,
        safeSignals: safety.safeSignals,
        productionSignals: safety.productionSignals,
      },
      plan,
    };
  }

  mongoose.set("strictQuery", true);
  await mongoose.connect(context.mongoUri, {
    serverSelectionTimeoutMS: 15000,
  });

  try {
    const dates = buildSeedDates(options.referenceDate || new Date());
    const password = getPasswordFromEnv(env);
    const owner = await upsertUser(password);
    const business = await upsertBusiness(owner);
    const services = await seedServices(business);
    const staff = await seedStaff(business, services);
    const clients = await seedClients(business, password);
    const appointments = await seedAppointments({
      business,
      services,
      staff,
      clients,
      dates,
    });
    const commerce = await seedCommerce({
      owner,
      business,
      services,
      staff,
      clients,
      appointments,
      dates,
    });
    const domainEvents = await seedDomainEvents({
      owner,
      business,
      appointments,
      commerce,
    });

    return {
      success: true,
      dryRun: false,
      target: {
        databaseName: context.databaseName,
        safeSignals: safety.safeSignals,
      },
      seed: {
        seedTag: SEED_TAG,
        ownerEmail: OWNER_EMAIL,
        clientEmail: CLIENT_EMAIL,
        businessId: business._id.toString(),
        serviceId: services.signatureCut._id.toString(),
        staffId: staff.alex._id.toString(),
        smokeDate: dates.smokeDateOnly,
        counts: {
          ...SEED_COUNTS,
          domainEvents: domainEvents.length,
        },
      },
      smokeEnvironment: buildSmokeEnvironment({
        owner,
        client: clients.primary,
        business,
        services,
        staff,
        dates,
        env,
      }),
      note:
        "Tokens are printed only for this run. Do not commit or store SMOKE_* tokens.",
    };
  } finally {
    await mongoose.disconnect();
  }
};

const main = async () => {
  const result = await runSeed();
  console.log(JSON.stringify(result, null, 2));
};

if (require.main === module) {
  main().catch((error) => {
    console.error(error.stack || error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  CONFIRMATION_PHRASE,
  DEFAULT_STAGING_BASE_URL,
  SEED_COUNTS,
  SEED_MARKER,
  SEED_TAG,
  assertSeedTargetCanWrite,
  buildSeedDates,
  buildSeedPlan,
  buildSeedTargetContext,
  inferDatabaseName,
  parseArgs,
  runSeed,
};
