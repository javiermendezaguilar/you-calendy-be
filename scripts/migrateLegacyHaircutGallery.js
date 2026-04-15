#!/usr/bin/env node

const mongoose = require("mongoose");
const Client = require("../src/models/client");
const HaircutGallery = require("../src/models/haircutGallery");

function parseArgs(argv) {
  const args = {
    apply: false,
    businessId: process.env.MIGRATION_BUSINESS_ID || "68dd01b0672b2d6c4d2e8954",
    legacyBaseUrl:
      process.env.LEGACY_API_BASE_URL || "https://you-calendy-be.up.railway.app",
    origin: process.env.MIGRATION_ORIGIN || "https://groomnest.com",
    barberEmail: process.env.MIGRATION_BARBER_EMAIL || process.env.SMOKE_BARBER_EMAIL,
    barberPassword:
      process.env.MIGRATION_BARBER_PASSWORD || process.env.SMOKE_BARBER_PASSWORD,
    clientIds: [],
    limit: null,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--apply") {
      args.apply = true;
    } else if (arg === "--business-id") {
      args.businessId = argv[++i];
    } else if (arg === "--legacy-base-url") {
      args.legacyBaseUrl = argv[++i];
    } else if (arg === "--origin") {
      args.origin = argv[++i];
    } else if (arg === "--barber-email") {
      args.barberEmail = argv[++i];
    } else if (arg === "--barber-password") {
      args.barberPassword = argv[++i];
    } else if (arg === "--client-id") {
      args.clientIds.push(argv[++i]);
    } else if (arg === "--limit") {
      args.limit = Number.parseInt(argv[++i], 10);
    }
  }

  return args;
}

function normalizeEmail(value) {
  return (value || "").trim().toLowerCase();
}

function normalizePhoneComparable(value) {
  const digits = String(value || "").replace(/\D/g, "");
  return digits.length > 10 ? digits.slice(-10) : digits;
}

function normalizeName(firstName, lastName) {
  return `${firstName || ""} ${lastName || ""}`.trim().toLowerCase();
}

async function jsonFetch(url, options = {}) {
  const response = await fetch(url, options);
  const json = await response.json();
  if (!response.ok) {
    const message = json?.message || `HTTP ${response.status} on ${url}`;
    throw new Error(message);
  }
  return json;
}

async function loginToLegacy({ legacyBaseUrl, barberEmail, barberPassword, origin }) {
  const login = await jsonFetch(`${legacyBaseUrl}/auth/login`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: origin,
    },
    body: JSON.stringify({
      email: barberEmail,
      password: barberPassword,
      userType: "user",
    }),
  });

  const token = login?.data?.token;
  if (!token) {
    throw new Error("Legacy login returned no token");
  }

  return token;
}

async function fetchLegacyClients({ legacyBaseUrl, token, origin }) {
  const response = await jsonFetch(`${legacyBaseUrl}/business/clients?limit=500`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Origin: origin,
    },
  });

  return response?.data?.clients || [];
}

async function fetchLegacyGallery({ legacyBaseUrl, token, origin, clientId }) {
  const response = await jsonFetch(
    `${legacyBaseUrl}/business/clients/${clientId}/gallery`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Origin: origin,
      },
    }
  );

  const data = response?.data || {};
  const gallery = data.gallery || data.images || data.items || [];
  return Array.isArray(gallery) ? gallery : [];
}

function buildCanonicalClientIndexes(clients) {
  const byEmail = new Map();
  const byPhoneComparable = new Map();
  const byName = new Map();

  for (const client of clients) {
    const email = normalizeEmail(client.email);
    const phoneComparable = client.phoneComparable || normalizePhoneComparable(client.phone);
    const name = normalizeName(client.firstName, client.lastName);

    if (email) {
      if (!byEmail.has(email)) byEmail.set(email, []);
      byEmail.get(email).push(client);
    }

    if (phoneComparable) {
      if (!byPhoneComparable.has(phoneComparable)) byPhoneComparable.set(phoneComparable, []);
      byPhoneComparable.get(phoneComparable).push(client);
    }

    if (name) {
      if (!byName.has(name)) byName.set(name, []);
      byName.get(name).push(client);
    }
  }

  return { byEmail, byPhoneComparable, byName };
}

function resolveCanonicalClient(legacyClient, indexes) {
  const email = normalizeEmail(legacyClient.email);
  if (email) {
    const matches = indexes.byEmail.get(email) || [];
    if (matches.length === 1) {
      return { client: matches[0], strategy: "email", ambiguous: false };
    }
    if (matches.length > 1) {
      return { client: null, strategy: "email", ambiguous: true };
    }
  }

  const phoneComparable = normalizePhoneComparable(
    legacyClient.phoneComparable || legacyClient.phone
  );
  if (phoneComparable) {
    const matches = indexes.byPhoneComparable.get(phoneComparable) || [];
    if (matches.length === 1) {
      return { client: matches[0], strategy: "phoneComparable", ambiguous: false };
    }
    if (matches.length > 1) {
      return { client: null, strategy: "phoneComparable", ambiguous: true };
    }
  }

  const name = normalizeName(legacyClient.firstName, legacyClient.lastName);
  if (name) {
    const matches = indexes.byName.get(name) || [];
    if (matches.length === 1) {
      return { client: matches[0], strategy: "fullName", ambiguous: false };
    }
    if (matches.length > 1) {
      return { client: null, strategy: "fullName", ambiguous: true };
    }
  }

  return { client: null, strategy: null, ambiguous: false };
}

function mapSuggestion(suggestion, canonicalClientId) {
  return {
    note: suggestion.note,
    imageUrl: suggestion.imageUrl || null,
    imagePublicId: suggestion.imagePublicId || null,
    createdBy:
      String(suggestion.createdBy || "") && String(suggestion.createdBy) === String(canonicalClientId)
        ? canonicalClientId
        : undefined,
    response: suggestion.response || undefined,
    respondedBy: undefined,
    respondedAt: suggestion.respondedAt || undefined,
    createdAt: suggestion.createdAt || undefined,
  };
}

function mapReport(report, canonicalClientId) {
  return {
    note: report.note,
    imageUrl: report.imageUrl || null,
    imagePublicId: report.imagePublicId || null,
    rating: report.rating,
    reportType: report.reportType || "other",
    createdBy:
      String(report.createdBy || "") && String(report.createdBy) === String(canonicalClientId)
        ? canonicalClientId
        : undefined,
    status: report.status || "pending",
    reviewNote: report.reviewNote || undefined,
    reviewedBy: undefined,
    reviewedAt: report.reviewedAt || undefined,
    createdAt: report.createdAt || undefined,
  };
}

async function existsCanonicalGallery({ businessId, clientId, legacyGallery }) {
  return HaircutGallery.exists({
    business: businessId,
    client: clientId,
    imageUrl: legacyGallery.imageUrl,
    title: legacyGallery.title || "New Haircut Photo",
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (!process.env.MONGO_URI) {
    throw new Error("MONGO_URI is required");
  }
  if (!args.barberEmail || !args.barberPassword) {
    throw new Error("Barber credentials are required");
  }

  const legacyToken = await loginToLegacy(args);
  await mongoose.connect(process.env.MONGO_URI);

  try {
    const canonicalClients = await Client.find({
      business: args.businessId,
      isActive: true,
    })
      .select("_id firstName lastName email phone phoneComparable business")
      .lean();

    const indexes = buildCanonicalClientIndexes(canonicalClients);
    let legacyClients = await fetchLegacyClients({
      legacyBaseUrl: args.legacyBaseUrl,
      token: legacyToken,
      origin: args.origin,
    });

    if (args.clientIds.length > 0) {
      const clientIdSet = new Set(args.clientIds.map(String));
      legacyClients = legacyClients.filter((client) => clientIdSet.has(String(client._id)));
    }

    if (Number.isInteger(args.limit) && args.limit > 0) {
      legacyClients = legacyClients.slice(0, args.limit);
    }

    const summary = {
      dryRun: !args.apply,
      businessId: args.businessId,
      legacyClientCount: legacyClients.length,
      inspectedGalleryClients: 0,
      plannedInserts: 0,
      inserted: 0,
      skippedNoGallery: 0,
      skippedExisting: 0,
      unmatchedClients: [],
      ambiguousClients: [],
      inserts: [],
    };

    for (const legacyClient of legacyClients) {
      const legacyGallery = await fetchLegacyGallery({
        legacyBaseUrl: args.legacyBaseUrl,
        token: legacyToken,
        origin: args.origin,
        clientId: legacyClient._id,
      });

      if (!legacyGallery.length) {
        summary.skippedNoGallery += 1;
        continue;
      }

      summary.inspectedGalleryClients += 1;

      const resolved = resolveCanonicalClient(legacyClient, indexes);
      if (!resolved.client) {
        const target = {
          legacyClientId: String(legacyClient._id),
          name: `${legacyClient.firstName || ""} ${legacyClient.lastName || ""}`.trim(),
          email: legacyClient.email || null,
          phone: legacyClient.phone || null,
          galleryCount: legacyGallery.length,
        };

        if (resolved.ambiguous) {
          summary.ambiguousClients.push({ ...target, strategy: resolved.strategy });
        } else {
          summary.unmatchedClients.push(target);
        }
        continue;
      }

      for (const galleryItem of legacyGallery) {
        const alreadyExists = await existsCanonicalGallery({
          businessId: args.businessId,
          clientId: resolved.client._id,
          legacyGallery: galleryItem,
        });

        if (alreadyExists) {
          summary.skippedExisting += 1;
          continue;
        }

        const payload = {
          business: resolved.client.business,
          client: resolved.client._id,
          title: galleryItem.title || "New Haircut Photo",
          description: galleryItem.description || undefined,
          haircutStyle: galleryItem.haircutStyle || undefined,
          imageUrl: galleryItem.imageUrl,
          imagePublicId: galleryItem.imagePublicId || undefined,
          isActive: galleryItem.isActive !== false,
          suggestions: (galleryItem.suggestions || []).map((item) =>
            mapSuggestion(item, resolved.client._id)
          ),
          reports: (galleryItem.reports || []).map((item) =>
            mapReport(item, resolved.client._id)
          ),
          createdAt: galleryItem.createdAt || undefined,
          updatedAt: galleryItem.updatedAt || undefined,
        };

        summary.plannedInserts += 1;
        summary.inserts.push({
          legacyClientId: String(legacyClient._id),
          canonicalClientId: String(resolved.client._id),
          strategy: resolved.strategy,
          name: `${legacyClient.firstName || ""} ${legacyClient.lastName || ""}`.trim(),
          title: payload.title,
          imageUrl: payload.imageUrl,
          suggestions: payload.suggestions.length,
          reports: payload.reports.length,
        });

        if (args.apply) {
          await HaircutGallery.create(payload);
          summary.inserted += 1;
        }
      }
    }

    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
