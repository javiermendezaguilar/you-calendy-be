const Client = require("../../models/client");
const Business = require("../../models/User/business");
const HaircutGallery = require("../../models/haircutGallery");
const { generateInvitationToken } = require("../../utils/index");
const {
  buildServiceError,
  ensureObjectIdString,
  findOwnedBusinessOrThrow,
} = require("./shared");

const getFrontendBaseUrl = () =>
  process.env.FRONTEND_URL || "http://localhost:5173";

const buildInvitationLink = (token, businessId) =>
  `${getFrontendBaseUrl()}/client/invitation/${token}?business=${businessId}`;

const getClientByInvitationTokenValue = async (token) => {
  if (!token || typeof token !== "string") {
    throw buildServiceError("Invitation token is required.", 400);
  }

  const client = await Client.findOne({
    invitationToken: token,
    isActive: true,
  })
    .populate({
      path: "business",
      populate: {
        path: "owner",
      },
    })
    .populate("staff", "_id firstName lastName email phone services");

  if (!client) {
    throw buildServiceError("Invalid or expired invitation link.", 404);
  }

  return client;
};

const getInvitationLinkForOwner = async (user, clientId) => {
  const validClientId = ensureObjectIdString(clientId, "Client ID is required.");
  const business = await findOwnedBusinessOrThrow(user);

  const client = await Client.findOne({
    _id: validClientId,
    business: business._id,
  });

  if (!client) {
    throw buildServiceError("Client not found.", 404);
  }

  if (!client.invitationToken) {
    throw buildServiceError("No invitation link found for this client.", 404);
  }

  return {
    invitationLink: buildInvitationLink(client.invitationToken, business._id),
    invitationToken: client.invitationToken,
  };
};

const updateClientInvitationTokenForOwner = async (user, clientId) => {
  const validClientId = ensureObjectIdString(clientId, "Client ID is required.");
  const business = await findOwnedBusinessOrThrow(user);

  const client = await Client.findOne({
    _id: validClientId,
    business: business._id,
  });

  if (!client) {
    throw buildServiceError("Client not found.", 404);
  }

  const newInvitationToken = generateInvitationToken();

  const updatedClient = await Client.findByIdAndUpdate(
    validClientId,
    { invitationToken: newInvitationToken },
    { new: true, runValidators: true }
  );

  return {
    message: "Invitation token generated successfully",
    client: updatedClient,
    invitationLink: buildInvitationLink(newInvitationToken, business._id),
    invitationToken: newInvitationToken,
  };
};

const getBusinessDetailsById = async (businessId) => {
  const validBusinessId = ensureObjectIdString(
    businessId,
    "Business ID is required."
  );
  const business = await Business.findById(validBusinessId).populate("owner");

  if (!business) {
    throw buildServiceError("Business not found.", 404);
  }

  if (!business.isActive) {
    throw buildServiceError("Business is not active.", 404);
  }

  return business;
};

const getBusinessGalleryById = async (businessId) => {
  const validBusinessId = ensureObjectIdString(
    businessId,
    "Business ID is required."
  );
  const business = await Business.findById(validBusinessId);

  if (!business) {
    throw buildServiceError("Business not found.", 404);
  }

  if (!business.isActive) {
    throw buildServiceError("Business is not active.", 404);
  }

  return HaircutGallery.find({
    business: validBusinessId,
    isActive: true,
  })
    .populate("client", "firstName lastName")
    .populate("staff", "firstName lastName")
    .sort({ createdAt: -1 });
};

module.exports = {
  getClientByInvitationTokenValue,
  getInvitationLinkForOwner,
  updateClientInvitationTokenForOwner,
  getBusinessDetailsById,
  getBusinessGalleryById,
};
