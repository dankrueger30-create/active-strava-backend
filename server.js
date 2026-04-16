import express from "express";
import cors from "cors";

const app = express();
const port = process.env.PORT || 3000;

app.use(cors());
app.use(express.json());

app.get("/", (_req, res) => {
  res.json({
    ok: true,
    message: "ACTIVE Strava Backend läuft"
  });
});

app.get("/health", (_req, res) => {
  res.json({
    ok: true,
    uptime: process.uptime()
  });
});


// =============================
// STRAVA OAUTH (NEU!)
// =============================
app.post("/strava/exchange", async (req, res) => {
  try {
    const code = req.body?.code;

    if (!code) {
      return res.status(400).json({
        ok: false,
        error: "code fehlt"
      });
    }

    const params = new URLSearchParams();
    params.append("client_id", process.env.STRAVA_CLIENT_ID);
    params.append("client_secret", process.env.STRAVA_CLIENT_SECRET);
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

    if (!stravaResponse.ok) {
      console.error("STRAVA EXCHANGE ERROR:", stravaResponse.status, rawText);

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


// =============================
// STRAVA ACTIVITIES
// =============================
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

    if (!stravaResponse.ok) {
      console.error("STRAVA ERROR:", stravaResponse.status, rawText);

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
        distanceMeters: activity.distance || 0,
        movingTimeSeconds: activity.moving_time || 0,
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
    console.error("BACKEND ERROR:", error);

    return res.status(500).json({
      ok: false,
      error: "Interner Serverfehler",
      details: error instanceof Error ? error.message : String(error)
    });
  }
});


app.listen(port, () => {
  console.log(`ACTIVE backend läuft auf Port ${port}`);
});
