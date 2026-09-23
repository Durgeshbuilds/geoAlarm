(() => {
  'use strict';

  // ---------- DOM ----------
  const originInput = document.getElementById('originInput');
  const destInput = document.getElementById('destInput');
  const originSuggestions = document.getElementById('originSuggestions');
  const destSuggestions = document.getElementById('destSuggestions');
  const useMyLocationBtn = document.getElementById('useMyLocationBtn');
  const radiusSlider = document.getElementById('radiusSlider');
  const radiusValue = document.getElementById('radiusValue');
  const routeBtn = document.getElementById('routeBtn');
  const trackBtn = document.getElementById('trackBtn');
  const setupError = document.getElementById('setupError');
  const speedValue = document.getElementById('speedValue');
  const distanceValue = document.getElementById('distanceValue');
  const etaValue = document.getElementById('etaValue');
  const progressFill = document.getElementById('progressFill');
  const progressPct = document.getElementById('progressPct');
  const gpsStatus = document.getElementById('gpsStatus');
  const gpsStatusText = document.getElementById('gpsStatusText');
  const mapPulse = document.getElementById('mapPulse');
  const arrivalModal = document.getElementById('arrivalModal');
  const arrivalSub = document.getElementById('arrivalSub');
  const stopAlarmBtn = document.getElementById('stopAlarmBtn');
  const recenterBtn = document.getElementById('recenterBtn');
  const compassNeedle = document.getElementById('compassNeedle');
  const compassBadge = document.getElementById('compassBadge');
  const enableCompassBtn = document.getElementById('enableCompassBtn');
  const compassBtnLabel = document.getElementById('compassBtnLabel');
  const headingReadout = document.getElementById('headingReadout');

  // ---------- State ----------
  const STORAGE_KEY = 'geoalarm_v1';

  const state = {
    origin: null,
    destination: null,
    radius: 100,
    tracking: false,
    arrived: false,
    watchId: null,
    lastFix: null,        // { lat, lon, t }
    displaySpeed: 0,
    initialDistance: null,
    deviceHeading: null,
    followMode: true,
  };

  let audioCtx = null;
  let alarmInterval = null;
  let vibrateInterval = null;
  let wakeLock = null;

  // ---------- Map setup ----------
  const map = L.map('map', {
    zoomControl: false,
    attributionControl: false,
    dragging: true,
    scrollWheelZoom: true,
    doubleClickZoom: true,
    touchZoom: true,
    boxZoom: false,
    keyboard: false,
    tap: true,
    inertia: true,
  }).setView([20, 0], 2);

  // CARTO Voyager tiles. CARTO requires a free API key (no account or card needed):
  // https://carto.com/basemaps/apikey — paste it below. Without a key, plain
  // OpenStreetMap tiles are used instead, so there is no watermark either way.
  const CARTO_API_KEY = 'PASTE_YOUR_FREE_CARTO_KEY_HERE';

  const hasCartoKey = CARTO_API_KEY && CARTO_API_KEY !== 'PASTE_YOUR_FREE_CARTO_KEY_HERE';
  if (hasCartoKey) {
    const dpr = window.devicePixelRatio > 1 ? '@2x' : '';
    L.tileLayer(`https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}${dpr}.png?key=${CARTO_API_KEY}`, {
      maxZoom: 20,
      subdomains: 'abcd',
    }).addTo(map);
  } else {
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(map);
  }

  map.on('dragstart zoomstart', () => {
    if (state.tracking) {
      state.followMode = false;
      recenterBtn.classList.remove('is-following');
    }
  });

  recenterBtn.addEventListener('click', () => {
    state.followMode = true;
    recenterBtn.classList.add('is-following');
    if (state.lastFix) map.setView([state.lastFix.lat, state.lastFix.lon], map.getZoom() < 14 ? 17 : map.getZoom(), { animate: true });
  });

  let userMarker = null;
  let destMarker = null;
  let routeLine = null;
  let traveledLine = null;
  let traveledLatLngs = [];

  function userArrowIcon(headingDeg) {
    const rot = Number.isFinite(headingDeg) ? headingDeg : 0;
    return L.divIcon({
      className: '',
      html: `
        <div class="user-arrow" style="transform: rotate(${rot}deg)">
          <div class="halo"></div>
          <svg width="26" height="26" viewBox="0 0 24 24">
            <path d="M12 1.5 L19.5 21 L12 16.8 L4.5 21 Z" fill="#F5A623" stroke="#1a1206" stroke-width="1"/>
          </svg>
        </div>`,
      iconSize: [30, 30],
      iconAnchor: [15, 15],
    });
  }

  const destPinIcon = L.divIcon({
    className: '',
    html: `
      <div class="dest-pin">
        <svg width="26" height="34" viewBox="0 0 24 32">
          <path d="M12 0C5.4 0 0 5.4 0 12c0 9 12 20 12 20s12-11 12-20C24 5.4 18.6 0 12 0z" fill="#2DD4BF"/>
          <circle cx="12" cy="12" r="5" fill="#0d1424"/>
        </svg>
      </div>`,
    iconSize: [26, 34],
    iconAnchor: [13, 32],
  });

  // ---------- Helpers ----------
  function haversineMeters(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const toRad = (d) => (d * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  function formatDistance(m) {
    if (m < 1000) return `${Math.round(m)} m`;
    return `${(m / 1000).toFixed(m < 10000 ? 2 : 1)} km`;
  }

  function formatEta(minutes) {
    if (!Number.isFinite(minutes) || minutes <= 0) return '—';
    if (minutes < 1) return '<1 min';
    if (minutes < 60) return `${Math.round(minutes)} min`;
    const h = Math.floor(minutes / 60);
    const m = Math.round(minutes % 60);
    return `${h}h ${m}m`;
  }

  function degToCompass(deg) {
    const dirs = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
    return dirs[Math.round((((deg % 360) + 360) % 360) / 45) % 8];
  }

  function debounce(fn, ms) {
    let t;
    return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
  }

  function setError(msg) {
    setupError.textContent = msg || '';
    setupError.classList.toggle('hidden', !msg);
  }

  function setStatus(mode, text) {
  gpsStatus.className = 'status-pill';
  gpsStatus.classList.add(`status-${mode}`);
  gpsStatusText.textContent = text;
}

  // ---------- Geocoding (Nominatim / OpenStreetMap — free, no key) ----------
  const geocodeCache = new Map();

  async function geocode(query) {
    const key = query.trim().toLowerCase();
    if (geocodeCache.has(key)) return geocodeCache.get(key);
    const params = new URLSearchParams({ format: 'jsonv2', limit: '8', addressdetails: '1', q: query });
    if (state.lastFix) {
      const { lat, lon } = state.lastFix;
      const d = 1.5;
      params.set('viewbox', `${lon - d},${lat + d},${lon + d},${lat - d}`);
    }
    const res = await fetch(`https://nominatim.openstreetmap.org/search?${params}`, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(res.status === 429 ? 'rate-limited' : 'geocode-failed');
    const data = await res.json();
    geocodeCache.set(key, data);
    return data;
  }

  async function reverseGeocode(lat, lon) {
    const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lon}`, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error('Reverse geocoding failed');
    return res.json();
  }

  function shortLabel(displayName) {
    return displayName.split(',').map((p) => p.trim()).slice(0, 3).join(', ');
  }

  function renderMessage(listEl, text) {
    listEl.innerHTML = `<li class="muted">${text}</li>`;
    listEl.classList.remove('hidden');
  }

  function wireAutocomplete(input, listEl, onPick) {
    const run = debounce(async () => {
      const q = input.value;
      if (q.trim().length < 3) { listEl.classList.add('hidden'); listEl.innerHTML = ''; return; }
      renderMessage(listEl, 'Searching…');
      try {
        const results = await geocode(q);
        if (!results.length) { renderMessage(listEl, 'No matches — try a different spelling or add a city.'); return; }
        listEl.innerHTML = results.map((r, i) => `<li data-i="${i}">${shortLabel(r.display_name)}</li>`).join('');
        listEl.classList.remove('hidden');
        [...listEl.children].forEach((li, i) => {
          li.addEventListener('click', () => {
            const r = results[i];
            input.value = shortLabel(r.display_name);
            listEl.classList.add('hidden');
            onPick({ lat: parseFloat(r.lat), lon: parseFloat(r.lon), label: shortLabel(r.display_name) });
          });
        });
      } catch (e) {
        renderMessage(listEl, e.message === 'rate-limited'
          ? 'Search is briefly rate-limited — wait a few seconds and keep typing.'
          : 'Search unavailable right now — check your connection.');
      }
    }, 500);

    input.addEventListener('input', run);
    input.addEventListener('focus', () => { if (listEl.children.length) listEl.classList.remove('hidden'); });
    document.addEventListener('click', (e) => {
      if (!listEl.contains(e.target) && e.target !== input) listEl.classList.add('hidden');
    });
  }

  wireAutocomplete(originInput, originSuggestions, (loc) => { state.origin = loc; });
  wireAutocomplete(destInput, destSuggestions, (loc) => { state.destination = loc; });
  originInput.addEventListener('input', () => { state.origin = null; });
  destInput.addEventListener('input', () => { state.destination = null; });

  // ---------- "Use my location" ----------
  function describeGeoError(err) {
    switch (err.code) {
      case err.PERMISSION_DENIED: return 'permission denied. Allow location access and try again.';
      case err.POSITION_UNAVAILABLE: return 'position unavailable.';
      case err.TIMEOUT: return 'timed out getting a fix.';
      default: return err.message || 'unknown error.';
    }
  }

  useMyLocationBtn.addEventListener('click', () => {
    if (!navigator.geolocation) { setError('Geolocation is not supported on this device/browser.'); return; }
    useMyLocationBtn.disabled = true;
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude } = pos.coords;
        state.origin = { lat: latitude, lon: longitude, label: 'My current location' };
        originInput.value = 'My current location';
        useMyLocationBtn.disabled = false;
        try {
          const rev = await reverseGeocode(latitude, longitude);
          if (rev && rev.display_name) {
            const label = shortLabel(rev.display_name);
            originInput.value = label;
            state.origin.label = label;
          }
        } catch (_) { /* keep generic label */ }
      },
      (err) => { useMyLocationBtn.disabled = false; setError('Could not get your location: ' + describeGeoError(err)); },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  });

  // ---------- Radius slider ----------
  radiusSlider.addEventListener('input', () => {
    state.radius = parseInt(radiusSlider.value, 10);
    radiusValue.textContent = `${state.radius} m`;
    saveTripState();
  });

  // ---------- Route preview ----------
  async function ensureResolved(input, current) {
    if (current) return current;
    const results = await geocode(input.value);
    if (!results.length) return null;
    const r = results[0];
    return { lat: parseFloat(r.lat), lon: parseFloat(r.lon), label: shortLabel(r.display_name) };
  }

  routeBtn.addEventListener('click', async () => {
    setError(null);
    if (!originInput.value.trim() || !destInput.value.trim()) { setError('Enter both a starting point and a destination.'); return; }
    routeBtn.disabled = true;
    routeBtn.textContent = 'Locating…';
    try {
      const [origin, destination] = await Promise.all([
        ensureResolved(originInput, state.origin),
        ensureResolved(destInput, state.destination),
      ]);
      if (!origin) throw new Error('Could not find that starting point.');
      if (!destination) throw new Error('Could not find that destination.');
      state.origin = origin;
      state.destination = destination;
      placeMarkers();
      routeBtn.textContent = 'Drawing route…';
      await drawRoute();
      trackBtn.disabled = false;
      saveTripState();
    } catch (e) {
      setError(e.message || 'Something went wrong finding that route.');
    } finally {
      routeBtn.disabled = false;
      routeBtn.textContent = 'Preview route';
    }
  });

  function placeMarkers() {
    const { origin, destination } = state;
    if (userMarker) map.removeLayer(userMarker);
    if (destMarker) map.removeLayer(destMarker);
    userMarker = L.marker([origin.lat, origin.lon], { icon: userArrowIcon(0) }).addTo(map);
    destMarker = L.marker([destination.lat, destination.lon], { icon: destPinIcon }).addTo(map);
    map.fitBounds(L.latLngBounds([origin.lat, origin.lon], [destination.lat, destination.lon]), { padding: [28, 28] });
  }

  async function drawRoute() {
    const { origin, destination } = state;
    if (routeLine) { map.removeLayer(routeLine); routeLine = null; }
    try {
      const url = `https://router.project-osrm.org/route/v1/driving/${origin.lon},${origin.lat};${destination.lon},${destination.lat}?overview=full&geometries=geojson`;
      const data = await (await fetch(url)).json();
      if (data.code !== 'Ok' || !data.routes || !data.routes[0]) throw new Error('no route');
      const coords = data.routes[0].geometry.coordinates.map(([lon, lat]) => [lat, lon]);
      routeLine = L.polyline(coords, { color: '#2dd4bf', weight: 4, opacity: 0.85 }).addTo(map);
      distanceValue.textContent = formatDistance(data.routes[0].distance);
      etaValue.textContent = formatEta(data.routes[0].duration / 60);
      state.initialDistance = data.routes[0].distance;
    } catch (_) {
      routeLine = L.polyline([[origin.lat, origin.lon], [destination.lat, destination.lon]],
        { color: '#2dd4bf', weight: 3, opacity: 0.7, dashArray: '6 8' }).addTo(map);
      const meters = haversineMeters(origin.lat, origin.lon, destination.lat, destination.lon);
      distanceValue.textContent = formatDistance(meters);
      etaValue.textContent = '—';
      state.initialDistance = meters;
    }
  }

  // ---------- Persistence ----------
  function saveTripState() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ origin: state.origin, destination: state.destination, radius: state.radius }));
    } catch (_) { /* ignore */ }
  }

  async function restoreTripState() {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null'); } catch (_) { /* ignore */ }
    if (!saved || !saved.origin || !saved.destination) return;
    state.origin = saved.origin;
    state.destination = saved.destination;
    originInput.value = saved.origin.label || '';
    destInput.value = saved.destination.label || '';
    if (saved.radius) {
      state.radius = saved.radius;
      radiusSlider.value = saved.radius;
      radiusValue.textContent = `${saved.radius} m`;
    }
    placeMarkers();
    await drawRoute();
    trackBtn.disabled = false;
  }

  // ---------- Live tracking ----------
  trackBtn.addEventListener('click', () => (state.tracking ? stopTracking() : startTracking()));

  function startTracking() {
    if (!navigator.geolocation) { setError('Geolocation is not supported on this device/browser.'); return; }
    if (!state.destination) { setError('Preview a route first.'); return; }
    setError(null);
    state.tracking = true;
    state.arrived = false;
    state.lastFix = null;
    state.displaySpeed = 0;
    state.followMode = true;
    traveledLatLngs = [];
    if (traveledLine) { map.removeLayer(traveledLine); traveledLine = null; }

    trackBtn.textContent = 'Stop tracking';
    trackBtn.classList.add('is-danger');
    mapPulse.classList.add('is-tracking');
    recenterBtn.classList.add('is-following');
    setStatus('tracking', 'Tracking live');
    acquireWakeLock();

    state.watchId = navigator.geolocation.watchPosition(onPosition, onPositionError, {
      enableHighAccuracy: true, maximumAge: 1000, timeout: 20000,
    });
  }

  function stopTracking() {
    if (state.watchId !== null) navigator.geolocation.clearWatch(state.watchId);
    state.watchId = null;
    state.tracking = false;
    trackBtn.textContent = 'Start tracking';
    trackBtn.classList.remove('is-danger');
    mapPulse.classList.remove('is-tracking', 'is-armed');
    recenterBtn.classList.remove('is-following');
    setStatus('idle', 'Not tracking');
    releaseWakeLock();
  }

  function onPositionError(err) {
  if (err.code === err.PERMISSION_DENIED) {
    // Permission blocked: tracking is impossible, so fully stop it.
    stopTracking();
    setStatus('blocked', 'Location blocked');
    setError('Location is blocked for this site. Click the location icon in the address bar and choose Allow, then start tracking again.');
    return;
  }
  // Weak GPS / timeout: keep tracking — the signal usually comes back.
  setStatus('idle', 'Signal lost');
  setError('Weak GPS signal — still trying…');
}

  function onPosition(pos) {
    setStatus('tracking', 'Tracking live');
    setError(null);
    const { latitude, longitude, speed, heading } = pos.coords;
    const now = pos.timestamp || Date.now();

    let kmh = null;
    if (typeof speed === 'number' && !Number.isNaN(speed) && speed >= 0) {
      kmh = speed * 3.6;
    } else if (state.lastFix) {
      const distM = haversineMeters(state.lastFix.lat, state.lastFix.lon, latitude, longitude);
      const dtS = (now - state.lastFix.t) / 1000;
      if (dtS > 0.5) kmh = (distM / dtS) * 3.6;
    }
    if (kmh === null || !Number.isFinite(kmh)) kmh = state.displaySpeed;
    kmh = Math.max(0, kmh);
    state.displaySpeed = state.displaySpeed * 0.65 + kmh * 0.35;
    if (state.displaySpeed < 0.6) state.displaySpeed = 0;
    state.lastFix = { lat: latitude, lon: longitude, t: now };
    speedValue.textContent = state.displaySpeed.toFixed(state.displaySpeed < 10 ? 1 : 0);

    let headingDeg = null;
    if (typeof heading === 'number' && !Number.isNaN(heading) && state.displaySpeed > 0.8) headingDeg = heading;
    else if (state.deviceHeading !== null) headingDeg = state.deviceHeading;

    if (userMarker) {
      userMarker.setLatLng([latitude, longitude]);
      userMarker.setIcon(userArrowIcon(headingDeg ?? 0));
    } else {
      userMarker = L.marker([latitude, longitude], { icon: userArrowIcon(0) }).addTo(map);
    }

    traveledLatLngs.push([latitude, longitude]);
    if (traveledLatLngs.length > 1) {
      if (traveledLine) traveledLine.setLatLngs(traveledLatLngs);
      else traveledLine = L.polyline(traveledLatLngs, { color: '#f5a623', weight: 4, opacity: 0.95 }).addTo(map);
    }

    if (state.followMode) map.setView([latitude, longitude], map.getZoom() < 14 ? 17 : map.getZoom(), { animate: true });

    const dest = state.destination;
    const remaining = haversineMeters(latitude, longitude, dest.lat, dest.lon);
    distanceValue.textContent = formatDistance(remaining);
    if (state.displaySpeed > 1) etaValue.textContent = formatEta((remaining / 1000 / state.displaySpeed) * 60);

    if (state.initialDistance === null || remaining > state.initialDistance) state.initialDistance = remaining;
    const pct = state.initialDistance > 0 ? Math.min(100, Math.max(0, 100 - (remaining / state.initialDistance) * 100)) : 100;
    progressFill.style.width = `${pct}%`;
    progressPct.textContent = `${Math.round(pct)}%`;

    if (!state.arrived && remaining <= state.radius) triggerArrival(remaining);
  }

  // ---------- Compass (real On/Off toggle) ----------
  let compassOn = false;
  let compassEventName = null;

  function handleOrientation(e) {
    let h = null;
    if (typeof e.webkitCompassHeading === 'number') h = e.webkitCompassHeading;          // iPhone
    else if (typeof e.alpha === 'number' && (e.absolute || e.type === 'deviceorientationabsolute')) h = (360 - e.alpha) % 360; // Android
    if (h === null || Number.isNaN(h)) return;
    state.deviceHeading = h;
    compassNeedle.style.transform = `rotate(${-h}deg)`;
    headingReadout.textContent = `Heading ${Math.round(h)}° ${degToCompass(h)}`;
    if (compassBtnLabel.textContent !== 'Compass: On') compassBtnLabel.textContent = 'Compass: On';
  }

  function setCompassUI(on, label) {
    compassOn = on;
    enableCompassBtn.classList.toggle('is-on', on);
    enableCompassBtn.setAttribute('aria-pressed', String(on));
    compassBadge.classList.toggle('is-on', on);
    compassBtnLabel.textContent = label || (on ? 'Compass: On' : 'Compass: Off');
  }

  async function turnCompassOn() {
    if (typeof DeviceOrientationEvent === 'undefined') {
      setError('This device/browser does not support a live compass.');
      return;
    }
    // iPhone asks for permission; Android doesn't.
    if (typeof DeviceOrientationEvent.requestPermission === 'function') {
      const result = await DeviceOrientationEvent.requestPermission();
      if (result !== 'granted') { setError('Compass permission was not granted.'); return; }
    }
    compassEventName = 'ondeviceorientationabsolute' in window ? 'deviceorientationabsolute' : 'deviceorientation';
    window.addEventListener(compassEventName, handleOrientation, true);
    setCompassUI(true, 'Compass: Starting…');
    headingReadout.textContent = 'Heading — waiting for sensor';
    const before = state.deviceHeading;
    setTimeout(() => {
      if (compassOn && state.deviceHeading === before) {
        turnCompassOff();
        compassBtnLabel.textContent = 'Compass: Unavailable';
        headingReadout.textContent = 'No compass sensor on this device';
      }
    }, 3000);
  }

  function turnCompassOff() {
    if (compassEventName) window.removeEventListener(compassEventName, handleOrientation, true);
    compassEventName = null;
    state.deviceHeading = null;
    compassNeedle.style.transform = 'rotate(0deg)';
    headingReadout.textContent = 'Heading —';
    setCompassUI(false);
  }

  enableCompassBtn.addEventListener('click', async () => {
    try {
      if (compassOn) turnCompassOff();
      else await turnCompassOn();
    } catch (_) {
      setError('This device/browser does not support a live compass.');
      turnCompassOff();
    }
  });

  // ---------- Alarm ----------
  function triggerArrival(remainingM) {
    state.arrived = true;
    setStatus('armed', 'Arrived');
    mapPulse.classList.remove('is-tracking');
    mapPulse.classList.add('is-armed');
    arrivalSub.textContent = `You're ${Math.round(remainingM)} m from your destination.`;
    arrivalModal.classList.remove('hidden');
    startAlarmSound();
    startVibration();
  }

  function startAlarmSound() {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    if (audioCtx.state === 'suspended') audioCtx.resume();
    playBeep();
    alarmInterval = setInterval(playBeep, 650);
  }

  function playBeep() {
    if (!audioCtx) return;
    const t0 = audioCtx.currentTime;
    [880, 1108].forEach((freq, i) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      const t = t0 + i * 0.16;
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.35, t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.28);
      osc.connect(gain).connect(audioCtx.destination);
      osc.start(t);
      osc.stop(t + 0.3);
    });
  }

  function startVibration() {
    if (!navigator.vibrate) return;
    navigator.vibrate([250, 120, 250]);
    vibrateInterval = setInterval(() => navigator.vibrate([250, 120, 250]), 650);
  }

  function stopAlarm() {
    clearInterval(alarmInterval);
    clearInterval(vibrateInterval);
    if (navigator.vibrate) navigator.vibrate(0);
    arrivalModal.classList.add('hidden');
    stopTracking();
    setStatus('idle', 'Arrived — alarm stopped');
  }
  stopAlarmBtn.addEventListener('click', stopAlarm);

  document.addEventListener('click', () => {
    if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
  }, { once: true });

  // ---------- Screen Wake Lock ----------
  async function acquireWakeLock() {
    try {
      if ('wakeLock' in navigator) {
        wakeLock = await navigator.wakeLock.request('screen');
        wakeLock.addEventListener('release', () => { wakeLock = null; });
      }
    } catch (_) { /* optional */ }
  }
  function releaseWakeLock() {
    if (wakeLock) { wakeLock.release().catch(() => {}); wakeLock = null; }
  }

  // ---------- Recover from a backgrounded tab ----------
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      map.invalidateSize();
      if (state.tracking && !wakeLock) acquireWakeLock();
    }
  });
  window.addEventListener('pageshow', () => map.invalidateSize());
  window.addEventListener('orientationchange', () => setTimeout(() => map.invalidateSize(), 250));

  // ---------- Init ----------
    // Show upfront if the browser has blocked location access
  if (navigator.permissions && navigator.permissions.query) {
    navigator.permissions.query({ name: 'geolocation' }).then((p) => {
      const show = () => {
        if (state.tracking) return;
        if (p.state === 'denied') {
          setStatus('blocked', 'Location blocked');
          setError('Location is blocked for this site. Allow it in your browser settings to use tracking.');
        } else {
          setStatus('idle', 'Not tracking');
          setError(null);
        }
      };
      show();
      p.onchange = show;
    }).catch(() => {});
  }
  restoreTripState();
})();
