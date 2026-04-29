const jwt = require("jsonwebtoken");
const {
  isAuthenticated,
  tryAuthenticate,
} = require("../middleware/auth");
const {
  connectCommerceTestDatabase,
  disconnectCommerceTestDatabase,
  createCommerceFixture,
} = require("./helpers/commerceFixture");

const createClientToken = (client, businessId) =>
  jwt.sign(
    {
      id: client._id,
      role: "client",
      type: "client",
      businessId: businessId.toString(),
    },
    process.env.JWT_SECRET
  );

const createReq = ({ path, cookies = {}, headers = {} }) => ({
  originalUrl: path,
  url: path,
  path,
  cookies,
  headers,
});

const createRes = () => ({
  statusCode: 200,
  body: null,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(payload) {
    this.body = payload;
    return this;
  },
});

const runMiddleware = async (middleware, req) => {
  const res = createRes();
  let nextCalled = false;

  await middleware(req, res, () => {
    nextCalled = true;
  });

  return { req, res, nextCalled };
};

const runRequiredAuth = (requestOptions) =>
  runMiddleware(isAuthenticated, createReq(requestOptions));

const createAuthFixture = async (ownerEmail, businessName) => {
  const fixture = await createCommerceFixture({
    ownerEmail,
    businessName,
  });

  return {
    fixture,
    clientToken: createClientToken(fixture.client, fixture.business._id),
  };
};

const expectAuthSession = (req, expected) => {
  expect(req.authSession).toMatchObject(expected);
};

beforeAll(async () => {
  await connectCommerceTestDatabase();
});

afterAll(async () => {
  await disconnectCommerceTestDatabase();
});

describe("Auth session consolidation v1", () => {
  test("accepts clientToken cookie on shared auth routes without a context hint", async () => {
    const { clientToken } = await createAuthFixture(
      "auth-session-client-cookie-owner@example.com",
      "Auth Session Client Cookie Shop"
    );

    const { req, res, nextCalled } = await runRequiredAuth({
      path: "/auth/me",
      cookies: { clientToken },
    });

    expect(res.statusCode).toBe(200);
    expect(nextCalled).toBe(true);
    expect(req.user).toMatchObject({
      role: "client",
      type: "client",
    });
    expectAuthSession(req, {
      authenticated: true,
      source: "cookie:clientToken",
      cookieName: "clientToken",
      routeType: "shared",
      authSubjectType: "client",
    });
  });

  test("keeps userToken as default on shared auth routes when multiple cookies exist", async () => {
    const { fixture, clientToken } = await createAuthFixture(
      "auth-session-default-user-owner@example.com",
      "Auth Session Default User Shop"
    );

    const { req, res, nextCalled } = await runRequiredAuth({
      path: "/auth/me",
      cookies: {
        clientToken,
        userToken: fixture.token,
      },
    });

    expect(res.statusCode).toBe(200);
    expect(nextCalled).toBe(true);
    expect(req.user).toMatchObject({
      id: fixture.owner._id.toString(),
      role: "barber",
      type: "barber",
    });
    expectAuthSession(req, {
      source: "cookie:userToken",
      routeType: "shared",
      authSubjectType: "user",
    });
  });

  test("honors x-user-context client on shared auth routes", async () => {
    const { fixture, clientToken } = await createAuthFixture(
      "auth-session-client-hint-owner@example.com",
      "Auth Session Client Hint Shop"
    );

    const { req, res, nextCalled } = await runRequiredAuth({
      path: "/auth/me",
      cookies: {
        userToken: fixture.token,
        clientToken,
      },
      headers: { "x-user-context": "client" },
    });

    expect(res.statusCode).toBe(200);
    expect(nextCalled).toBe(true);
    expect(req.user).toMatchObject({
      role: "client",
      type: "client",
    });
    expectAuthSession(req, {
      source: "cookie:clientToken",
      userContextHint: "client",
      authSubjectType: "client",
    });
  });

  test("does not let clientToken cookies authenticate business routes", async () => {
    const { clientToken } = await createAuthFixture(
      "auth-session-business-guard-owner@example.com",
      "Auth Session Business Guard Shop"
    );

    const { res, nextCalled } = await runRequiredAuth({
      path: "/business/probe",
      cookies: { clientToken },
      headers: { "x-user-context": "client" },
    });

    expect(nextCalled).toBe(false);
    expect(res.statusCode).toBe(401);
    expect(res.body).toMatchObject({
      success: false,
      message: "Not logged in",
    });
  });

  test("keeps optional auth deterministic and non-blocking", async () => {
    const { fixture, clientToken } = await createAuthFixture(
      "auth-session-optional-owner@example.com",
      "Auth Session Optional Shop"
    );

    const authenticated = await runMiddleware(
      tryAuthenticate,
      createReq({
        path: "/appointments/available",
        cookies: {
          userToken: fixture.token,
          clientToken,
        },
      })
    );

    expect(authenticated.nextCalled).toBe(true);
    expectAuthSession(authenticated.req, {
      authenticated: true,
      source: "cookie:clientToken",
      routeType: "optional",
      authSubjectType: "client",
    });

    const anonymous = await runMiddleware(
      tryAuthenticate,
      createReq({ path: "/appointments/available" })
    );

    expect(anonymous.nextCalled).toBe(true);
    expect(anonymous.req.user).toBeUndefined();
    expectAuthSession(anonymous.req, {
      authenticated: false,
      routeType: "optional",
    });
  });
});
