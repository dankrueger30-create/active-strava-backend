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
    return res.redirect(`${APP_REDIRECT_SCHEME}?error=${error}`);
  }

  if (!code) {
    return res.redirect(`${APP_REDIRECT_SCHEME}?error=missing_code`);
  }

  return res.redirect(`${APP_REDIRECT_SCHEME}?code=${code}`);
});

app.post("/strava/exchange", async (req, res) => {
  try {
    const { code } = req.body;

    const response = await fetch("https://www.strava.com/oauth/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        client_id: STRAVA_CLIENT_ID,
        client_secret: STRAVA_CLIENT_SECRET,
        code,
        grant_type: "authorization_code"
      })
    });

    const data = await response.json();

    if (!response.ok) {
      return res.json({ ok: false, error: data });
    }

    return res.json({
      ok: true,
      athleteId: data.athlete?.id,
      athleteName: `${data.athlete?.firstname} ${data.athlete?.lastname}`
    });

  } catch (e) {
    res.json({ ok: false, error: e.message });
  }
});

app.listen(PORT, () => {
  console.log("Server läuft auf Port " + PORT);
});
