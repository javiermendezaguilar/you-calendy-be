const {
  buildServiceError,
  ensureObjectIdString,
  findOwnedBusinessOrThrow,
} = require("./coreService");

const getBusinessServicesForOwner = async (userId) => {
  const business = await findOwnedBusinessOrThrow(userId);
  return business.services;
};

const addBusinessServiceForOwner = async (userId, payload) => {
  const { name, type, price, currency, category, isFromEnabled } = payload;

  if (!name) {
    throw buildServiceError("Service name is required", 400);
  }

  const business = await findOwnedBusinessOrThrow(userId);

  const newService = {
    name,
    type: type || "",
    price: parseFloat(price) || 0,
    currency: currency || "USD",
    category: category || "General",
    isFromEnabled: isFromEnabled || false,
  };

  business.services.push(newService);
  const updatedBusiness = await business.save();

  return updatedBusiness.services[updatedBusiness.services.length - 1];
};

const updateBusinessServiceForOwner = async (userId, serviceId, payload) => {
  const validServiceId = ensureObjectIdString(
    serviceId,
    "Service ID is required"
  );
  const { name, type, price, currency, category, isFromEnabled, isActive } =
    payload;

  const business = await findOwnedBusinessOrThrow(userId);

  const serviceIndex = business.services.findIndex(
    (service) => service._id.toString() === validServiceId
  );

  if (serviceIndex === -1) {
    throw buildServiceError("Service not found", 404);
  }

  const currentService = business.services[serviceIndex];
  const updatedServiceData = {
    name: name || currentService.name,
    type: type !== undefined ? type : currentService.type,
    price: price !== undefined ? parseFloat(price) : currentService.price,
    currency: currency !== undefined ? currency : currentService.currency,
    category: category !== undefined ? category : currentService.category,
    isFromEnabled:
      isFromEnabled !== undefined
        ? isFromEnabled
        : currentService.isFromEnabled,
    isActive: isActive !== undefined ? isActive : currentService.isActive,
    _id: currentService._id,
  };

  business.services[serviceIndex] = updatedServiceData;
  business.markModified("services");

  const updatedBusiness = await business.save();
  return updatedBusiness.services[serviceIndex].toObject();
};

const deleteBusinessServiceForOwner = async (userId, serviceId) => {
  const validServiceId = ensureObjectIdString(
    serviceId,
    "Service ID is required"
  );
  const business = await findOwnedBusinessOrThrow(userId);

  business.services = business.services.filter(
    (service) => service._id.toString() !== validServiceId
  );

  await business.save();
  return { message: "Service deleted" };
};

module.exports = {
  getBusinessServicesForOwner,
  addBusinessServiceForOwner,
  updateBusinessServiceForOwner,
  deleteBusinessServiceForOwner,
};
