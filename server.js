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

    const response = await fetch("https://www.strava.com/oauth/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: params.toString()
    });

    const data = await response.json();

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
    return res.status(500).json({
      ok: false,
      error: e.message || "Serverfehler"
    });
  }
});

app.listen(PORT, () => {
  console.log("Server läuft auf Port " + PORT);
});
