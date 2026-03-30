const cloudinary = require("cloudinary");
const streamifier = require("streamifier");

cloudinary.v2.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
});

const uploadStreamImage = async (image, public_id) => {
  return new Promise((resolve, reject) => {
    const cloud = cloudinary.v2.uploader.upload_stream(
      { folder: "ufa_media", public_id },
      (error, result) => {
        if (error) {
          reject(error);
        } else {
          resolve(result);
        }
      }
    );
    streamifier.createReadStream(image).pipe(cloud);
  });
};

const uploadToCloudinary = async (
  buffer,
  folder = "you_calendy",
  resourceType = "image"
) => {
  return new Promise((resolve, reject) => {
    const uploadOptions = {
      folder: folder,
      resource_type: resourceType,
    };

    // Add format restrictions only for images
    if (resourceType === "image") {
      uploadOptions.allowed_formats = ["jpg", "jpeg", "png", "gif", "webp"];
    }

    const cloud = cloudinary.v2.uploader.upload_stream(
      uploadOptions,
      (error, result) => {
        if (error) {
          reject(error);
        } else {
          resolve(result);
        }
      }
    );
    streamifier.createReadStream(buffer).pipe(cloud);
  });
};

const uploadFileToCloudinary = async (
  buffer,
  folder = "backups",
  filename = null
) => {
  return new Promise((resolve, reject) => {
    const uploadOptions = {
      folder: folder,
      resource_type: "raw", // Use 'raw' for files like JSON, documents, etc.
    };

    // Add public_id if filename is provided
    if (filename) {
      uploadOptions.public_id = filename.replace(/\.[^/.]+$/, ""); // Remove file extension
    }

    const cloud = cloudinary.v2.uploader.upload_stream(
      uploadOptions,
      (error, result) => {
        if (error) {
          reject(error);
        } else {
          resolve(result);
        }
      }
    );
    streamifier.createReadStream(buffer).pipe(cloud);
  });
};

const deleteImage = async (url) => {
  const public_id = `you_calendy${url.split("you_calendy")[1].split(".")[0]}`;
  return new Promise((resolve, reject) => {
    cloudinary.v2.uploader.destroy(public_id, (error, result) => {
      if (error) {
        reject(error);
      } else {
        resolve(result);
      }
    });
  });
};

const deleteFileFromCloudinary = async (publicId, resourceType = "raw") => {
  return new Promise((resolve, reject) => {
    cloudinary.v2.uploader.destroy(
      publicId,
      { resource_type: resourceType },
      (error, result) => {
        if (error) {
          reject(error);
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
};
