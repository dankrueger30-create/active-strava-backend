require("dotenv").config();
const express = require("express");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 10000;

const STRAVA_CLIENT_ID = process.env.STRAVA_CLIENT_ID;
const STRAVA_CLIENT_SECRET = process.env.STRAVA_CLIENT_SECRET;
const APP_REDIRECT_SCHEME = process.env.APP_REDIRECT_SCHEME || "active://strava";

app.get("/", (req, res) => {
  res.send("ACTIVE Backend läuft");
});

app.get("/strava/callback", (req, res) => {
  const { code, error } = req.query;

  console.log("CALLBACK:", {
    hasCode: !!code,
    error: error || null
  });

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

    console.log("EXCHANGE START:", {
      hasCode: !!code,
      clientId: STRAVA_CLIENT_ID,
      hasClientSecret: !!STRAVA_CLIENT_SECRET
    });

    if (!code) {
      return res.status(400).json({
        ok: false,
        error: "Code fehlt"
      });
    }

    if (!STRAVA_CLIENT_ID || !STRAVA_CLIENT_SECRET) {
      return res.status(500).json({
        ok: false,
        error: "STRAVA_CLIENT_ID oder STRAVA_CLIENT_SECRET fehlt in Render"
      });
    }

    const params = new URLSearchParams();
    params.append("client_id", String(STRAVA_CLIENT_ID));
    params.append("client_secret", String(STRAVA_CLIENT_SECRET));
    params.append("code", String(code));
    params.append("grant_type", "authorization_code");

    console.log("STRAVA REQUEST BODY:", params.toString().replace(STRAVA_CLIENT_SECRET, "***"));

    const response = await fetch("https://www.strava.com/oauth/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Accept": "application/json"
      },
      body: params.toString()
    });

    const data = await response.json();

    console.log("STRAVA RESPONSE STATUS:", response.status);
    console.log("STRAVA RESPONSE BODY:", JSON.stringify(data));

    if (!response.ok) {
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
    console.log("EXCHANGE ERROR:", e);
    return res.status(500).json({
      ok: false,
      error: e.message || "Serverfehler"
    });
  }
});

app.post("/strava/activities", async (req, res) => {
  try {
    const { accessToken } = req.body;

    console.log("ACTIVITIES START:", {
      hasAccessToken: !!accessToken
    });

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

    console.log("ACTIVITIES RESPONSE STATUS:", response.status);

    if (!response.ok) {
      console.log("ACTIVITIES RESPONSE BODY:", JSON.stringify(data));
      return res.status(response.status).json({
        ok: false,
        error: data.message || "Aktivitäten konnten nicht geladen werden",
        details: data
      });
    }

    const activities = Array.isArray(data)
      ? data.map((activity) => ({
          id: activity.id ?? 0,
          name: activity.name || "",
          sportType: activity.sport_type || activity.type || "Aktivität",
          distanceMeters: activity.distance || 0,
          movingTimeSeconds: activity.moving_time || 0,
          elevationMeters: activity.total_elevation_gain || 0,
          calories: activity.calories || 0,
          startDate: activity.start_date || ""
        }))
      : [];

    return res.json({
      ok: true,
      activities
    });
  } catch (e) {
    console.log("ACTIVITIES ERROR:", e);
    return res.status(500).json({
      ok: false,
      error: e.message || "Serverfehler"
    });
  }
});

app.listen(PORT, () => {
  console.log("Server läuft auf Port " + PORT);
});
