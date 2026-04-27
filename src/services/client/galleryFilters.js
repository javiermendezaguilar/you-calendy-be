const INVALID_HAIRCUT_GALLERY_FILTER = Object.freeze({
  $or: [
    { business: { $exists: false } },
    { business: null },
    { client: { $exists: false } },
    { client: null },
    { imageUrl: { $exists: false } },
    { imageUrl: "" },
    { title: { $exists: false } },
    { title: "" },
  ],
});

const COMPLETE_ACTIVE_HAIRCUT_GALLERY_FILTER = Object.freeze({
  isActive: true,
  client: { $exists: true, $ne: null },
  imageUrl: { $exists: true, $ne: "" },
  title: { $exists: true, $ne: "" },
});

module.exports = {
  COMPLETE_ACTIVE_HAIRCUT_GALLERY_FILTER,
  INVALID_HAIRCUT_GALLERY_FILTER,
};
