const mongoose = require("mongoose");
const Business = require("../../models/User/business");

const VALID_TIME_FORMATS = ["12h", "24h"];

const buildServiceError = (message, statusCode) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const ensureObjectIdString = (value, message) => {
  if (typeof value !== "string" || !mongoose.Types.ObjectId.isValid(value)) {
    throw buildServiceError(message, 400);
  }

  return value;
};

const findOwnedBusinessOrThrow = async (userId) => {
  const business = await Business.findOne({ owner: userId });

  if (!business) {
    throw buildServiceError("Business not found", 404);
  }

  return business;
};

const getUserBusinessForOwner = async (userId) => {
  return findOwnedBusinessOrThrow(userId);
};

const getBusinessByIdPublic = async (businessId) => {
  const validBusinessId = ensureObjectIdString(
    businessId,
    "Business ID is required"
  );

  const business = await Business.findById(validBusinessId).populate(
    "owner",
    "name email"
  );

  if (!business) {
    throw buildServiceError("Business not found", 404);
  }

  return business;
};

const updateBusinessInfoForOwner = async (userId, payload) => {
  const {
    name,
    email,
    phone,
    facebook,
    instagram,
    twitter,
    website,
    onlineShop,
    publicUrl,
    description,
    personalName,
    surname,
    googlePlaceId,
    googleReviewUrl,
  } = payload;

  const business = await findOwnedBusinessOrThrow(userId);

  if (personalName !== undefined) business.personalName = personalName;
  if (surname !== undefined) business.surname = surname;
  business.name = name || business.name;
  business.contactInfo.email = email || business.contactInfo.email;
  business.contactInfo.phone = phone || business.contactInfo.phone;
  business.contactInfo.publicUrl = publicUrl || business.contactInfo.publicUrl;
  business.contactInfo.description =
    description || business.contactInfo.description;
  business.socialMedia.website = website || business.socialMedia.website;
  business.socialMedia.onlineShop =
    onlineShop || business.socialMedia.onlineShop;
  business.socialMedia.facebook = facebook || business.socialMedia.facebook;
  business.socialMedia.instagram =
    instagram || business.socialMedia.instagram;
  business.socialMedia.twitter = twitter || business.socialMedia.twitter;
  business.socialMedia.website = website || business.socialMedia.website;
  business.socialMedia.onlineShop =
    onlineShop || business.socialMedia.onlineShop;

  if (googlePlaceId !== undefined) business.googlePlaceId = googlePlaceId;
  if (googleReviewUrl !== undefined) business.googleReviewUrl = googleReviewUrl;

  return business.save();
};

const updateBusinessAddressForOwner = async (userId, payload) => {
  const { streetName, houseNumber, city, postalCode } = payload;
  const business = await findOwnedBusinessOrThrow(userId);

  business.address.streetName = streetName || business.address.streetName;
  business.address.houseNumber = houseNumber || business.address.houseNumber;
  business.address.city = city || business.address.city;
  business.address.postalCode = postalCode || business.address.postalCode;

  return business.save();
};

const updateBusinessLocationForOwner = async (userId, payload) => {
  const { longitude, latitude, address, googlePlaceId } = payload;

  if (!longitude || !latitude) {
    throw buildServiceError("Longitude and latitude are required", 400);
  }

  const business = await findOwnedBusinessOrThrow(userId);

  business.location.coordinates = [
    parseFloat(longitude),
    parseFloat(latitude),
  ];
  business.location.address = address || business.location.address;

  if (googlePlaceId !== undefined) {
    business.googlePlaceId = googlePlaceId;
  }

  return business.save();
};

const updateBusinessHoursForOwner = async (userId, payload) => {
  const { businessHours, timeFormatPreference } = payload;

  if (!businessHours) {
    throw buildServiceError("Business hours data is required", 400);
  }

  const business = await findOwnedBusinessOrThrow(userId);

  for (const day in businessHours) {
    if (business.businessHours[day]) {
      business.businessHours[day] = businessHours[day];
    }
  }

  if (timeFormatPreference) {
    if (!VALID_TIME_FORMATS.includes(timeFormatPreference)) {
      throw buildServiceError("Invalid time format preference", 400);
    }
    business.timeFormatPreference = timeFormatPreference;
  }

  return business.save();
};

module.exports = {
  getUserBusinessForOwner,
  getBusinessByIdPublic,
  updateBusinessInfoForOwner,
  updateBusinessAddressForOwner,
  updateBusinessLocationForOwner,
  updateBusinessHoursForOwner,
  buildServiceError,
  ensureObjectIdString,
  findOwnedBusinessOrThrow,
};
