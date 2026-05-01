const {
  DEFAULT_AUTH_COOKIE_MAX_AGE_MS,
  buildAuthCookieOptions,
  buildClearAuthCookieOptions,
  isDeployedRuntime,
} = require("../utils/authCookieOptions");
const SuccessHandler = require("../utils/SuccessHandler");

describe("auth cookie options v1", () => {
  test("keeps local cookies usable without HTTPS", () => {
    expect(buildAuthCookieOptions({ NODE_ENV: "development" })).toEqual({
      httpOnly: true,
      secure: false,
      sameSite: "lax",
      maxAge: DEFAULT_AUTH_COOKIE_MAX_AGE_MS,
      path: "/",
    });
  });

  test("uses cross-site secure cookies in Railway staging", () => {
    const options = buildAuthCookieOptions({
      RAILWAY_ENVIRONMENT_NAME: "staging",
    });

    expect(options).toMatchObject({
      httpOnly: true,
      secure: true,
      sameSite: "none",
      path: "/",
    });
    expect(isDeployedRuntime({ RAILWAY_ENVIRONMENT_NAME: "staging" })).toBe(
      true
    );
  });

  test("uses cross-site secure cookies in production", () => {
    expect(buildAuthCookieOptions({ NODE_ENV: "production" })).toMatchObject({
      secure: true,
      sameSite: "none",
    });

    expect(
      buildAuthCookieOptions({ RAILWAY_ENVIRONMENT: "production" })
    ).toMatchObject({
      secure: true,
      sameSite: "none",
    });
  });

  test("never allows SameSite=None without Secure", () => {
    expect(
      buildAuthCookieOptions(
        { NODE_ENV: "development" },
        { sameSite: "none", secure: false }
      )
    ).toMatchObject({
      sameSite: "none",
      secure: true,
    });
  });

  test("clear-cookie options match auth cookie security without maxAge", () => {
    expect(
      buildClearAuthCookieOptions({ RAILWAY_ENVIRONMENT_NAME: "staging" })
    ).toEqual({
      httpOnly: true,
      secure: true,
      sameSite: "none",
      path: "/",
    });
  });

  test("SuccessHandler uses the shared auth cookie policy", () => {
    const previousRailwayEnvironmentName = process.env.RAILWAY_ENVIRONMENT_NAME;
    process.env.RAILWAY_ENVIRONMENT_NAME = "staging";

    const res = {
      cookie: jest.fn(),
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
    };

    try {
      SuccessHandler({ ok: true }, 200, res, {
        cookieName: "userToken",
        cookieValue: "token",
      });
    } finally {
      if (previousRailwayEnvironmentName === undefined) {
        delete process.env.RAILWAY_ENVIRONMENT_NAME;
      } else {
        process.env.RAILWAY_ENVIRONMENT_NAME =
          previousRailwayEnvironmentName;
      }
    }

    expect(res.cookie).toHaveBeenCalledWith(
      "userToken",
      "token",
      expect.objectContaining({
        httpOnly: true,
        secure: true,
        sameSite: "none",
        path: "/",
      })
    );
    expect(res.status).toHaveBeenCalledWith(200);
  });
});
