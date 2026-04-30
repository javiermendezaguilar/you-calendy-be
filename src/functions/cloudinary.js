const cloudinary = require("cloudinary");
const streamifier = require("streamifier");

const IMAGE_RESOURCE_TYPE = "image";
const RAW_RESOURCE_TYPE = "raw";
const ALLOWED_RESOURCE_TYPES = new Set([IMAGE_RESOURCE_TYPE, RAW_RESOURCE_TYPE]);

const ALLOWED_IMAGE_FOLDERS = new Set([
  "appointment-photos",
  "business-logos",
  "email-campaigns",
  "gallery-images",
  "haircut-gallery",
  "haircut-photos",
  "haircut-reports",
  "haircut-suggestions",
  "profile-images",
  "service-images",
  "ufa_media",
  "workplace-photos",
  "you_calendy",
]);

const ALLOWED_RAW_FOLDERS = new Set([
  "backups",
  "client-csv-uploads",
  "client-profiles",
]);

const IMAGE_FORMATS = ["jpg", "jpeg", "png", "gif", "webp"];
const EXTENSION_PATTERN = /\.(jpg|jpeg|png|gif|webp|json|gz|csv)$/i;

cloudinary.v2.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const normalizeCloudinaryError = (error, fallbackMessage) => {
  const normalized = new Error(error?.message || fallbackMessage);
  normalized.provider = "cloudinary";
  normalized.code = error?.code || error?.name || "cloudinary_error";
  normalized.status = error?.http_code || error?.status || null;
  normalized.retryable =
    normalized.status === 429 ||
    (typeof normalized.status === "number" && normalized.status >= 500);
  return normalized;
};

const assertBuffer = (buffer) => {
  if (!Buffer.isBuffer(buffer)) {
    const error = new Error("Cloudinary upload requires a file buffer.");
    error.code = "invalid_upload_buffer";
    throw error;
  }
};

const assertResourceType = (resourceType) => {
  if (!ALLOWED_RESOURCE_TYPES.has(resourceType)) {
    const error = new Error(`Unsupported Cloudinary resource type: ${resourceType}`);
    error.code = "unsupported_cloudinary_resource_type";
    throw error;
  }
};

const assertAllowedFolder = (folder, resourceType) => {
  const allowedFolders =
    resourceType === RAW_RESOURCE_TYPE ? ALLOWED_RAW_FOLDERS : ALLOWED_IMAGE_FOLDERS;

  if (!allowedFolders.has(folder)) {
    const error = new Error(`Unsupported Cloudinary folder: ${folder}`);
    error.code = "unsupported_cloudinary_folder";
    throw error;
  }
};

const stripKnownExtension = (value) => value.replace(EXTENSION_PATTERN, "");

const resolveCloudinaryPublicId = (source) => {
  if (!source || typeof source !== "string") {
    const error = new Error("Cloudinary public id or URL is required.");
    error.code = "missing_cloudinary_public_id";
    throw error;
  }

  const trimmedSource = source.trim();
  if (!/^https?:\/\//i.test(trimmedSource)) {
    return stripKnownExtension(trimmedSource.replace(/^\/+/, ""));
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(trimmedSource);
  } catch (error) {
    const invalidUrlError = new Error("Invalid Cloudinary URL.");
    invalidUrlError.code = "invalid_cloudinary_url";
    throw invalidUrlError;
  }

  const pathParts = parsedUrl.pathname.split("/").filter(Boolean);
  const uploadIndex = pathParts.indexOf("upload");
  if (uploadIndex === -1 || uploadIndex === pathParts.length - 1) {
    const error = new Error("Cloudinary URL does not contain an upload public id.");
    error.code = "invalid_cloudinary_upload_url";
    throw error;
  }

  let publicIdParts = pathParts.slice(uploadIndex + 1);
  if (/^v\d+$/.test(publicIdParts[0])) {
    publicIdParts = publicIdParts.slice(1);
  }

  if (publicIdParts.length === 0) {
    const error = new Error("Cloudinary URL does not contain an upload public id.");
    error.code = "invalid_cloudinary_upload_url";
    throw error;
  }

  const publicId = publicIdParts.map(decodeURIComponent).join("/");
  return stripKnownExtension(publicId);
};

const buildUploadOptions = (folder, resourceType, filename = null) => {
  assertResourceType(resourceType);
  assertAllowedFolder(folder, resourceType);

  const uploadOptions = {
    folder,
    resource_type: resourceType,
  };

  if (resourceType === IMAGE_RESOURCE_TYPE) {
    uploadOptions.allowed_formats = IMAGE_FORMATS;
  }

  if (filename) {
    uploadOptions.public_id = stripKnownExtension(filename);
  }

  return uploadOptions;
};

const uploadBuffer = async (buffer, uploadOptions) => {
  assertBuffer(buffer);

  return new Promise((resolve, reject) => {
    const cloud = cloudinary.v2.uploader.upload_stream(
      uploadOptions,
      (error, result) => {
        if (error) {
          reject(normalizeCloudinaryError(error, "Cloudinary upload failed."));
        } else {
          resolve(result);
        }
      }
    );
    streamifier.createReadStream(buffer).pipe(cloud);
  });
};

const uploadStreamImage = async (image, public_id) => {
  const uploadOptions = buildUploadOptions("ufa_media", IMAGE_RESOURCE_TYPE, public_id);
  return uploadBuffer(image, uploadOptions);
};

const uploadToCloudinary = async (
  buffer,
  folder = "you_calendy",
  resourceType = IMAGE_RESOURCE_TYPE
) => {
  const uploadOptions = buildUploadOptions(folder, resourceType);
  return uploadBuffer(buffer, uploadOptions);
};

const uploadFileToCloudinary = async (
  buffer,
  folder = "backups",
  filename = null
) => {
  const uploadOptions = buildUploadOptions(folder, RAW_RESOURCE_TYPE, filename);
  return uploadBuffer(buffer, uploadOptions);
};

const deleteImage = async (publicIdOrUrl) => {
  const publicId = resolveCloudinaryPublicId(publicIdOrUrl);

  return new Promise((resolve, reject) => {
    cloudinary.v2.uploader.destroy(publicId, (error, result) => {
      if (error) {
        const normalizedError = normalizeCloudinaryError(
          error,
          "Cloudinary image deletion failed."
        );
        if (normalizedError.status === 404) {
          resolve({ result: "not found", public_id: publicId, idempotent: true });
          return;
        }
        reject(normalizedError);
        return;
      }

      resolve(result);
    });
  });
};

const deleteFileFromCloudinary = async (publicId, resourceType = RAW_RESOURCE_TYPE) => {
  assertResourceType(resourceType);

  return new Promise((resolve, reject) => {
    cloudinary.v2.uploader.destroy(
      resolveCloudinaryPublicId(publicId),
      { resource_type: resourceType },
      (error, result) => {
        if (error) {
          const normalizedError = normalizeCloudinaryError(
            error,
            "Cloudinary file deletion failed."
          );
          if (normalizedError.status === 404) {
            resolve({ result: "not found", public_id: publicId, idempotent: true });
            return;
          }
          reject(normalizedError);
        } else {
          resolve(result);
        }
      }
    );
  });
};

module.exports = {
  deleteImage,
  deleteFileFromCloudinary,
  uploadStreamImage,
  uploadToCloudinary,
  uploadFileToCloudinary,
  _cloudinaryMediaPolicy: {
    ALLOWED_IMAGE_FOLDERS,
    ALLOWED_RAW_FOLDERS,
    ALLOWED_RESOURCE_TYPES,
    buildUploadOptions,
    resolveCloudinaryPublicId,
  },
};
