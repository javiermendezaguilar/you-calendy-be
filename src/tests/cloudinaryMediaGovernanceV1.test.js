jest.mock("cloudinary", () => ({
  v2: {
    config: jest.fn(),
    uploader: {
      upload_stream: jest.fn(),
      destroy: jest.fn(),
    },
  },
}));

const { Writable } = require("stream");
const cloudinary = require("cloudinary");
const {
  deleteImage,
  uploadToCloudinary,
  _cloudinaryMediaPolicy,
} = require("../functions/cloudinary");

const createWritableUploadStream = (callback, result = {}) => {
  const stream = new Writable({
    write(_chunk, _encoding, done) {
      done();
    },
  });
  process.nextTick(() => callback(null, result));
  return stream;
};

describe("Cloudinary media governance v1", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  test("rejects unsupported image folders before calling Cloudinary", async () => {
    await expect(
      uploadToCloudinary(Buffer.from("image"), "unknown-folder")
    ).rejects.toMatchObject({
      code: "unsupported_cloudinary_folder",
    });

    expect(cloudinary.v2.uploader.upload_stream).not.toHaveBeenCalled();
  });

  test("rejects unsupported resource types before calling Cloudinary", async () => {
    await expect(
      uploadToCloudinary(Buffer.from("image"), "haircut-gallery", "video")
    ).rejects.toMatchObject({
      code: "unsupported_cloudinary_resource_type",
    });

    expect(cloudinary.v2.uploader.upload_stream).not.toHaveBeenCalled();
  });

  test("uploads image buffers only to allowed folders with image format guard", async () => {
    cloudinary.v2.uploader.upload_stream.mockImplementation((options, callback) =>
      createWritableUploadStream(callback, {
        secure_url: "https://cloudinary.test/haircut-gallery/photo.jpg",
        public_id: "haircut-gallery/photo",
        options,
      })
    );

    const result = await uploadToCloudinary(
      Buffer.from("image"),
      "haircut-gallery"
    );

    expect(result.public_id).toBe("haircut-gallery/photo");
    expect(cloudinary.v2.uploader.upload_stream).toHaveBeenCalledWith(
      expect.objectContaining({
        folder: "haircut-gallery",
        resource_type: "image",
        allowed_formats: ["jpg", "jpeg", "png", "gif", "webp"],
      }),
      expect.any(Function)
    );
  });

  test("deletes direct public ids without trying to parse them as legacy URLs", async () => {
    cloudinary.v2.uploader.destroy.mockImplementation((publicId, callback) =>
      callback(null, { result: "ok", public_id: publicId })
    );

    const result = await deleteImage("haircut-gallery/photo-id");

    expect(result.result).toBe("ok");
    expect(cloudinary.v2.uploader.destroy).toHaveBeenCalledWith(
      "haircut-gallery/photo-id",
      expect.any(Function)
    );
  });

  test("resolves Cloudinary URLs to public ids before deleting", async () => {
    cloudinary.v2.uploader.destroy.mockImplementation((publicId, callback) =>
      callback(null, { result: "ok", public_id: publicId })
    );

    const result = await deleteImage(
      "https://res.cloudinary.com/demo/image/upload/v1720642174/haircut-gallery/photo-id.jpg"
    );

    expect(result.public_id).toBe("haircut-gallery/photo-id");
    expect(cloudinary.v2.uploader.destroy).toHaveBeenCalledWith(
      "haircut-gallery/photo-id",
      expect.any(Function)
    );
  });

  test("treats provider 404 during image deletion as idempotent", async () => {
    cloudinary.v2.uploader.destroy.mockImplementation((_publicId, callback) =>
      callback({ message: "not found", http_code: 404 })
    );

    const result = await deleteImage("haircut-gallery/missing-photo");

    expect(result).toMatchObject({
      result: "not found",
      public_id: "haircut-gallery/missing-photo",
      idempotent: true,
    });
  });

  test("documents current allowed media folders in the central policy", () => {
    expect(_cloudinaryMediaPolicy.ALLOWED_IMAGE_FOLDERS.has("business-logos")).toBe(
      true
    );
    expect(_cloudinaryMediaPolicy.ALLOWED_IMAGE_FOLDERS.has("email-campaigns")).toBe(
      true
    );
    expect(_cloudinaryMediaPolicy.ALLOWED_IMAGE_FOLDERS.has("profile-images")).toBe(
      true
    );
    expect(_cloudinaryMediaPolicy.ALLOWED_RAW_FOLDERS.has("backups")).toBe(true);
    expect(_cloudinaryMediaPolicy.ALLOWED_RAW_FOLDERS.has("client-csv-uploads")).toBe(
      true
    );
  });
});
