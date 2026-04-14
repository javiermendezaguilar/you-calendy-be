import http from "k6/http";
import { check, sleep } from "k6";

const apiBaseUrl = (__ENV.API_BASE_URL || "https://api.groomnest.com").replace(
  /\/$/,
  ""
);
const barberEmail = __ENV.K6_BARBER_EMAIL;
const barberPassword = __ENV.K6_BARBER_PASSWORD;

export const options = {
  vus: Number(__ENV.K6_VUS || 3),
  duration: __ENV.K6_DURATION || "20s",
  thresholds: {
    http_req_failed: ["rate<0.05"],
    http_req_duration: ["p(95)<1500"],
  },
};

function probeRoot() {
  const response = http.get(`${apiBaseUrl}/`, {
    headers: {
      Accept: "text/plain,application/json",
    },
  });

  check(response, {
    "api root reachable": (res) => res.status >= 200 && res.status < 500,
  });
}

function probeAuthFlow() {
  if (!barberEmail || !barberPassword) {
    console.log(
      "K6_BARBER_EMAIL/K6_BARBER_PASSWORD absent: skipping authenticated probe"
    );
    return;
  }

  const loginResponse = http.post(
    `${apiBaseUrl}/auth/login`,
    JSON.stringify({
      email: barberEmail,
      password: barberPassword,
      userType: "user",
    }),
    {
      headers: {
        "Content-Type": "application/json",
      },
    }
  );

  check(loginResponse, {
    "login returns 200": (res) => res.status === 200,
    "login returns token": (res) => Boolean(res.json("token")),
  });

  const token = loginResponse.json("token");
  if (!token) {
    return;
  }

  const meResponse = http.get(`${apiBaseUrl}/auth/me`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  check(meResponse, {
    "auth me returns 200": (res) => res.status === 200,
  });
}

export default function () {
  probeRoot();
  probeAuthFlow();
  sleep(1);
}
