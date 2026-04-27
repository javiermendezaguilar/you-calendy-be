jest.mock("../functions/cloudinary", () => ({
  uploadToCloudinary: jest.fn().mockResolvedValue({
    secure_url: "https://cloudinary.test/gallery/image.jpg",
    public_id: "gallery-image-public-id",
  }),
  deleteImage: jest.fn().mockResolvedValue({ result: "ok" }),
}));

const request = require("supertest");
const jwt = require("jsonwebtoken");
const app = require("../app");
const Client = require("../models/client");
const HaircutGallery = require("../models/haircutGallery");
const {
  connectCommerceTestDatabase,
  disconnectCommerceTestDatabase,
  createCommerceFixture,
} = require("./helpers/commerceFixture");

beforeAll(async () => {
  await connectCommerceTestDatabase();
});

afterAll(async () => {
  await disconnectCommerceTestDatabase();
});

describe("Auth and client gallery authorization v1", () => {
  let owner;
  let business;
  let client;
  let ownerToken;
  let intruderClient;
  let intruderClientToken;
  let galleryEntry;

  beforeEach(async () => {
    const fixture = await createCommerceFixture({
      ownerName: "Gallery Owner",
      ownerEmail: "gallery-owner@example.com",
      businessName: "Gallery Shop",
    });

    owner = fixture.owner;
    business = fixture.business;
    client = fixture.client;
    ownerToken = fixture.token;

    business.isActive = true;
    await business.save();

    intruderClient = await Client.create({
      business: business._id,
      firstName: "Intruder",
      lastName: "Client",
      email: "intruder-client@example.com",
      phone: "+34777777777",
      registrationStatus: "registered",
      isActive: true,
    });

    intruderClientToken = jwt.sign(
      {
        id: intruderClient._id,
        role: "client",
        type: "client",
        businessId: business._id.toString(),
      },
      process.env.JWT_SECRET
    );

    galleryEntry = await HaircutGallery.create({
      business: business._id,
      client: client._id,
      title: "Owner gallery photo",
      imageUrl: "https://example.com/gallery.jpg",
      imagePublicId: "owner-gallery-public-id",
      isActive: true,
    });
  });

  test("rejects non-admin users when deleting barbers", async () => {
    const res = await request(app)
      .delete(`/auth/barbers/${owner._id}`)
      .set("Authorization", `Bearer ${ownerToken}`);

    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/forbidden/i);
  });

  test("rejects unauthenticated client gallery upload", async () => {
    const res = await request(app)
      .post(`/client/gallery/${client._id}`)
      .attach("image", Buffer.from("fake-image"), "gallery.jpg");

    expect(res.status).toBe(401);
    expect(res.body.message).toMatch(/not logged in/i);
  });

  test("rejects an authenticated client uploading to another client gallery", async () => {
    const res = await request(app)
      .post(`/client/gallery/${client._id}`)
      .set("Authorization", `Bearer ${intruderClientToken}`)
      .attach("image", Buffer.from("fake-image"), "gallery.jpg");

    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/your own gallery/i);
  });

  test("rejects suggestions on another client gallery", async () => {
    const res = await request(app)
      .post(`/client/gallery/${galleryEntry._id}/suggestions`)
      .set("Authorization", `Bearer ${intruderClientToken}`)
      .field("note", "Change this cut");

    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/your own photos/i);
  });

  test("rejects reports on another client gallery", async () => {
    const res = await request(app)
      .post(`/client/gallery/${galleryEntry._id}/reports`)
      .set("Authorization", `Bearer ${intruderClientToken}`)
      .field("note", "This is not mine")
      .field("reportType", "other");

    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/your own photos/i);
  });

  test("rejects deleting another client gallery image", async () => {
    const res = await request(app)
      .delete(`/client/gallery/${galleryEntry._id}`)
      .set("Authorization", `Bearer ${intruderClientToken}`);

    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/your own photos/i);
  });

  test("allows the gallery owner client to delete their own image", async () => {
    const ownerClientToken = jwt.sign(
      {
        id: client._id,
        role: "client",
        type: "client",
        businessId: business._id.toString(),
      },
      process.env.JWT_SECRET
    );

    const res = await request(app)
      .delete(`/client/gallery/${galleryEntry._id}`)
      .set("Authorization", `Bearer ${ownerClientToken}`);

    expect(res.status).toBe(200);

    const stored = await HaircutGallery.findById(galleryEntry._id).lean();
    expect(stored.isActive).toBe(false);
  });

  test("public business gallery excludes active residual entries without required fields", async () => {
    await HaircutGallery.collection.insertOne({
      business: business._id,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const res = await request(app).get(`/client/business/${business._id}/gallery`);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0]._id.toString()).toBe(galleryEntry._id.toString());
    expect(res.body.data[0].imageUrl).toBe("https://example.com/gallery.jpg");
  });
});
