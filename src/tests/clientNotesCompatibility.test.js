const request = require("supertest");
const mongoose = require("mongoose");
const { MongoMemoryReplSet } = require("mongodb-memory-server");
const jwt = require("jsonwebtoken");

process.env.JWT_SECRET = "mysecretcalendy";
process.env.MONGO_URI = "mock-uri";
process.env.FRONTEND_URL = "https://groomnest.com";
process.env.ADDITIONAL_ALLOWED_ORIGINS = "https://app.groomnest.com";

const app = require("../app");
const User = require("../models/User/user");
const Business = require("../models/User/business");
const Client = require("../models/client");
const Note = require("../models/note");
const HaircutGallery = require("../models/haircutGallery");

let mongoServer;

beforeAll(async () => {
  mongoServer = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  const uri = mongoServer.getUri();
  if (mongoose.connection.readyState !== 0) {
    await mongoose.disconnect();
  }
  await mongoose.connect(uri);
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

describe("Client notes compatibility", () => {
  let owner;
  let business;
  let client;
  let token;
  let legacySuggestion;
  let legacyReport;
  let gallerySuggestionId;
  let galleryReportId;

  beforeEach(async () => {
    await Promise.all([
      User.deleteMany({}),
      Business.deleteMany({}),
      Client.deleteMany({}),
      Note.deleteMany({}),
      HaircutGallery.deleteMany({}),
    ]);

    owner = await User.create({
      name: "Owner",
      firstName: "Owner",
      lastName: "One",
      email: "owner@example.com",
      password: "password123",
      role: "barber",
      isEmailVerified: true,
    });

    business = await Business.create({
      owner: owner._id,
      name: "Test Barbershop",
      businessName: "Test Barbershop",
      contactInfo: { phone: "+34111111111" },
    });

    client = await Client.create({
      firstName: "Sunny",
      lastName: "Client",
      phone: "+34999999999",
      business: business._id,
      registrationStatus: "registered",
      isProfileComplete: true,
      isActive: true,
    });

    legacySuggestion = await Note.create({
      businessId: business._id,
      clientId: client._id,
      createdBy: owner._id,
      content: "Legacy suggestion",
      type: "suggestion",
      createdAt: new Date("2025-11-01T10:00:00.000Z"),
    });

    legacyReport = await Note.create({
      businessId: business._id,
      clientId: client._id,
      createdBy: owner._id,
      content: "Legacy report",
      type: "report",
      status: "pending",
      reportType: "other",
      createdAt: new Date("2025-11-02T10:00:00.000Z"),
    });

    const gallery = await HaircutGallery.create({
      business: business._id,
      client: client._id,
      title: "Gallery item",
      imageUrl: "https://example.com/image.jpg",
      suggestions: [
        {
          note: "Gallery suggestion",
          createdBy: client._id,
          createdAt: new Date("2025-11-03T10:00:00.000Z"),
        },
      ],
      reports: [
        {
          note: "Gallery report",
          createdBy: client._id,
          status: "pending",
          reportType: "quality_issue",
          createdAt: new Date("2025-11-04T10:00:00.000Z"),
        },
      ],
      isActive: true,
    });

    gallerySuggestionId = gallery.suggestions[0]._id.toString();
    galleryReportId = gallery.reports[0]._id.toString();

    token = jwt.sign({ id: owner._id, role: "barber" }, process.env.JWT_SECRET);
  });

  test("merges legacy Note and HaircutGallery entries in note reads", async () => {
    const countsRes = await request(app)
      .get("/business/clients/note-counts")
      .set("Authorization", `Bearer ${token}`);

    expect(countsRes.status).toBe(200);
    expect(countsRes.body.data).toEqual({ suggestions: 2, reports: 2 });

    const suggestionsRes = await request(app)
      .get("/business/clients/suggestions")
      .set("Authorization", `Bearer ${token}`);

    expect(suggestionsRes.status).toBe(200);
    expect(suggestionsRes.body.data.pagination.total).toBe(2);
    expect(suggestionsRes.body.data.suggestions).toHaveLength(2);
    expect(suggestionsRes.body.data.suggestions[0].content).toBe("Gallery suggestion");
    expect(suggestionsRes.body.data.suggestions[1].content).toBe("Legacy suggestion");

    const reportsRes = await request(app)
      .get("/business/clients/reports")
      .set("Authorization", `Bearer ${token}`);

    expect(reportsRes.status).toBe(200);
    expect(reportsRes.body.data.pagination.total).toBe(2);
    expect(reportsRes.body.data.reports).toHaveLength(2);
    expect(reportsRes.body.data.reports[0].content).toBe("Gallery report");
    expect(reportsRes.body.data.reports[1].content).toBe("Legacy report");
  });

  test("responds to both gallery-backed and legacy note-backed entries", async () => {
    const legacySuggestionRes = await request(app)
      .post(`/business/clients/notes/${legacySuggestion._id}/respond`)
      .set("Authorization", `Bearer ${token}`)
      .send({ response: "Handled legacy suggestion" });

    expect(legacySuggestionRes.status).toBe(200);

    const refreshedLegacySuggestion = await Note.findById(legacySuggestion._id);
    expect(refreshedLegacySuggestion.response).toBe("Handled legacy suggestion");
    expect(refreshedLegacySuggestion.respondedAt).toBeTruthy();

    const gallerySuggestionRes = await request(app)
      .post(`/business/clients/notes/${gallerySuggestionId}/respond`)
      .set("Authorization", `Bearer ${token}`)
      .send({ response: "Handled gallery suggestion" });

    expect(gallerySuggestionRes.status).toBe(200);

    const refreshedGallery = await HaircutGallery.findOne({ business: business._id });
    expect(refreshedGallery.suggestions.id(gallerySuggestionId).response).toBe(
      "Handled gallery suggestion"
    );

    const legacyReportRes = await request(app)
      .post(`/business/clients/notes/${legacyReport._id}/respond`)
      .set("Authorization", `Bearer ${token}`)
      .send({ response: "Handled legacy report", status: "resolved" });

    expect(legacyReportRes.status).toBe(200);

    const refreshedLegacyReport = await Note.findById(legacyReport._id);
    expect(refreshedLegacyReport.reviewNote).toBe("Handled legacy report");
    expect(refreshedLegacyReport.status).toBe("resolved");

    const galleryReportRes = await request(app)
      .post(`/business/clients/notes/${galleryReportId}/respond`)
      .set("Authorization", `Bearer ${token}`)
      .send({ response: "Handled gallery report", status: "resolved" });

    expect(galleryReportRes.status).toBe(200);

    const refreshedGalleryWithReport = await HaircutGallery.findOne({
      business: business._id,
    });
    expect(refreshedGalleryWithReport.reports.id(galleryReportId).reviewNote).toBe(
      "Handled gallery report"
    );
    expect(refreshedGalleryWithReport.reports.id(galleryReportId).status).toBe(
      "resolved"
    );
  });

  test("rejects unsupported report status filters", async () => {
    const res = await request(app)
      .get("/business/clients/reports?status=__proto__")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toBe("Invalid report status filter.");
  });
});
