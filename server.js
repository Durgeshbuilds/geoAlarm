// Geo Alarm — minimal static server
// Serves the /public folder. Geolocation only works in a "secure context":
// that's https:// in production, but http://localhost is trusted by browsers
// too, so this is enough for local development and testing.

const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.static(path.join(__dirname, 'public')));

app.listen(PORT, () => {
  console.log(`\n  Geo Alarm running → http://localhost:${PORT}\n`);
  console.log('  Open that link on the device you want to track (ideally your phone,');
  console.log('  since laptops often report weak/no GPS). Allow the location prompt.\n');
});
