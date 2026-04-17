const Client = require("../../models/client");
const HaircutGallery = require("../../models/haircutGallery");
const Note = require("../../models/note");
const {
  findOwnedBusinessOrThrow,
  buildServiceError,
  getOwnerUserId,
  ensureObjectIdString,
} = require("./shared");

const normalizeLegacyNoteItem = (note) => ({
  _id: note._id,
  content: note.content,
  images: Array.isArray(note.images) ? note.images.filter(Boolean) : [],
  createdAt: note.createdAt,
  clientId: note.clientId,
  createdBy: note.createdBy,
  galleryId: null,
  galleryImage: null,
  galleryTitle: null,
  response: note.response || note.reviewNote,
  respondedBy: note.respondedBy || note.reviewedBy,
  respondedAt: note.respondedAt || note.reviewedAt,
  reportType: note.reportType,
  status: note.status,
  rating: note.rating,
  source: "note",
});

const normalizeGallerySuggestionItem = (gallery, suggestion) => ({
  _id: suggestion._id,
  content: suggestion.note,
  images: suggestion.imageUrl ? [suggestion.imageUrl] : [],
  createdAt: suggestion.createdAt,
  clientId: gallery.client,
  createdBy: suggestion.createdBy,
  galleryId: gallery._id,
  galleryImage: gallery.imageUrl,
  galleryTitle: gallery.title,
  response: suggestion.response,
  respondedBy: suggestion.respondedBy,
  respondedAt: suggestion.respondedAt,
  source: "gallery",
});

const normalizeGalleryReportItem = (gallery, report) => ({
  _id: report._id,
  content: report.note,
  reportType: report.reportType,
  status: report.status,
  rating: report.rating,
  images: report.imageUrl ? [report.imageUrl] : [],
  createdAt: report.createdAt,
  clientId: gallery.client,
  createdBy: report.createdBy,
  galleryId: gallery._id,
  galleryImage: gallery.imageUrl,
  galleryTitle: gallery.title,
  reviewNote: report.reviewNote,
  reviewedBy: report.reviewedBy,
  reviewedAt: report.reviewedAt,
  response: report.reviewNote,
  respondedBy: report.reviewedBy,
  respondedAt: report.reviewedAt,
  source: "gallery",
});

const sortByCreatedAtDesc = (a, b) =>
  new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime();

const ALLOWED_REPORT_STATUSES = new Set([
  "pending",
  "reviewed",
  "resolved",
  "dismissed",
]);

const normalizeAllowedReportStatus = (status) => {
  if (typeof status === "undefined") {
    return null;
  }

  if (typeof status !== "string" || !ALLOWED_REPORT_STATUSES.has(status)) {
    throw buildServiceError("Invalid report status.", 400);
  }

  return status;
};

const getOwnedClientOrThrow = async (businessId, clientId) => {
  const safeClientId = ensureObjectIdString(clientId, "Invalid client ID.");
  const client = await Client.findOne({
    _id: safeClientId,
    business: businessId,
  });

  if (!client) {
    throw buildServiceError("Client not found.", 404);
  }

  return client;
};

const addClientSuggestionForOwner = async (user, clientId, payload) => {
  const { note, images = [] } = payload;

  if (!note) {
    throw buildServiceError("Suggestion note is required.", 400);
  }

  const business = await findOwnedBusinessOrThrow(user);
  const client = await getOwnedClientOrThrow(business._id, clientId);

  const suggestion = new Note({
    businessId: business._id,
    clientId: client._id,
    createdBy: getOwnerUserId(user),
    content: note,
    type: "suggestion",
    images,
  });

  await suggestion.save();
  return suggestion;
};

const getClientSuggestionsForOwner = async (user, query) => {
  const { page = 1, limit = 10 } = query;
  const pageNumber = parseInt(page, 10);
  const limitNumber = parseInt(limit, 10);
  const skip = (pageNumber - 1) * limitNumber;
  const business = await findOwnedBusinessOrThrow(user);

  const galleryWithSuggestions = await HaircutGallery.find({
    business: business._id,
    isActive: true,
    "suggestions.0": { $exists: true },
  })
    .populate("client", "firstName lastName phone profileImage")
    .populate("suggestions.createdBy", "firstName lastName")
    .sort({ updatedAt: -1 });

  const legacyNotes = await Note.find({
    businessId: business._id,
    type: "suggestion",
  })
    .populate("clientId", "firstName lastName phone profileImage")
    .populate("createdBy", "firstName lastName")
    .sort({ createdAt: -1 });

  const combinedSuggestions = [];

  galleryWithSuggestions.forEach((gallery) => {
    gallery.suggestions.forEach((suggestion) => {
      combinedSuggestions.push(
        normalizeGallerySuggestionItem(gallery, suggestion)
      );
    });
  });

  legacyNotes.forEach((note) => {
    combinedSuggestions.push(normalizeLegacyNoteItem(note));
  });

  combinedSuggestions.sort(sortByCreatedAtDesc);

  return {
    suggestions: combinedSuggestions.slice(skip, skip + limitNumber),
    pagination: {
      total: combinedSuggestions.length,
      page: pageNumber,
      pages: Math.ceil(combinedSuggestions.length / limitNumber),
    },
  };
};

const addClientReportForOwner = async (user, clientId, payload) => {
  const { note, reportType = "other", images = [] } = payload;

  if (!note) {
    throw buildServiceError("Report note is required.", 400);
  }

  const business = await findOwnedBusinessOrThrow(user);
  const client = await getOwnedClientOrThrow(business._id, clientId);

  const report = new Note({
    businessId: business._id,
    clientId: client._id,
    createdBy: getOwnerUserId(user),
    content: note,
    type: "report",
    reportType,
    images,
    status: "pending",
  });

  await report.save();
  return report;
};

const getClientReportsForOwner = async (user, query) => {
  const { status, page = 1, limit = 10 } = query;
  const pageNumber = parseInt(page, 10);
  const limitNumber = parseInt(limit, 10);
  const skip = (pageNumber - 1) * limitNumber;
  const normalizedStatus =
    typeof status === "string" && ALLOWED_REPORT_STATUSES.has(status)
      ? status
      : null;

  if (status && !normalizedStatus) {
    throw buildServiceError("Invalid report status filter.", 400);
  }

  const business = await findOwnedBusinessOrThrow(user);
  const galleryQuery = {
    business: business._id,
    isActive: true,
    "reports.0": { $exists: true },
  };

  if (normalizedStatus) {
    galleryQuery["reports.status"] = normalizedStatus;
  }

  const galleryWithReports = await HaircutGallery.find(galleryQuery)
    .populate("client", "firstName lastName phone profileImage")
    .populate("reports.createdBy", "firstName lastName")
    .sort({ updatedAt: -1 });

  const legacyReportQuery = {
    businessId: business._id,
    type: "report",
  };
  if (normalizedStatus) {
    legacyReportQuery.status = normalizedStatus;
  }

  const legacyReports = await Note.find(legacyReportQuery)
    .populate("clientId", "firstName lastName phone profileImage")
    .populate("createdBy", "firstName lastName")
    .sort({ createdAt: -1 });

  const combinedReports = [];
  galleryWithReports.forEach((gallery) => {
    gallery.reports.forEach((report) => {
      if (!normalizedStatus || report.status === normalizedStatus) {
        combinedReports.push(normalizeGalleryReportItem(gallery, report));
      }
    });
  });

  legacyReports.forEach((note) => {
    combinedReports.push(normalizeLegacyNoteItem(note));
  });

  combinedReports.sort(sortByCreatedAtDesc);

  return {
    reports: combinedReports.slice(skip, skip + limitNumber),
    pagination: {
      total: combinedReports.length,
      page: pageNumber,
      pages: Math.ceil(combinedReports.length / limitNumber),
    },
  };
};

const updateReportStatusForOwner = async (user, reportId, payload) => {
  const { status, reviewNote } = payload;
  const business = await findOwnedBusinessOrThrow(user);
  const safeReportId = ensureObjectIdString(reportId, "Invalid report ID.");
  const normalizedStatus = normalizeAllowedReportStatus(status);

  const report = await Note.findOne({
    _id: safeReportId,
    businessId: business._id,
    type: "report",
  });

  if (!report) {
    throw buildServiceError("Report not found.", 404);
  }

  const updateData = {
    reviewedBy: getOwnerUserId(user),
    reviewedAt: new Date(),
  };
  if (normalizedStatus) updateData.status = normalizedStatus;
  if (reviewNote) updateData.reviewNote = reviewNote;

  return Note.findOneAndUpdate(
    {
      _id: safeReportId,
      businessId: business._id,
      type: "report",
    },
    updateData,
    {
      new: true,
    }
  ).populate("clientId", "firstName lastName phone");
};

const respondToClientNoteForOwner = async (user, noteId, payload) => {
  const { response, status } = payload;

  if (!response) {
    throw buildServiceError("Response message is required.", 400);
  }

  const business = await findOwnedBusinessOrThrow(user);
  const ownerId = getOwnerUserId(user);
  const safeNoteId = ensureObjectIdString(noteId, "Invalid note ID.");
  const normalizedStatus = normalizeAllowedReportStatus(status);

  const suggestionUpdate = await HaircutGallery.findOneAndUpdate(
    {
      business: business._id,
      isActive: true,
      "suggestions._id": safeNoteId,
    },
    {
      $set: {
        "suggestions.$.response": response,
        "suggestions.$.respondedBy": ownerId,
        "suggestions.$.respondedAt": new Date(),
      },
    },
    { new: true }
  )
    .populate("client", "firstName lastName phone profileImage")
    .populate("suggestions.createdBy", "firstName lastName");

  if (suggestionUpdate) {
    return { message: "Response sent successfully", gallery: suggestionUpdate };
  }

  const reportSet = {
    "reports.$.reviewNote": response,
    "reports.$.reviewedBy": ownerId,
    "reports.$.reviewedAt": new Date(),
  };
  if (normalizedStatus) {
    reportSet["reports.$.status"] = normalizedStatus;
  }

  const reportUpdate = await HaircutGallery.findOneAndUpdate(
    {
      business: business._id,
      isActive: true,
      "reports._id": safeNoteId,
    },
    { $set: reportSet },
    { new: true }
  )
    .populate("client", "firstName lastName phone profileImage")
    .populate("reports.createdBy", "firstName lastName");

  if (reportUpdate) {
    return { message: "Response sent successfully", gallery: reportUpdate };
  }

  const legacySuggestionUpdate = await Note.findOneAndUpdate(
    {
      _id: safeNoteId,
      businessId: business._id,
      type: "suggestion",
    },
    {
      $set: {
        response,
        respondedBy: ownerId,
        respondedAt: new Date(),
      },
    },
    { new: true }
  ).populate("clientId", "firstName lastName phone profileImage");

  if (legacySuggestionUpdate) {
    return { message: "Response sent successfully", note: legacySuggestionUpdate };
  }

  const legacyReportUpdate = await Note.findOneAndUpdate(
    {
      _id: safeNoteId,
      businessId: business._id,
      type: "report",
    },
    {
      $set: {
        reviewNote: response,
        reviewedBy: ownerId,
        reviewedAt: new Date(),
        ...(normalizedStatus ? { status: normalizedStatus } : {}),
      },
    },
    { new: true }
  ).populate("clientId", "firstName lastName phone profileImage");

  if (legacyReportUpdate) {
    return { message: "Response sent successfully", note: legacyReportUpdate };
  }

  throw buildServiceError("Note not found.", 404);
};

const getClientNoteCountsForOwner = async (user) => {
  const business = await findOwnedBusinessOrThrow(user);

  const galleryEntries = await HaircutGallery.find({
    business: business._id,
    isActive: true,
    $or: [
      { "suggestions.0": { $exists: true } },
      { "reports.0": { $exists: true } },
    ],
  });

  const [legacySuggestionsCount, legacyReportsCount] = await Promise.all([
    Note.countDocuments({ businessId: business._id, type: "suggestion" }),
    Note.countDocuments({ businessId: business._id, type: "report" }),
  ]);

  let suggestions = legacySuggestionsCount;
  let reports = legacyReportsCount;

  galleryEntries.forEach((gallery) => {
    suggestions += gallery.suggestions.length;
    reports += gallery.reports.length;
  });

  return { suggestions, reports };
};

module.exports = {
  addClientSuggestionForOwner,
  getClientSuggestionsForOwner,
  addClientReportForOwner,
  getClientReportsForOwner,
  updateReportStatusForOwner,
  respondToClientNoteForOwner,
  getClientNoteCountsForOwner,
};
