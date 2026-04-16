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
