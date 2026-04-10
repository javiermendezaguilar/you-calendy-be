const request = require("supertest");

process.env.JWT_SECRET = "mysecretcalendy";
process.env.MONGO_URI = "mock-uri";
process.env.FRONTEND_URL = "https://you-calendy-fe-three.vercel.app";

const app = require("../app");

describe("CSRF protection", () => {
  test("allows cookie-authenticated writes from an allowed origin", async () => {
    const res = await request(app)
      .post("/auth/logout")
      .set("Origin", "https://you-calendy-fe-three.vercel.app")
      .set("Cookie", ["userToken=fake-token"])
      .send({ userType: "user" });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test("blocks cookie-authenticated writes from an untrusted origin", async () => {
    const res = await request(app)
      .post("/auth/logout")
      .set("Origin", "https://evil.example.com")
      .set("Cookie", ["userToken=fake-token"])
      .send({ userType: "user" });

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toBe("Blocked by CSRF protection");
  });
});
