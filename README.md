# Geo Alarm

A live-location alarm clock for travel: type where you're going, and it rings
the moment your GPS puts you within range. Glassmorphism dashboard, big
speedometer-style speed readout, and a circular live minimap.

## Run it

```bash
npm install
npm start
```

Then open **http://localhost:3000** on the device that will actually be
moving — a phone with real GPS gives far better results than a laptop.
`localhost` counts as a "secure context," so the browser's location prompt
works there without HTTPS. If you deploy this anywhere else, it must be
served over **HTTPS** or the Geolocation API will refuse to run.

## How to use it

1. Enter a **starting point (A)** — type an address or tap the crosshair icon
   to use your current location.
2. Enter a **destination (B)**.
3. Set the **alarm radius** (how close counts as "arrived" — default 100 m).
4. Tap **Preview route** to see the path and distance on the circular map.
5. Tap **Start tracking**. As you move, your live position, current speed
   (km/h), remaining distance, ETA and progress bar all update in real time.
6. When you get within the alarm radius of B, an alarm sound plays, your
   phone vibrates (if supported), and an "arrived" card appears. Tap
   **Stop alarm** to silence it.

## What it's built with (all free, no API keys)

- **Node.js + Express** — serves the static front end.
- **Leaflet.js** — the map engine.
- **OpenStreetMap** tiles — free map imagery.
- **Nominatim** (OpenStreetMap) — free address search / geocoding.
- **OSRM demo server** — free driving-route calculation (falls back to a
  straight line if that public server is ever rate-limited).
- Browser-native **Geolocation API** for live tracking and speed, and
  **Web Audio API** for the alarm tone (no external sound file needed).

Everything runs client-side in the browser; the Node server only serves the
files. No location data is sent anywhere except the free OpenStreetMap/OSRM
endpoints needed to search addresses and draw the route.

## Notes & limits

- Nominatim and the OSRM demo server are shared public services — be
  reasonably light with requests (the app already debounces address search).
  For serious production use, consider self-hosting or a paid provider.
- Not every device reports GPS `speed`/`heading`; the app falls back to
  computing speed from consecutive GPS fixes when that happens.
- Indoors or with a weak GPS signal, accuracy (and therefore the alarm
  trigger distance) can be off by tens of meters — keep the alarm radius
  reasonably generous in those conditions.
