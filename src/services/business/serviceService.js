const {
  buildServiceError,
  ensureObjectIdString,
  findOwnedBusinessOrThrow,
} = require("./coreService");
const Service = require("../../models/service");

const toFiniteNumber = (value, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const normalizeServicePayload = (payload = {}) => ({
  name: payload.name,
  type: payload.type || "",
  description: payload.description || "",
  duration: toFiniteNumber(payload.duration, 0),
  price: toFiniteNumber(payload.price, 0),
  currency: payload.currency || "USD",
  category: payload.category || "General",
  isFromEnabled: payload.isFromEnabled === true,
  isActive: payload.isActive !== undefined ? payload.isActive : true,
});

const toLegacyBusinessService = (serviceDoc) => ({
  _id: serviceDoc._id,
  name: serviceDoc.name,
  type: serviceDoc.type || "",
  price: serviceDoc.price,
  currency: serviceDoc.currency || "USD",
  category: serviceDoc.category || "General",
  isFromEnabled: serviceDoc.isFromEnabled === true,
  isActive: serviceDoc.isActive !== false,
});

const syncBusinessServicesShadow = async (businessId) => {
  const business = await findOwnedBusinessOrThrowById(businessId);
  const services = await Service.find({ business: business._id }).sort({
    createdAt: 1,
  });
  business.services = services.map(toLegacyBusinessService);
  business.markModified("services");
  await business.save();
  return services;
};

const findOwnedBusinessOrThrowById = async (businessId) => {
  const business = await require("../../models/User/business").findById(
    businessId
  );

  if (!business) {
    throw buildServiceError("Business not found", 404);
  }

  return business;
};

const bootstrapServicesFromBusinessShadow = async (business) => {
  const existingCount = await Service.countDocuments({ business: business._id });
  if (existingCount > 0) {
    return Service.find({ business: business._id }).sort({ createdAt: 1 });
  }

  if (!business.services || business.services.length === 0) {
    return [];
  }

  const bootstrapDocs = business.services.map((service) => ({
    _id: service._id,
    business: business._id,
    name: service.name,
    type: service.type || "",
    description: service.description || "",
    duration: toFiniteNumber(service.duration, 0),
    price: toFiniteNumber(service.price, 0),
    currency: service.currency || "USD",
    category: service.category || "General",
    isFromEnabled: service.isFromEnabled === true,
    isActive: service.isActive !== false,
  }));

  if (bootstrapDocs.length > 0) {
    await Service.insertMany(bootstrapDocs, { ordered: true });
  }

  return Service.find({ business: business._id }).sort({ createdAt: 1 });
};

const getCanonicalBusinessServices = async (business) => {
  let services = await Service.find({ business: business._id }).sort({
    createdAt: 1,
  });

  if (services.length === 0) {
    services = await bootstrapServicesFromBusinessShadow(business);
  }

  return services;
};

const resolveCanonicalServiceForBusiness = async (business, serviceId) => {
  const validServiceId = ensureObjectIdString(
    String(serviceId || ""),
    "Service ID is required"
  );
  const services = await getCanonicalBusinessServices(business);

  return (
    services.find(
      (service) => service._id.toString() === validServiceId.toString()
    ) || null
  );
};

const getBusinessServicesForOwner = async (userId) => {
  const business = await findOwnedBusinessOrThrow(userId);
  return getCanonicalBusinessServices(business);
};

const addBusinessServiceForOwner = async (userId, payload) => {
  const normalized = normalizeServicePayload(payload);
  const { name } = normalized;

  if (!name) {
    throw buildServiceError("Service name is required", 400);
  }

  const business = await findOwnedBusinessOrThrow(userId);
  const createdService = await Service.create({
    business: business._id,
    ...normalized,
  });

  await syncBusinessServicesShadow(business._id);
  return createdService;
};

const updateBusinessServiceForOwner = async (userId, serviceId, payload) => {
  const validServiceId = ensureObjectIdString(
    serviceId,
    "Service ID is required"
  );

  const business = await findOwnedBusinessOrThrow(userId);
  const service = await Service.findOne({
    _id: validServiceId,
    business: business._id,
  });

  if (!service) {
    throw buildServiceError("Service not found", 404);
  }

  const normalized = normalizeServicePayload({
    ...service.toObject(),
    ...payload,
  });

  Object.assign(service, normalized);
  const updatedService = await service.save();
  await syncBusinessServicesShadow(business._id);
  return updatedService;
};

const deleteBusinessServiceForOwner = async (userId, serviceId) => {
  const validServiceId = ensureObjectIdString(
    serviceId,
    "Service ID is required"
  );
  const business = await findOwnedBusinessOrThrow(userId);
  const deleted = await Service.findOneAndDelete({
    _id: validServiceId,
    business: business._id,
  });

  if (!deleted) {
    throw buildServiceError("Service not found", 404);
  }

  await syncBusinessServicesShadow(business._id);
  return { message: "Service deleted" };
};

module.exports = {
  getCanonicalBusinessServices,
  resolveCanonicalServiceForBusiness,
  syncBusinessServicesShadow,
  getBusinessServicesForOwner,
  addBusinessServiceForOwner,
  updateBusinessServiceForOwner,
  deleteBusinessServiceForOwner,
};
