const request = require("supertest");

process.env.JWT_SECRET = "mysecretcalendy";
process.env.MONGO_URI = "mock-uri";
process.env.FRONTEND_URL = "https://groomnest.com";
process.env.ADDITIONAL_ALLOWED_ORIGINS = "https://app.groomnest.com";

const app = require("../app");

const postAuthLogout = ({ origin, cookies = ["userToken=fake-token"] } = {}) => {
  let apiRequest = request(app).post("/auth/logout");
  if (origin) apiRequest = apiRequest.set("Origin", origin);
  if (cookies) apiRequest = apiRequest.set("Cookie", cookies);
  return apiRequest.send({ userType: "user" });
};

describe("CSRF protection", () => {
  test("allows cookie-authenticated writes from an allowed origin", async () => {
    const res = await postAuthLogout({
      origin: "https://you-calendy-fe-three.vercel.app",
    });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test("blocks cookie-authenticated writes from an untrusted origin", async () => {
    const res = await postAuthLogout({ origin: "https://evil.example.com" });

    expect(res.status).toBe(403);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toBe("Blocked by CSRF protection");
  });

  test("allows cookie-authenticated writes from an additional allowed origin", async () => {
    const res = await postAuthLogout({ origin: "https://app.groomnest.com" });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  test("clears auth cookies with secure cross-site policy in staging", async () => {
    const previousRailwayEnvironmentName = process.env.RAILWAY_ENVIRONMENT_NAME;
    process.env.RAILWAY_ENVIRONMENT_NAME = "staging";

    try {
      const res = await postAuthLogout({ cookies: null });

      const setCookie = (res.headers["set-cookie"] || []).join("; ");

      expect(res.status).toBe(200);
      expect(setCookie).toContain("userToken=;");
      expect(setCookie).toContain("Secure");
      expect(setCookie).toContain("SameSite=None");
    } finally {
      if (previousRailwayEnvironmentName === undefined) {
        delete process.env.RAILWAY_ENVIRONMENT_NAME;
      } else {
        process.env.RAILWAY_ENVIRONMENT_NAME =
          previousRailwayEnvironmentName;
      }
    }
  });
});
