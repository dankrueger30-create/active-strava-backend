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

// Für Nominatim: echter User-Agent ist Pflicht
const APP_USER_AGENT =
  process.env.APP_USER_AGENT ||
  "ACTIVE/1.0 (contact: active-app@example.com)";

// Einfacher In-Memory-Cache für Reverse-Geocoding
const reverseGeoCache = new Map();

// Nominatim offiziell: max. 1 Request/Sekunde
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

    console.log("EXCHANGE DEBUG", {
      clientId: STRAVA_CLIENT_ID,
      hasClientSecret: !!STRAVA_CLIENT_SECRET,
      redirectUri: RENDER_REDIRECT_URI,
      codePresent: !!code
    });

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
      console.log("STRAVA EXCHANGE ERROR STATUS:", response.status);
      console.log("STRAVA EXCHANGE ERROR DATA:", JSON.stringify(data, null, 2));

      return res.status(response.status).json({
        ok: false,
        error: data.message || "Strava Exchange fehlgeschlagen",
        details: data
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

    if (!response.ok) {
      return null;
    }

    return await response.json();
  } catch (e) {
    return null;
  }
}

function extractStartLatLng(activity, detail) {
  const fromDetail = detail?.start_latlng;
  const fromActivity = activity?.start_latlng;

  const latlng =
    Array.isArray(fromDetail) && fromDetail.length >= 2
      ? fromDetail
      : Array.isArray(fromActivity) && fromActivity.length >= 2
        ? fromActivity
        : null;

  return {
    startLatitude: latlng?.[0] ?? 0,
    startLongitude: latlng?.[1] ?? 0
  };
}

function buildLocationNameFromStrava(activity, detail) {
  const city =
    detail?.location_city ||
    activity?.location_city ||
    "";

  const state =
    detail?.location_state ||
    activity?.location_state ||
    "";

  const country =
    detail?.location_country ||
    activity?.location_country ||
    "";

  const parts = [city, state, country]
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter((value) => value.length > 0);

  return parts.join(", ");
}

function hasValidCoordinates(lat, lon) {
  return Number.isFinite(lat) && Number.isFinite(lon) && (lat !== 0 || lon !== 0);
}

function buildLocationNameFromAddress(address = {}) {
  const city =
    address.city ||
    address.town ||
    address.village ||
    address.municipality ||
    address.hamlet ||
    address.suburb ||
    "";

  const region =
    address.state ||
    address.region ||
    address.county ||
    address.state_district ||
    "";

  const country = address.country || "";

  const parts = [city, region, country]
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter((value) => value.length > 0);

  return parts.join(", ");
}

async function reverseGeocodeLocation(lat, lon) {
  if (!hasValidCoordinates(lat, lon)) {
    return "";
  }

  const cacheKey = `${lat.toFixed(5)},${lon.toFixed(5)}`;
  if (reverseGeoCache.has(cacheKey)) {
    return reverseGeoCache.get(cacheKey);
  }

  await waitForNominatimSlot();

  try {
    const url =
      `https://nominatim.openstreetmap.org/reverse` +
      `?format=jsonv2&lat=${encodeURIComponent(lat)}` +
      `&lon=${encodeURIComponent(lon)}` +
      `&addressdetails=1&zoom=10`;

    const response = await fetch(url, {
      method: "GET",
      headers: {
        "Accept": "application/json",
        "User-Agent": APP_USER_AGENT
      }
    });

    if (!response.ok) {
      console.log("NOMINATIM ERROR STATUS:", response.status);
      reverseGeoCache.set(cacheKey, "");
      return "";
    }

    const data = await response.json();
    const locationName = buildLocationNameFromAddress(data?.address || {});

    reverseGeoCache.set(cacheKey, locationName);

    console.log("NOMINATIM DEBUG", {
      cacheKey,
      locationName
    });

    return locationName;
  } catch (e) {
    console.log("NOMINATIM ERROR:", e.message || e);
    reverseGeoCache.set(cacheKey, "");
    return "";
  }
}

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
      "https://www.strava.com/api/v3/athlete/activities?per_page=20",
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json"
        }
      }
    );

    const data = await response.json();

    if (!response.ok) {
      console.log("STRAVA ACTIVITIES ERROR STATUS:", response.status);
      console.log("STRAVA ACTIVITIES ERROR DATA:", JSON.stringify(data, null, 2));

      return res.status(response.status).json({
        ok: false,
        error: data.message || "Aktivitäten konnten nicht geladen werden",
        details: data
      });
    }

    const activityList = Array.isArray(data) ? data : [];
    const activities = [];

    // bewusst sequenziell: schont Nominatim
    for (const activity of activityList) {
      const detail = await fetchActivityDetail(activity.id, accessToken);

      const summaryPolyline =
        detail?.map?.summary_polyline ||
        activity?.map?.summary_polyline ||
        "";

      const { startLatitude, startLongitude } = extractStartLatLng(activity, detail);

      let locationName = buildLocationNameFromStrava(activity, detail);

      console.log("LOCATION DEBUG RAW", {
        id: activity.id,
        activity_city: activity?.location_city || "",
        activity_state: activity?.location_state || "",
        activity_country: activity?.location_country || "",
        detail_city: detail?.location_city || "",
        detail_state: detail?.location_state || "",
        detail_country: detail?.location_country || "",
        startLatitude,
        startLongitude
      });

      if (!locationName && hasValidCoordinates(startLatitude, startLongitude)) {
        locationName = await reverseGeocodeLocation(startLatitude, startLongitude);
      }

      console.log("LOCATION DEBUG FINAL", {
        id: activity.id,
        name: activity.name || "",
        locationName
      });

      activities.push({
        id: activity.id ?? 0,
        name: activity.name || "",
        sportType: activity.sport_type || activity.type || "Aktivität",
        distanceMeters: activity.distance || 0,
        movingTimeSeconds: activity.moving_time || 0,
        elevationMeters: activity.total_elevation_gain || 0,
        calories: activity.calories || 0,
        startDate: activity.start_date || "",
        routePolyline: summaryPolyline,
        startLatitude,
        startLongitude,
        locationName
      });
    }

    return res.json({
      ok: true,
      activities
    });
  } catch (e) {
    return res.status(500).json({
      ok: false,
      error: e.message || "Serverfehler"
    });
  }
});

console.log("CLIENT_ID vorhanden:", !!STRAVA_CLIENT_ID);
console.log("CLIENT_SECRET vorhanden:", !!STRAVA_CLIENT_SECRET);
console.log("REDIRECT_URI:", RENDER_REDIRECT_URI);

app.listen(PORT, () => {
  console.log("Server läuft auf Port " + PORT);
});
