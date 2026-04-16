import express from "express";
import cors from "cors";

const app = express();
const port = process.env.PORT || 3000;

const STRAVA_CLIENT_ID = process.env.STRAVA_CLIENT_ID || "223394";
const STRAVA_CLIENT_SECRET = process.env.STRAVA_CLIENT_SECRET || "";
const APP_REDIRECT_SCHEME = "active://strava";
const RENDER_REDIRECT_URI =
  process.env.STRAVA_REDIRECT_URI ||
  "https://active-strava-backend.onrender.com/strava/callback";

app.use(cors());
app.use(express.json());

app.get("/", (req, res) => {
  res.send("ACTIVE Backend läuft");
});

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    service: "ACTIVE Strava Backend",
    uptime: process.uptime(),
    redirectUri: RENDER_REDIRECT_URI
  });
});

/**
 * STRAVA CALLBACK
 * Strava leitet nach Login hierhin zurück.
 * Danach leiten wir direkt wieder in die App um:
 * active://strava?code=...
 */
app.get("/strava/callback", (req, res) => {
  try {
    const code = req.query.code;
    const error = req.query.error;
    const scope = req.query.scope;

    if (error) {
      const redirectUrl =
        `${APP_REDIRECT_SCHEME}?error=${encodeURIComponent(String(error))}`;
      return res.redirect(redirectUrl);
    }

    if (!code) {
      const redirectUrl =
        `${APP_REDIRECT_SCHEME}?error=${encodeURIComponent("missing_code")}`;
      return res.redirect(redirectUrl);
    }

    let redirectUrl =
      `${APP_REDIRECT_SCHEME}?code=${encodeURIComponent(String(code))}`;

    if (scope) {
      redirectUrl += `&scope=${encodeURIComponent(String(scope))}`;
    }

    return res.redirect(redirectUrl);
  } catch (error) {
    console.error("CALLBACK ERROR:", error);

    const redirectUrl =
      `${APP_REDIRECT_SCHEME}?error=${encodeURIComponent("callback_failed")}`;
    return res.redirect(redirectUrl);
  }
});

/**
 * CODE -> TOKEN TAUSCH
 * Android App schickt den Code hierhin,
 * Backend spricht mit Strava und gibt Token zurück.
 */
app.post("/strava/exchange", async (req, res) => {
  try {
    const code = req.body?.code;

    if (!code) {
      return res.status(400).json({
        ok: false,
        error: "code fehlt"
      });
    }

    if (!STRAVA_CLIENT_ID || !STRAVA_CLIENT_SECRET) {
      return res.status(500).json({
        ok: false,
        error: "Strava ENV Variablen fehlen"
      });
    }

    const params = new URLSearchParams();
    params.append("client_id", STRAVA_CLIENT_ID);
    params.append("client_secret", STRAVA_CLIENT_SECRET);
    params.append("code", code);
    params.append("grant_type", "authorization_code");

    const stravaResponse = await fetch("https://www.strava.com/oauth/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept": "application/json"
      },
      body: params.toString()
    });

    const rawText = await stravaResponse.text();

    console.log("STRAVA EXCHANGE STATUS:", stravaResponse.status);
    console.log("STRAVA EXCHANGE RAW:", rawText);

    if (!stravaResponse.ok) {
      return res.status(stravaResponse.status).json({
        ok: false,
        error: "Strava Token Austausch fehlgeschlagen",
        status: stravaResponse.status,
        body: rawText
      });
    }

    const data = JSON.parse(rawText);

    return res.json({
      ok: true,
      access_token: data.access_token || "",
      refresh_token: data.refresh_token || "",
      expires_at: data.expires_at || 0,
      athlete: data.athlete || {}
    });
  } catch (error) {
    console.error("EXCHANGE BACKEND ERROR:", error);

    return res.status(500).json({
      ok: false,
      error: "Interner Serverfehler",
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

/**
 * OPTIONAL: TOKEN REFRESH
 * Falls du später automatischen Refresh brauchst.
 */
app.post("/strava/refresh", async (req, res) => {
  try {
    const refreshToken = req.body?.refreshToken;

    if (!refreshToken) {
      return res.status(400).json({
        ok: false,
        error: "refreshToken fehlt"
      });
    }

    if (!STRAVA_CLIENT_ID || !STRAVA_CLIENT_SECRET) {
      return res.status(500).json({
        ok: false,
        error: "Strava ENV Variablen fehlen"
      });
    }

    const params = new URLSearchParams();
    params.append("client_id", STRAVA_CLIENT_ID);
    params.append("client_secret", STRAVA_CLIENT_SECRET);
    params.append("grant_type", "refresh_token");
    params.append("refresh_token", refreshToken);

    const stravaResponse = await fetch("https://www.strava.com/oauth/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept": "application/json"
      },
      body: params.toString()
    });

    const rawText = await stravaResponse.text();

    console.log("STRAVA REFRESH STATUS:", stravaResponse.status);
    console.log("STRAVA REFRESH RAW:", rawText);

    if (!stravaResponse.ok) {
      return res.status(stravaResponse.status).json({
        ok: false,
        error: "Strava Token Refresh fehlgeschlagen",
        status: stravaResponse.status,
        body: rawText
      });
    }

    const data = JSON.parse(rawText);

    return res.json({
      ok: true,
      access_token: data.access_token || "",
      refresh_token: data.refresh_token || "",
      expires_at: data.expires_at || 0,
      athlete: data.athlete || {}
    });
  } catch (error) {
    console.error("REFRESH BACKEND ERROR:", error);

    return res.status(500).json({
      ok: false,
      error: "Interner Serverfehler",
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

/**
 * AKTIVITÄTEN LADEN
 * Kein Nominatim mehr.
 * Nur Strava-Daten + Koordinaten + Polyline.
 */
app.post("/strava/activities", async (req, res) => {
  try {
    const accessToken = req.body?.accessToken;

    if (!accessToken) {
      return res.status(400).json({
        ok: false,
        error: "accessToken fehlt"
      });
    }

    const stravaResponse = await fetch(
      "https://www.strava.com/api/v3/athlete/activities?per_page=30&page=1",
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json"
        }
      }
    );

    const rawText = await stravaResponse.text();

    console.log("STRAVA ACTIVITIES STATUS:", stravaResponse.status);

    if (!stravaResponse.ok) {
      console.error("STRAVA ACTIVITIES ERROR:", rawText);

      return res.status(stravaResponse.status).json({
        ok: false,
        error: "Strava API Fehler",
        status: stravaResponse.status,
        body: rawText
      });
    }

    const activities = JSON.parse(rawText);

    const mapped = activities.map((activity) => {
      const startLatLng = Array.isArray(activity.start_latlng)
        ? activity.start_latlng
        : null;

      const endLatLng = Array.isArray(activity.end_latlng)
        ? activity.end_latlng
        : null;

      const startLatitude =
        startLatLng && typeof startLatLng[0] === "number" ? startLatLng[0] : 0;

      const startLongitude =
        startLatLng && typeof startLatLng[1] === "number" ? startLatLng[1] : 0;

      const endLatitude =
        endLatLng && typeof endLatLng[0] === "number" ? endLatLng[0] : 0;

      const endLongitude =
        endLatLng && typeof endLatLng[1] === "number" ? endLatLng[1] : 0;

      const routePolyline =
        activity.map && typeof activity.map.summary_polyline === "string"
          ? activity.map.summary_polyline
          : "";

      const sportType =
        activity.sport_type ||
        activity.type ||
        "Aktivität";

      const elevationMeters =
        typeof activity.total_elevation_gain === "number"
          ? activity.total_elevation_gain
          : 0;

      const calories =
        typeof activity.kilojoules === "number"
          ? Math.round(activity.kilojoules)
          : 0;

      const activityCity = activity.location_city || "";
      const activityState = activity.location_state || "";
      const activityCountry = activity.location_country || "";

      const locationName = [activityCity, activityState, activityCountry]
        .filter(Boolean)
        .join(", ");

      console.log("LOCATION DEBUG RAW", {
        id: activity.id,
        name: activity.name,
        activity_city: activityCity,
        activity_state: activityState,
        activity_country: activityCountry,
        startLatitude,
        startLongitude
      });

      console.log("LOCATION DEBUG FINAL", {
        id: activity.id,
        name: activity.name,
        locationName
      });

      console.log("FINAL LOCATION CHECK", {
        id: activity.id,
        name: activity.name,
        startLatitude,
        startLongitude,
        locationName
      });

      return {
        id: activity.id,
        name: activity.name || "",
        sportType,
        distanceMeters: typeof activity.distance === "number" ? activity.distance : 0,
        movingTimeSeconds:
          typeof activity.moving_time === "number" ? activity.moving_time : 0,
        elevationMeters,
        calories,
        startDate: activity.start_date || "",
        startDateLocal: activity.start_date_local || "",
        routePolyline,
        startLatitude,
        startLongitude,
        endLatitude,
        endLongitude,
        locationName
      };
    });

    return res.json({
      ok: true,
      count: mapped.length,
      activities: mapped
    });
  } catch (error) {
    console.error("ACTIVITIES BACKEND ERROR:", error);

    return res.status(500).json({
      ok: false,
      error: "Interner Serverfehler",
      details: error instanceof Error ? error.message : String(error)
    });
  }
});

app.listen(port, () => {
  console.log(`ACTIVE backend läuft auf Port ${port}`);
  console.log(`Redirect URI: ${RENDER_REDIRECT_URI}`);
});
