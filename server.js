require("dotenv").config();
const express = require("express");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 10000;

const STRAVA_CLIENT_ID = process.env.STRAVA_CLIENT_ID || "223394";
const STRAVA_CLIENT_SECRET = process.env.STRAVA_CLIENT_SECRET || "";
const APP_REDIRECT_SCHEME = "active://strava";
const RENDER_REDIRECT_URI =
  process.env.STRAVA_REDIRECT_URI ||
  "https://active-strava-backend.onrender.com/strava/callback";

// ✅ DEINE MAIL HIER DRIN
const APP_USER_AGENT =
  process.env.APP_USER_AGENT ||
  "ACTIVE/1.0 (contact: dan.krueger30@gmail.com)";

// Cache
const reverseGeoCache = new Map();

// 1 Request pro Sekunde
let lastNominatimRequestAt = 0;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForNominatimSlot() {
  const now = Date.now();
  const diff = now - lastNominatimRequestAt;

  if (diff < 1000) {
    await sleep(1000 - diff);
  }

  lastNominatimRequestAt = Date.now();
}

app.get("/", (req, res) => {
  res.send("ACTIVE Backend läuft");
});

// ----------------------
// STRAVA REDIRECT
// ----------------------
app.get("/strava/callback", (req, res) => {
  const { code, error } = req.query;

  if (error) {
    return res.redirect(`${APP_REDIRECT_SCHEME}?error=${encodeURIComponent(error)}`);
  }

  if (!code) {
    return res.redirect(`${APP_REDIRECT_SCHEME}?error=missing_code`);
  }

  return res.redirect(`${APP_REDIRECT_SCHEME}?code=${encodeURIComponent(code)}`);
});

// ----------------------
// TOKEN EXCHANGE
// ----------------------
app.post("/strava/exchange", async (req, res) => {
  try {
    const { code } = req.body;

    if (!code) {
      return res.status(400).json({
        ok: false,
        error: "Code fehlt"
      });
    }

    const params = new URLSearchParams();
    params.append("client_id", STRAVA_CLIENT_ID);
    params.append("client_secret", STRAVA_CLIENT_SECRET);
    params.append("code", code);
    params.append("grant_type", "authorization_code");
    params.append("redirect_uri", RENDER_REDIRECT_URI);

    const response = await fetch("https://www.strava.com/oauth/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept": "application/json"
      },
      body: params.toString()
    });

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        ok: false,
        error: data.message || "Strava Exchange fehlgeschlagen"
      });
    }

    return res.json({
      ok: true,
      athleteId: data.athlete?.id ?? null,
      athleteName: `${data.athlete?.firstname ?? ""} ${data.athlete?.lastname ?? ""}`.trim(),
      accessToken: data.access_token ?? "",
      refreshToken: data.refresh_token ?? "",
      expiresAt: data.expires_at ?? 0
    });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: e.message || "Serverfehler"
    });
  }
});

// ----------------------
// DETAIL FETCH
// ----------------------
async function fetchActivityDetail(activityId, accessToken) {
  try {
    const response = await fetch(
      `https://www.strava.com/api/v3/activities/${activityId}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json"
        }
      }
    );

    if (!response.ok) return null;

    return await response.json();
  } catch {
    return null;
  }
}

// ----------------------
// KOORDINATEN
// ----------------------
function extractStartLatLng(activity, detail) {
  const latlng =
    detail?.start_latlng || activity?.start_latlng || null;

  return {
    startLatitude: latlng?.[0] ?? 0,
    startLongitude: latlng?.[1] ?? 0
  };
}

// ----------------------
// STRAVA ORT
// ----------------------
function buildLocationNameFromStrava(activity, detail) {
  const city = detail?.location_city || activity?.location_city || "";
  const state = detail?.location_state || activity?.location_state || "";
  const country = detail?.location_country || activity?.location_country || "";

  return [city, state, country].filter(Boolean).join(", ");
}

// ----------------------
// NOMINATIM
// ----------------------
function hasValidCoordinates(lat, lon) {
  return lat !== 0 || lon !== 0;
}

function buildLocationNameFromAddress(address = {}) {
  const city =
    address.city ||
    address.town ||
    address.village ||
    "";

  const region = address.state || "";
  const country = address.country || "";

  return [city, region, country].filter(Boolean).join(", ");
}

async function reverseGeocodeLocation(lat, lon) {
  if (!hasValidCoordinates(lat, lon)) return "";

  const cacheKey = `${lat.toFixed(5)},${lon.toFixed(5)}`;
  if (reverseGeoCache.has(cacheKey)) {
    return reverseGeoCache.get(cacheKey);
  }

  await waitForNominatimSlot();

  try {
    const url =
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}`;

    const response = await fetch(url, {
      headers: {
        "User-Agent": APP_USER_AGENT
      }
    });

    if (!response.ok) return "";

    const data = await response.json();
    const name = buildLocationNameFromAddress(data.address);

    reverseGeoCache.set(cacheKey, name);

    return name;
  } catch {
    return "";
  }
}

// ----------------------
// ACTIVITIES
// ----------------------
app.post("/strava/activities", async (req, res) => {
  try {
    const { accessToken } = req.body;

    if (!accessToken) {
      return res.status(400).json({
        ok: false,
        error: "Access Token fehlt"
      });
    }

    const response = await fetch(
      "https://www.strava.com/api/v3/athlete/activities?per_page=5",
      {
        headers: {
          Authorization: `Bearer ${accessToken}`
        }
      }
    );

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        ok: false,
        error: "Strava Fehler"
      });
    }

    const activities = [];

    for (const activity of data) {
      const detail = await fetchActivityDetail(activity.id, accessToken);

      const { startLatitude, startLongitude } =
        extractStartLatLng(activity, detail);

      let locationName =
        buildLocationNameFromStrava(activity, detail);

      if (!locationName) {
        locationName = await reverseGeocodeLocation(
          startLatitude,
          startLongitude
        );
      }

      console.log("FINAL LOCATION CHECK", {
        id: activity.id,
        locationName
      });

      activities.push({
        id: activity.id,
        name: activity.name,
        sportType: activity.sport_type,
        distanceMeters: activity.distance,
        movingTimeSeconds: activity.moving_time,
        elevationMeters: activity.total_elevation_gain,
        calories: activity.calories || 0,
        startDate: activity.start_date,
        routePolyline:
          detail?.map?.summary_polyline ||
          activity?.map?.summary_polyline ||
          "",
        startLatitude,
        startLongitude,
        locationName
      });
    }

    res.json({ ok: true, activities });
  } catch (e) {
    res.status(500).json({
      ok: false,
      error: e.message
    });
  }
});

app.listen(PORT, () => {
  console.log("Server läuft auf Port " + PORT);
});
