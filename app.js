/* ClimaStat — aide à la préparation de vacances : climat historique (Open-Meteo/ERA5),
   croisement NASA POWER, prévisions ARPEGE (Météo-France), conseils valise & activités. */

"use strict";

const GEO_URL = "https://geocoding-api.open-meteo.com/v1/search";
const ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive";
const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";
const POWER_URL = "https://power.larc.nasa.gov/api/temporal/daily";
const POWER_MISSING = -999;
const ARPEGE_MODELS_FR = ["meteofrance_arpege_france", "meteofrance_arpege_world"];

const DAILY_VARS = [
  "weather_code",
  "temperature_2m_max",
  "temperature_2m_min",
  "temperature_2m_mean",
  "precipitation_sum",
  "snowfall_sum",
  "wind_speed_10m_max",
].join(",");

const HEAT_THRESHOLD_C = 30;
const FROST_THRESHOLD_C = 0;
const RAINY_MM = 1;

const WMO = {
  0:  { label: "Ciel clair",            icon: "☀️", cat: "Ensoleillé" },
  1:  { label: "Plutôt dégagé",         icon: "🌤️", cat: "Plutôt dégagé" },
  2:  { label: "Partiellement nuageux", icon: "⛅",  cat: "Plutôt dégagé" },
  3:  { label: "Ciel couvert",          icon: "☁️", cat: "Nuageux" },
  45: { label: "Brouillard",            icon: "🌫️", cat: "Brouillard" },
  48: { label: "Brouillard givrant",    icon: "🌫️", cat: "Brouillard" },
  51: { label: "Bruine légère",         icon: "🌦️", cat: "Bruine" },
  53: { label: "Bruine",                icon: "🌦️", cat: "Bruine" },
  55: { label: "Bruine dense",          icon: "🌦️", cat: "Bruine" },
  56: { label: "Bruine verglaçante",    icon: "🌧️", cat: "Bruine" },
  57: { label: "Bruine verglaçante dense", icon: "🌧️", cat: "Bruine" },
  61: { label: "Pluie faible",          icon: "🌧️", cat: "Pluie" },
  63: { label: "Pluie",                 icon: "🌧️", cat: "Pluie" },
  65: { label: "Pluie forte",           icon: "🌧️", cat: "Pluie" },
  66: { label: "Pluie verglaçante",     icon: "🌧️", cat: "Bruine" },
  67: { label: "Pluie verglaçante forte", icon: "🌧️", cat: "Pluie" },
  71: { label: "Neige faible",          icon: "🌨️", cat: "Neige" },
  73: { label: "Neige",                 icon: "🌨️", cat: "Neige" },
  75: { label: "Neige forte",           icon: "❄️", cat: "Neige" },
  77: { label: "Grains de neige",       icon: "🌨️", cat: "Neige" },
  80: { label: "Averses faibles",       icon: "🌦️", cat: "Averses" },
  81: { label: "Averses",               icon: "🌧️", cat: "Averses" },
  82: { label: "Averses violentes",     icon: "⛈️", cat: "Averses" },
  85: { label: "Averses de neige",      icon: "🌨️", cat: "Neige" },
  86: { label: "Fortes averses de neige", icon: "❄️", cat: "Neige" },
  95: { label: "Orage",                 icon: "⛈️", cat: "Orages" },
  96: { label: "Orage avec grêle",      icon: "⛈️", cat: "Orages" },
  99: { label: "Orage violent avec grêle", icon: "⛈️", cat: "Orages" },
};

const MONTH_NAMES = [
  "janvier", "février", "mars", "avril", "mai", "juin",
  "juillet", "août", "septembre", "octobre", "novembre", "décembre",
];

let charts = [];

/* ---------- Utilitaires ---------- */

const fmt = (x, digits = 1) =>
  x === null || x === undefined || Number.isNaN(x) ? "—" : x.toFixed(digits).replace(".", ",");

function dayOfYear(dateStr) {
  const d = new Date(dateStr + "T00:00:00Z");
  return Math.floor((d - Date.UTC(d.getUTCFullYear(), 0, 1)) / 86400000) + 1;
}

function windowLengthDays(startStr, endStr) {
  const raw = (dayOfYear(endStr) - dayOfYear(startStr) + 366) % 366;
  return raw === 0 ? 1 : raw + 1; /* jours inclus */
}

function makeWindowFilter(startStr, endStr) {
  const s = dayOfYear(startStr);
  const raw = ((dayOfYear(endStr) - s) % 366 + 366) % 366; /* décalage max, bornes incluses */
  return (doyVal) => (((doyVal - s) % 366) + 366) % 366 <= raw;
}

function frenchDate(dateStr) {
  const d = new Date(dateStr + "T00:00:00Z");
  return d.toLocaleDateString("fr-FR", {
    day: "numeric", month: "long", year: "numeric", timeZone: "UTC",
  });
}

function frenchShortDate(dateStr) {
  const d = new Date(dateStr + "T00:00:00Z");
  return d.toLocaleDateString("fr-FR", { day: "numeric", month: "long", timeZone: "UTC" });
}

function slopePerYear(ys) {
  const n = ys.length;
  if (n < 2) return null;
  const xm = (n - 1) / 2;
  const ym = ys.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - xm) * (ys[i] - ym);
    den += (i - xm) * (i - xm);
  }
  return num / den;
}

function linregSeries(ys) {
  const slope = slopePerYear(ys);
  const n = ys.length;
  const xm = (n - 1) / 2;
  const ym = ys.reduce((a, b) => a + b, 0) / n;
  const intercept = ym - slope * xm;
  return ys.map((_, i) => intercept + slope * i);
}

function mean(arr) {
  const v = arr.filter((x) => x !== null && !Number.isNaN(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

function trendWord(slope) {
  if (slope === null) return "données insuffisantes";
  if (slope >= 0.05) return "à la hausse";
  if (slope <= -0.05) return "à la baisse";
  return "globalement stable";
}

function longestRun(boolArr) {
  let best = 0, cur = 0, bestEnd = -1;
  boolArr.forEach((ok, i) => {
    cur = ok ? cur + 1 : 0;
    if (cur > best) { best = cur; bestEnd = i; }
  });
  return { length: best, endIndex: bestEnd };
}

function setStatus(msg, isError = false) {
  const el = document.getElementById("status");
  el.hidden = !msg;
  el.textContent = msg || "";
  el.classList.toggle("error", isError);
}

function destroyCharts() {
  charts.forEach((c) => c && c.destroy());
  charts = [];
}

/* ---------- Géocodage / autocomplétion ---------- */

function placeLabel(p) {
  return [p.name, p.admin1, p.country].filter(Boolean).join(", ");
}

async function geocode(q) {
  const url = `${GEO_URL}?${new URLSearchParams({
    name: q, count: "8", language: "fr", format: "json",
  })}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error("Recherche de lieu indisponible");
  const data = await res.json();
  return data.results || [];
}

let debounceTimer = null;
const searchInput = document.getElementById("search");
const suggestionsEl = document.getElementById("suggestions");

function renderSuggestions(results) {
  suggestionsEl.innerHTML = "";
  if (!results.length) {
    suggestionsEl.hidden = true;
    return;
  }
  results.forEach((p, i) => {
    const li = document.createElement("li");
    li.textContent = p.name + " ";
    const span = document.createElement("span");
    span.textContent = [p.admin1, p.country].filter(Boolean).join(", ");
    li.appendChild(span);
    li.addEventListener("click", () => selectPlace(p));
    if (i === 0) li.classList.add("active");
    suggestionsEl.appendChild(li);
  });
  suggestionsEl.hidden = false;
}

function selectPlace(p) {
  searchInput.value = placeLabel(p);
  searchInput.dataset.lat = p.latitude;
  searchInput.dataset.lon = p.longitude;
  suggestionsEl.hidden = true;
}

searchInput.addEventListener("input", () => {
  delete searchInput.dataset.lat;
  clearTimeout(debounceTimer);
  const q = searchInput.value.trim();
  if (q.length < 2) { suggestionsEl.hidden = true; return; }
  debounceTimer = setTimeout(async () => {
    try { renderSuggestions(await geocode(q)); } catch { suggestionsEl.hidden = true; }
  }, 300);
});

searchInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    const first = suggestionsEl.querySelector("li");
    if (first && !searchInput.dataset.lat) first.click();
    else if (!searchInput.dataset.lat) analyze();
  }
});

document.addEventListener("click", (e) => {
  if (!suggestionsEl.contains(e.target) && e.target !== searchInput) {
    suggestionsEl.hidden = true;
  }
});

/* ---------- Saisie de période : début / fin / durée synchronisés ---------- */

function addDaysIso(dateStr, days) {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const startDateInput = document.getElementById("start-date");
const endDateInput = document.getElementById("end-date");
const durationInput = document.getElementById("duration");

function endFromStartAndDuration() {
  const start = startDateInput.value;
  const days = Math.max(1, Math.min(90, parseInt(durationInput.value, 10) || 1));
  if (start) endDateInput.value = addDaysIso(start, days - 1);
}

function periodFromInputs() {
  const start = startDateInput.value;
  const end = endDateInput.value;
  if (!start || !end) return null;
  if (new Date(end) < new Date(start)) return null;
  return { start, end, duration: windowLengthDays(start, end) };
}

/* ---------- Récupération des données ---------- */

const CACHE_PREFIX = "meteostat-archive-v1:";
const CACHE_TTL_MS = 24 * 3600 * 1000;
const CACHE_MAX_BYTES = 4 * 1024 * 1024;

function archiveCacheKey(place, sinceYear) {
  return `${CACHE_PREFIX}${(+place.latitude).toFixed(3)},${(+place.longitude).toFixed(3)}:${sinceYear}`;
}

function friendlyApiError(reason) {
  if (/limit/i.test(reason || "")) {
    return (
      "Limite horaire de l'API Open-Meteo atteinte pour votre adresse IP " +
      "(fréquent sur une connexion mobile partagée). " +
      "Réessayez dans une heure, ou réduisez l'historique (1990/2010). " +
      "Les lieux déjà analysés restent en cache local 24 h."
    );
  }
  return reason || "Erreur de l'API météo";
}

async function loadArchive(place, sinceYear) {
  const cacheKey = archiveCacheKey(place, sinceYear);
  try {
    const cached = JSON.parse(localStorage.getItem(cacheKey) || "null");
    if (cached && Date.now() - cached.t < CACHE_TTL_MS && cached.daily && cached.daily.time) {
      return cached.daily;
    }
  } catch {}
  const today = new Date();
  const end = new Date(today);
  end.setDate(end.getDate() - 7); /* l'archive ERA5 a ~5 jours de délai */
  const iso = (d) => d.toISOString().slice(0, 10);
  const params = new URLSearchParams({
    latitude: place.latitude,
    longitude: place.longitude,
    start_date: `${sinceYear}-01-01`,
    end_date: iso(end),
    daily: DAILY_VARS,
    timezone: "auto",
  });
  const res = await fetch(`${ARCHIVE_URL}?${params}`);
  const data = await res.json();
  if (data.error) throw new Error(friendlyApiError(data.reason));
  try {
    const payload = JSON.stringify({ t: Date.now(), daily: data.daily });
    if (payload.length <= CACHE_MAX_BYTES) localStorage.setItem(cacheKey, payload);
  } catch {}
  return data.daily;
}

async function loadPowerDaily(place, sinceYear) {
  const today = new Date();
  const end = new Date(today);
  end.setDate(end.getDate() - 8);
  const powerStart = Math.max(1981, sinceYear);
  const params = new URLSearchParams({
    parameters: "T2M_MAX,T2M_MIN,PRECTOTCORR",
    community: "RE",
    latitude: place.latitude,
    longitude: place.longitude,
    start: `${powerStart}0101`,
    end: end.toISOString().slice(0, 10).replace(/-/g, ""),
    format: "JSON",
    "time-standard": "LST",
  });
  const res = await fetch(`${POWER_URL}?${params}`);
  if (!res.ok) throw new Error(`NASA POWER indisponible (HTTP ${res.status})`);
  const data = await res.json();
  const p = data && data.properties && data.properties.parameter;
  if (!p) throw new Error("Réponse NASA POWER inattendue");
  const param = (names) => {
    for (const n of names) if (p[n]) return p[n];
    return null;
  };
  const tmax = param(["T2M_MAX"]);
  const tmin = param(["T2M_MIN"]);
  const rain = param(["PRECTOTCORR", "PRECTOT"]);
  if (!tmax || !tmin || !rain) throw new Error("Paramètres NASA POWER manquants");
  const clean = (series) => {
    const out = {};
    Object.entries(series).forEach(([k, v]) => {
      const num = +v;
      if (v !== null && num !== POWER_MISSING && !Number.isNaN(num)) out[k] = num;
    });
    return out;
  };
  const tmaxC = clean(tmax);
  const tminC = clean(tmin);
  const rainC = clean(rain);
  const times = [...new Set([...Object.keys(tmaxC), ...Object.keys(tminC)])].sort();
  const daily = { time: [], temperature_2m_max: [], temperature_2m_min: [], precipitation_sum: [] };
  times.forEach((k) => {
    daily.time.push(`${k.slice(0, 4)}-${k.slice(4, 6)}-${k.slice(6, 8)}`);
    daily.temperature_2m_max.push(tmaxC[k] ?? null);
    daily.temperature_2m_min.push(tminC[k] ?? null);
    daily.precipitation_sum.push(rainC[k] ?? null);
  });
  return daily;
}

async function loadForecast(place, forecastDays) {
  let lastError = null;
  for (const model of ARPEGE_MODELS_FR) {
    try {
      const params = new URLSearchParams({
        latitude: place.latitude,
        longitude: place.longitude,
        daily: "temperature_2m_max,temperature_2m_min,precipitation_sum,weather_code",
        timezone: "auto",
        forecast_days: String(forecastDays),
        models: model,
      });
      const res = await fetch(`${FORECAST_URL}?${params}`);
      const data = await res.json();
      if (data.error) throw new Error(data.reason || "API prévisions indisponible");
      const d = data.daily;
      const pick = (base) => d[base] || d[`${base}_${model}`] || null;
      const tmax = pick("temperature_2m_max");
      const tmin = pick("temperature_2m_min");
      if (!tmax || !tmin || !tmax.some((v) => v !== null)) {
        throw new Error("Aucune donnée ARPEGE pour ce lieu");
      }
      return {
        model,
        time: d.time || [],
        tmax,
        tmin,
        rain: pick("precipitation_sum") || [],
        codes: pick("weather_code") || [],
      };
    } catch (err) {
      lastError = err;
    }
  }
  throw lastError || new Error("Prévisions indisponibles");
}

/* ---------- Analyses ---------- */

function periodAnalysis(d, startStr, endStr) {
  const inWin = makeWindowFilter(startStr, endStr);
  const n = d.time.length;
  const idx = [];
  for (let i = 0; i < n; i++) if (inWin(dayOfYear(d.time[i]))) idx.push(i);
  if (!idx.length) throw new Error("Aucune donnée historique ne correspond à cette période — vérifiez les dates.");

  const perYear = new Map();
  idx.forEach((i) => {
    const year = +d.time[i].slice(0, 4);
    if (!perYear.has(year)) {
      perYear.set(year, { tmax: [], tmin: [], rain: [], codes: {} });
    }
    const y = perYear.get(year);
    y.tmax.push(d.temperature_2m_max[i]);
    y.tmin.push(d.temperature_2m_min[i]);
    y.rain.push(d.precipitation_sum[i]);
    const code = d.weather_code?.[i];
    if (code !== undefined) y.codes[code] = (y.codes[code] || 0) + 1;
  });

  const years = [...perYear.keys()].sort((a, b) => a - b);
  const yearlyStats = years.map((year) => {
    const y = perYear.get(year);
    const tmax = mean(y.tmax);
    const tmin = mean(y.tmin);
    return { year, tmax, tmin, mean: tmax !== null && tmin !== null ? (tmax + tmin) / 2 : null };
  });

  const tmax = mean(idx.map((i) => d.temperature_2m_max[i]));
  const tmin = mean(idx.map((i) => d.temperature_2m_min[i]));
  const rainDays = idx.filter((i) => (d.precipitation_sum[i] || 0) >= RAINY_MM).length;
  const totalPrecip = mean(idx.map((i) => d.precipitation_sum[i] || 0));

  const catCount = {};
  idx.forEach((i) => {
    let cat;
    if ((d.snowfall_sum?.[i] || 0) > 0) cat = "Neige";
    else {
      const w = WMO[d.weather_code?.[i]];
      cat = w ? w.cat : "Autre";
    }
    catCount[cat] = (catCount[cat] || 0) + 1;
  });
  const catPct = Object.entries(catCount)
    .map(([cat, count]) => ({ cat, pct: (100 * count) / idx.length }))
    .sort((a, b) => b.pct - a.pct);

  const hottest = idx.reduce((best, i) =>
    d.temperature_2m_max[i] > (d.temperature_2m_max[best] ?? -Infinity) ? i : best, idx[0]);
  const coldest = idx.reduce((best, i) =>
    d.temperature_2m_min[i] < (d.temperature_2m_min[best] ?? Infinity) ? i : best, idx[0]);

  return { count: idx.length, tmax, tmin, rainDays, totalPrecip, catPct, yearlyStats, hottest, coldest };
}

/* Probabilités de conditions sur le créneau calendaire (tous les jours d'historique). */
function conditionStats(d, startStr, endStr) {
  const inWin = makeWindowFilter(startStr, endStr);
  const n = d.time.length;
  const total = { all: 0, hot28: 0, hot32: 0, swim: 0, coolDay: 0, coldNight: 0, frost: 0, rain: 0, heavyRain: 0, wind: 0, snow: 0 };
  for (let i = 0; i < n; i++) {
    if (!inWin(dayOfYear(d.time[i]))) continue;
    const tx = d.temperature_2m_max[i];
    const tn = d.temperature_2m_min[i];
    const pr = d.precipitation_sum[i];
    const wi = d.wind_speed_10m_max?.[i];
    total.all++;
    if (tx !== null && !Number.isNaN(tx)) {
      if (tx >= 24) total.swim++;
      if (tx >= 28) total.hot28++;
      if (tx >= 32) total.hot32++;
      if (tx <= 12) total.coolDay++;
    }
    if (tn !== null && !Number.isNaN(tn)) {
      if (tn <= 10) total.coldNight++;
      if (tn <= 0) total.frost++;
    }
    if (pr !== null && !Number.isNaN(pr)) {
      if (pr >= RAINY_MM) total.rain++;
      if (pr >= 10) total.heavyRain++;
      if ((d.snowfall_sum?.[i] || 0) > 0) total.snow++;
    }
    if (wi !== null && !Number.isNaN(wi) && wi >= 40) total.wind++;
  }
  const pct = (v) => (total.all ? (100 * v) / total.all : 0);
  return {
    sampleDays: total.all,
    pctSwim: pct(total.swim),
    pctHot28: pct(total.hot28),
    pctHot32: pct(total.hot32),
    pctCoolDay: pct(total.coolDay),
    pctColdNight: pct(total.coldNight),
    pctFrost: pct(total.frost),
    pctRain: pct(total.rain),
    pctHeavyRain: pct(total.heavyRain),
    pctWind: pct(total.wind),
    pctSnow: pct(total.snow),
  };
}

function annualAnalysis(d) {
  const perYear = new Map();
  d.time.forEach((t, i) => {
    const year = +t.slice(0, 4);
    if (!perYear.has(year)) perYear.set(year, []);
    perYear.get(year).push(d.temperature_2m_mean[i]);
  });
  return [...perYear.keys()].sort((a, b) => a - b).map((year) => ({
    year,
    mean: mean(perYear.get(year)),
  }));
}

function monthlyAnalysis(d) {
  const perMonth = Array.from({ length: 12 }, () => ({ tmax: [], tmin: [], rain: [] }));
  d.time.forEach((t, i) => {
    const m = +t.slice(5, 7) - 1;
    perMonth[m].tmax.push(d.temperature_2m_max[i]);
    perMonth[m].tmin.push(d.temperature_2m_min[i]);
    perMonth[m].rain.push(d.precipitation_sum[i] || 0);
  });
  return perMonth.map((m) => ({
    tmax: mean(m.tmax), tmin: mean(m.tmin), rain: mean(m.rain),
  }));
}

function notableEvents(d) {
  let hottest = { i: null, v: -Infinity };
  let coldest = { i: null, v: Infinity };
  let wettest = { i: null, v: -Infinity };
  let windiest = { i: null, v: -Infinity };
  let snowiest = { i: null, v: -Infinity };
  d.time.forEach((t, i) => {
    const tx = d.temperature_2m_max[i];
    const tn = d.temperature_2m_min[i];
    const pr = d.precipitation_sum[i];
    const wi = d.wind_speed_10m_max?.[i];
    const sn = d.snowfall_sum?.[i];
    if (tx !== null && tx > hottest.v) hottest = { i, v: tx };
    if (tn !== null && tn < coldest.v) coldest = { i, v: tn };
    if (pr !== null && pr > wettest.v) wettest = { i, v: pr };
    if (wi !== null && wi > windiest.v) windiest = { i, v: wi };
    if (sn !== null && sn > snowiest.v) snowiest = { i, v: sn };
  });

  const heat = longestRun(d.temperature_2m_max.map((v) => v !== null && v >= HEAT_THRESHOLD_C));
  const freeze = longestRun(d.temperature_2m_min.map((v) => v !== null && v <= FROST_THRESHOLD_C));

  const heatStartIdx = heat.length > 1 && heat.endIndex >= 0 ? heat.endIndex - heat.length + 1 : null;

  return {
    hottest,
    coldest,
    wettest,
    windiest,
    snowiest: snowiest.v > 0 ? snowiest : null,
    heatwave: heatStartIdx !== null
      ? { days: heat.length, from: d.time[heatStartIdx], to: d.time[heat.endIndex] }
      : null,
    coldSnap: freeze.length > 2
      ? { days: freeze.length, to: d.time[freeze.endIndex] }
      : null,
  };
}

function annualRecords(annual) {
  if (!annual.length) return null;
  const sorted = [...annual].filter((a) => a.mean !== null).sort((a, b) => b.mean - a.mean);
  if (!sorted.length) return null;
  return { warmest: sorted[0], coldest: sorted[sorted.length - 1] };
}

/* ---------- Conseils vacances ---------- */

function buildPackingList(s) {
  return [
    { icon: "⛱️", label: "Chapeau / casquette + lunettes", likely: s.pctHot28 >= 15 },
    { icon: "🧴", label: "Crème solaire", likely: s.pctHot28 >= 15 || s.pctSwim >= 25 },
    { icon: "🦟", label: "Anti-moustiques", likely: s.pctSwim >= 25 && s.pctFrost === 0 },
    { icon: "👙", label: "Maillot de bain + serviette", likely: s.pctSwim >= 25 },
    { icon: "🩴", label: "Sandales / tongs", likely: s.pctSwim >= 50 },
    { icon: "👕", label: "Vêtements légers (coton, lin)", likely: s.pctSwim >= 40 },
    { icon: "🧥", label: "Pull ou veste légère (soirées)", likely: s.pctColdNight >= 25 },
    { icon: "🧣", label: "Écharpe, bonnet, gants", likely: s.pctFrost >= 10 || s.pctColdNight >= 60 },
    { icon: "☔", label: "Imperméable ou parapluie", likely: s.pctRain >= 25 },
    { icon: "👟", label: "Chaussures de marche imperméables", likely: s.pctRain >= 40 || s.pctHeavyRain >= 5 },
    { icon: "🧤", label: "Gants techniques (sport d'hiver)", likely: s.pctSnow >= 15 },
    { icon: "❄️", label: "Crème solaire « neige » + masque ski", likely: s.pctSnow >= 15 },
  ];
}

function buildActivities(s) {
  const act = [];
  const add = (icon, label, score, why) => act.push({ icon, label, score, why });
  add("🏖️", "Plage / baignade / farniente",
    s.pctSwim >= 50 && s.pctRain < 30 ? 3 : s.pctSwim >= 25 ? 2 : 1,
    `journées ≥ 24 °C favorables : ${fmt(s.pctSwim, 0)} % ; pluie : ${fmt(s.pctRain, 0)} %`);
  add("🥾", "Randonnée / découverte à pied",
    s.pctHot32 < 25 && s.pctRain < 45 ? 3 : 2,
    `chaleur extrême ≥ 32 °C : ${fmt(s.pctHot32, 0)} % ; pluie : ${fmt(s.pctRain, 0)} %`);
  add("🚴", "Vélo / circuits",
    s.pctRain < 35 && s.pctWind < 25 ? 3 : 2,
    `vents ≥ 40 km/h : ${fmt(s.pctWind, 0)} % ; pluie : ${fmt(s.pctRain, 0)} %`);
  add("🛶", "Paddle / kayak / voile légère",
    s.pctSwim >= 40 && s.pctWind < 30 ? 3 : s.pctWind < 45 ? 2 : 1,
    `vents ≥ 40 km/h : ${fmt(s.pctWind, 0)} % ; chaleur : ${fmt(s.pctSwim, 0)} %`);
  add("🏛️", "Visites culturelles / musées / villes",
    s.pctRain >= 40 || s.pctHot32 >= 30 ? 3 : 2,
    `parfait en cas de pluie (${fmt(s.pctRain, 0)} %) ou de forte chaleur (${fmt(s.pctHot32, 0)} %)`);
  add("♨️", "Spa / thermes / détente en intérieur",
    s.pctColdNight >= 40 || s.pctRain >= 40 ? 3 : 1,
    `nuits ≤ 10 °C : ${fmt(s.pctColdNight, 0)} % ; pluie : ${fmt(s.pctRain, 0)} %`);
  add("🎿", "Sports d'hiver (ski, raquettes)",
    s.pctSnow >= 20 ? 3 : s.pctFrost >= 40 ? 2 : 0,
    `neige observée : ${fmt(s.pctSnow, 0)} % ; gel : ${fmt(s.pctFrost, 0)} %`);
  add("🧗", "Escalade / via ferrata",
    s.pctRain < 25 && s.pctHot32 < 20 ? 3 : 1,
    `rocher sec probable : ${fmt(100 - s.pctRain, 0)} % ; canicule : ${fmt(s.pctHot32, 0)} %`);
  return act;
}

const ACT_LABELS = { 3: "Idéal", 2: "Possible", 1: "Peu adapté", 0: "À éviter" };

function renderAdvice(s, period) {
  const toPack = buildPackingList(s).filter((it) => it.likely);
  const skipList = buildPackingList(s).filter((it) => !it.likely);
  const chip = (it) => `<span class="chip">${it.icon} ${it.label}</span>`;
  const html = `
    <h4>Prévoir dans la valise</h4>
    <div class="chips">${toPack.length ? toPack.map(chip).join("") : "<em>Rien de particulier selon le climat de la période.</em>"}</div>
    <h4>Généralement inutile</h4>
    <div class="chips muted">${skipList.map(chip).join("")}</div>
    <h4>Conditions historiques sur ce créneau</h4>
    <div class="chips">
      <span class="chip">🌧️ Pluie ≥ ${RAINY_MM} mm : ${fmt(s.pctRain, 0)} % des jours</span>
      <span class="chip">☀️ ≥ 28 °C : ${fmt(s.pctHot28, 0)} %</span>
      <span class="chip">🔥 ≥ 32 °C : ${fmt(s.pctHot32, 0)} %</span>
      <span class="chip">🌙 Nuit ≤ 10 °C : ${fmt(s.pctColdNight, 0)} %</span>
      <span class="chip">🧊 Gel : ${fmt(s.pctFrost, 0)} %</span>
      <span class="chip">💨 Vent ≥ 40 km/h : ${fmt(s.pctWind, 0)} %</span>
    </div>
    <p class="src-note">Sur ${s.sampleDays} jours d'historique du ${frenchShortDate(period.start)} au ${frenchShortDate(period.end)} (toutes années confondues).</p>`;
  document.getElementById("packing").innerHTML = html;

  const groups = [3, 2, 1, 0];
  const byStatus = {};
  groups.forEach((g) => { byStatus[g] = []; });
  buildActivities(s).forEach((a) => byStatus[a.score].push(a));
  const actsHtml = groups
    .filter((g) => byStatus[g].length)
    .map((g) => `
      <div class="act-group">
        <div class="act-title status-${g}">${ACT_LABELS[g]}</div>
        ${byStatus[g].map((a) =>
          `<div class="act-item">${a.icon} <strong>${a.label}</strong> — <span class="why">${a.why}</span></div>`
        ).join("")}
      </div>`)
    .join("");
  document.getElementById("activities").innerHTML = `<div class="acts">${actsHtml}</div>`;
}

/* ---------- Rendu ---------- */

function renderNarrative(d, place, period, annual, sinceYear, powerPeriod, forecast, stats) {
  const yearSpan = `${sinceYear}–${annual[annual.length - 1]?.year ?? ""}`;
  const items = [];

  const dominant = period.catPct[0];
  const others = period.catPct.filter((c) => c.cat !== dominant.cat && c.pct >= 5);
  const othersTxt = others.map((c) => `${c.cat.toLowerCase()} (${fmt(c.pct, 0)} %)`).join(", ");
  items.push(
    `Du ${frenchShortDate(period.start)} au ${frenchShortDate(period.end)}, le temps y est ` +
    `<strong>généralement ${dominant.cat.toLowerCase()}</strong>` +
    (othersTxt ? `, avec aussi : ${othersTxt}` : "") + `.`);

  items.push(
    `Températures moyennes : <strong>${fmt(period.tmax)} °C la journée</strong> ` +
    `(maximale) et <strong>${fmt(period.tmin)} °C la nuit</strong> (minimale). ` +
    `Journées ≥ 28 °C dans ${fmt(stats.pctHot28, 0)} % des cas, nuits ≤ 10 °C dans ` +
    `${fmt(stats.pctColdNight, 0)} % des cas.`);

  items.push(
    `Il pleut (${RAINY_MM} mm ou plus par jour) environ <strong>` +
    `${fmt((100 * period.rainDays) / Math.max(period.count, 1), 0)} % des jours</strong>` +
    ` de la période, pour ${fmt(period.totalPrecip)} mm/jour en moyenne.`);

  const last5 = period.yearlyStats.slice(-5).map((s) => s.mean).filter((v) => v !== null);
  const slopeLast5 = slopePerYear(last5);
  items.push(
    `Sur les <strong>5 dernières années</strong>, la tendance pour ces dates est ` +
    `<strong>${trendWord(slopeLast5)}</strong>` +
    (slopeLast5 !== null
      ? ` (${slopeLast5 >= 0 ? "+" : ""}${fmt(slopeLast5, 2)} °C/an de variation des températures moyennes)`
      : "") + `.`);

  const allMeans = annual.map((a) => a.mean).filter((v) => v !== null);
  const slopeAll = slopePerYear(allMeans);
  if (slopeAll !== null) {
    const n5 = Math.min(5, allMeans.length);
    const last = allMeans.slice(-n5);
    const prev = allMeans.slice(Math.max(0, allMeans.length - 2 * n5), allMeans.length - n5);
    const delta = prev.length ? mean(last) - mean(prev) : null;
    items.push(
      `Climat global ${place.name} : réchauffement moyen de ` +
      `<strong>${slopeAll >= 0 ? "+" : ""}${fmt(slopeAll, 2)} °C/an</strong> sur ${yearSpan}` +
      (delta !== null
        ? ` ; les ${n5} dernières années sont <strong>${delta >= 0 ? "+" : ""}${fmt(delta)} °C</strong> ` +
          `par rapport à la période précédente`
        : "") + `.`);
  }

  items.push(
    `Records pour ce même créneau calendaire : <strong class="warm">${fmt(d.temperature_2m_max[period.hottest])} °C</strong> ` +
    `le ${frenchDate(d.time[period.hottest])} (record de chaleur), ` +
    `<strong class="cold">${fmt(d.temperature_2m_min[period.coldest])} °C</strong> ` +
    `le ${frenchDate(d.time[period.coldest])} (record de froid).`);

  if (powerPeriod) {
    const pYears = powerPeriod.yearlyStats.map((s) => s.year);
    const pLast5 = powerPeriod.yearlyStats.slice(-5).map((s) => s.mean).filter((v) => v !== null);
    const pSlope = slopePerYear(pLast5);
    if (pYears.length >= 5 && period.tmax !== null) {
      const dMax = powerPeriod.tmax - period.tmax;
      const dMin = powerPeriod.tmin - period.tmin;
      const agree = pSlope !== null && slopeLast5 !== null
        && Math.sign(pSlope) === Math.sign(slopeLast5);
      items.push(
        `Croisement avec la source indépendante <strong>NASA POWER</strong> (données à partir de ${pYears[0]}) : ` +
        `sur la même période, ${fmt(powerPeriod.tmax)} °C le jour / ${fmt(powerPeriod.tmin)} °C la nuit ` +
        `(écarts ${dMax >= 0 ? "+" : ""}${fmt(dMax)} °C / ${dMin >= 0 ? "+" : ""}${fmt(dMin)} °C), ` +
        `tendance 5 ans ${trendWord(pSlope)} — les deux sources sont ` +
        `<strong>${agree ? "concordantes" : "divergentes"}</strong>.`);
    }
  }

  if (forecast) {
    const fDays = forecast.tmax.filter((v) => v !== null).length;
    const fTmax = mean(forecast.tmax);
    const fTmin = mean(forecast.tmin);
    const fRain = forecast.rain.filter((v) => v !== null && v >= RAINY_MM).length;
    items.push(
      `Prochains jours (<strong>modèle ARPEGE de Météo-France</strong>, ${fDays} jours) : ` +
      `maximum moyen ${fmt(fTmax)} °C, minimum moyen ${fmt(fTmin)} °C, ` +
      `dont <strong>${fRain} jour${fRain > 1 ? "s" : ""} de pluie</strong> (≥ ${RAINY_MM} mm).`);
  }

  const el = document.getElementById("narrative");
  el.innerHTML = `<h3>📌 En résumé</h3><ul>${items.map((t) => `<li>${t}</li>`).join("")}</ul>`;
}

function renderCards(place, period, stats) {
  const dominant = period.catPct[0];
  const w = Object.values(WMO).find((x) => x.cat === dominant.cat);
  const cards = [
    { icon: w ? w.icon : "🗓️", label: "Temps dominant sur la période", value: dominant.cat, sub: `du ${frenchShortDate(period.start)} au ${frenchShortDate(period.end)}, renouvelé chaque année` },
    { icon: "🌞", label: "Température moyenne journée", value: `${fmt(period.tmax)} °C`, sub: "maximale quotidienne" },
    { icon: "🌙", label: "Température moyenne nuit", value: `${fmt(period.tmin)} °C`, sub: "minimale quotidienne" },
    { icon: "🌧️", label: "Jours de pluie", value: `${fmt(stats.pctRain, 0)} %`, sub: `≥ ${RAINY_MM} mm/jour pendant la période` },
  ];
  document.getElementById("cards").innerHTML = cards
    .map((c) => `<div class="stat-card"><div class="icon">${c.icon}</div><div class="label">${c.label}</div><div class="value">${c.value}</div><div class="sub">${c.sub}</div></div>`)
    .join("");
}

function renderPeriodChart(period, powerPeriod) {
  const ys = period.yearlyStats;
  const years = ys.map((s) => s.year);
  const tmax = ys.map((s) => s.tmax);
  const tmin = ys.map((s) => s.tmin);
  const n5 = Math.min(5, ys.length);
  const trendAll = linregSeries(tmax.map((v, i) => (v + tmin[i]) / 2));

  const powerByYear = new Map((powerPeriod ? powerPeriod.yearlyStats : [])
    .filter((s) => s.tmax !== null)
    .map((s) => [s.year, s]));
  const pMax = powerByYear.size ? years.map((y) => (powerByYear.get(y) || {}).tmax ?? null) : [];
  const pMin = powerByYear.size ? years.map((y) => (powerByYear.get(y) || {}).tmin ?? null) : [];

  charts.push(new Chart(document.getElementById("chart-period"), {
    type: "line",
    data: {
      labels: years,
      datasets: [
        { label: "Max moy. (journée) °C — ERA5", data: tmax, borderColor: "#d9534f", backgroundColor: "#d9534f22", tension: .3, pointRadius: years.length > 60 ? 0 : 2 },
        { label: "Min moy. (nuit) °C — ERA5", data: tmin, borderColor: "#3a7bd5", backgroundColor: "#3a7bd522", tension: .3, pointRadius: years.length > 60 ? 0 : 2 },
        { label: "Tendance globale (moyenne)", data: trendAll, borderColor: "#5b6b7b", borderDash: [6, 4], pointRadius: 0, tension: 0 },
        { label: "5 dernières années", data: years.map((y, i) => (i >= years.length - n5 ? tmax[i] : null)), borderColor: "#e8a13a", backgroundColor: "#e8a13a", pointRadius: 4, showLine: false },
        ...(powerByYear.size ? [
          { label: "NASA POWER max", data: pMax, borderColor: "#d9534f", borderDash: [2, 3], pointRadius: 0, tension: .3 },
          { label: "NASA POWER min", data: pMin, borderColor: "#3a7bd5", borderDash: [2, 3], pointRadius: 0, tension: .3 },
        ] : []),
      ],
    },
    options: {
      interaction: { mode: "index", intersect: false },
      scales: {
        y: { title: { display: true, text: "°C" } },
        x: { ticks: { maxTicksLimit: 12 } },
      },
    },
  }));
}

function renderForecastChart(forecast) {
  const labels = forecast.time.map((t) => t.slice(8, 10) + "/" + t.slice(5, 7));
  charts.push(new Chart(document.getElementById("chart-forecast"), {
    type: "bar",
    data: {
      labels,
      datasets: [
        { type: "line", label: "Max °C (journée)", data: forecast.tmax, borderColor: "#d9534f", tension: .3, pointRadius: 3 },
        { type: "line", label: "Min °C (nuit)", data: forecast.tmin, borderColor: "#3a7bd5", tension: .3, pointRadius: 3 },
        { type: "bar", label: "Précipitations (mm)", data: forecast.rain, backgroundColor: "#1c9fd655" },
      ],
    },
    options: {
      scales: { y: { title: { display: false } } },
    },
  }));
}

function renderMonthlyChart(monthly) {
  charts.push(new Chart(document.getElementById("chart-monthly"), {
    type: "bar",
    data: {
      labels: MONTH_NAMES.map((m) => m[0].toUpperCase() + m.slice(1, 3)),
      datasets: [
        { type: "line", label: "Max moy. (journée) °C", data: monthly.map((m) => m.tmax), borderColor: "#d9534f", tension: .3, pointRadius: 3 },
        { type: "line", label: "Min moy. (nuit) °C", data: monthly.map((m) => m.tmin), borderColor: "#3a7bd5", tension: .3, pointRadius: 3 },
        { type: "bar", label: "Précipitations moy. (mm/jour)", data: monthly.map((m) => m.rain), backgroundColor: "#1c9fd655", yAxisID: "y-rain" },
      ],
    },
    options: {
      scales: {
        y: { title: { display: true, text: "°C" } },
        "y-rain": { position: "right", title: { display: true, text: "mm/jour" }, grid: { drawOnChartArea: false } },
      },
    },
  }));
}

function renderAnnualChart(annual) {
  const means = annual.map((a) => a.mean);
  charts.push(new Chart(document.getElementById("chart-annual"), {
    type: "line",
    data: {
      labels: annual.map((a) => a.year),
      datasets: [
        { label: "Température moyenne annuelle °C", data: means, borderColor: "#0b6ecc", backgroundColor: "#0b6ecc22", tension: .3, pointRadius: annual.length > 60 ? 0 : 2, fill: true },
        { label: "Tendance (régression)", data: linregSeries(means), borderColor: "#e8a13a", borderDash: [6, 4], pointRadius: 0, tension: 0 },
      ],
    },
    options: {
      interaction: { mode: "index", intersect: false },
      scales: {
        y: { title: { display: true, text: "°C" } },
        x: { ticks: { maxTicksLimit: 12 } },
      },
    },
  }));
}

function renderEvents(d, events, annualRecordsData) {
  const rows = [];
  const add = (icon, html) => rows.push(`<li>${icon} ${html}</li>`);

  add("🔥", `Record de chaleur absolu : <strong>${fmt(events.hottest.v)} °C</strong> le ${frenchDate(d.time[events.hottest.i])}.`);
  add("🧊", `Record de froid absolu : <strong>${fmt(events.coldest.v)} °C</strong> le ${frenchDate(d.time[events.coldest.i])}.`);
  add("🌊", `Jour le plus arrosé : <strong>${fmt(events.wettest.v)} mm</strong> de précipitations le ${frenchDate(d.time[events.wettest.i])}.`);
  add("💨", `Vent le plus fort : <strong>${fmt(events.windiest.v)} km/h</strong> le ${frenchDate(d.time[events.windiest.i])}.`);
  if (events.snowiest) {
    add("❄️", `Chute de neige la plus forte : <strong>${fmt(events.snowiest.v)} cm</strong> le ${frenchDate(d.time[events.snowiest.i])}.`);
  }
  if (events.heatwave) {
    add("🥵", `Vague de chaleur la plus longue : <strong>${events.heatwave.days} jours consécutifs</strong> ≥ ${HEAT_THRESHOLD_C} °C, du ${frenchDate(events.heatwave.from)} au ${frenchDate(events.heatwave.to)}.`);
  }
  if (events.coldSnap) {
    add("🥶", `Froid le plus persistant : <strong>${events.coldSnap.days} jours consécutifs</strong> ≤ 0 °C jusqu'au ${frenchDate(events.coldSnap.to)}.`);
  }
  if (annualRecordsData) {
    add("📈", `Année la plus chaude : <strong>${annualRecordsData.warmest.year}</strong> (${fmt(annualRecordsData.warmest.mean)} °C de moyenne) ; année la plus froide : <strong>${annualRecordsData.coldest.year}</strong> (${fmt(annualRecordsData.coldest.mean)} °C).`);
  }

  document.getElementById("events").innerHTML = `<ul>${rows.join("")}</ul>`;
}

/* ---------- Orchestration ---------- */

async function analyze() {
  const lat = parseFloat(searchInput.dataset.lat);
  const lon = parseFloat(searchInput.dataset.lon);
  if (!searchInput.dataset.lat || Number.isNaN(lat)) {
    setStatus("Choisissez d'abord un lieu dans la liste de suggestions.", true);
    return;
  }

  const periodRaw = periodFromInputs();
  if (!periodRaw) {
    setStatus("Choisissez une période : dates de début et de fin (ou une durée en jours entre 1 et 90), avec fin ≥ début.", true);
    return;
  }
  const period = { start: periodRaw.start, end: periodRaw.end };
  if (periodRaw.duration > 90) {
    setStatus("Période trop longue (90 jours maximum).", true);
    return;
  }

  const sinceYear = document.getElementById("since").value;
  const label = searchInput.value.trim();
  const place = { name: label.split(",")[0], latitude: lat, longitude: lon };

  const btn = document.getElementById("analyze");
  btn.disabled = true;
  setStatus("Chargement de l'historique météo (peut prendre quelques secondes la première fois)…");
  document.getElementById("results").hidden = true;
  document.getElementById("forecast-block").hidden = true;
  destroyCharts();

  try {
    const daily = await loadArchive(place, sinceYear);
    if (!daily || !daily.time || daily.time.length < 365 * 3) {
      throw new Error("Historique trop court pour ce lieu — essayez une année de départ plus récente.");
    }

    setStatus(`Analyse de ${daily.time.length} jours de données (${daily.time[0]} → ${daily.time[daily.time.length - 1]})…`);

    const period2 = { ...period, duration: windowLengthDays(period.start, period.end) };
    const analysis = periodAnalysis(daily, period.start, period.end);
    analysis.start = period2.start;
    analysis.end = period2.end;
    analysis.duration = period2.duration;
    const stats = conditionStats(daily, period.start, period.end);
    const annual = annualAnalysis(daily);
    const monthly = monthlyAnalysis(daily);
    const events = notableEvents(daily);
    const records = annualRecords(annual);

    let powerPeriod = null;
    let powerError = null;
    if (document.getElementById("use-power").checked) {
      setStatus("Croisement avec la source indépendante NASA POWER…");
      try {
        const powerDaily = await loadPowerDaily(place, +sinceYear);
        if (powerDaily.time.length >= 365 * 5) {
          powerPeriod = periodAnalysis(powerDaily, period.start, period.end);
        } else {
          powerError = "historique POWER trop court";
        }
      } catch (err) {
        powerError = err.message;
      }
    }

    let forecast = null;
    try {
      forecast = await loadForecast(place, 6);
    } catch {
      forecast = null;
    }

    document.getElementById("place-title").textContent = label;
    renderNarrative(daily, place, analysis, annual, +sinceYear, powerPeriod, forecast, stats);
    renderAdvice(stats, analysis);
    if (powerError) {
      document.getElementById("events").insertAdjacentHTML("beforebegin",
        `<p class="src-note">⚠️ Croisement NASA POWER indisponible (${powerError}).</p>`);
    }
    if (forecast) {
      document.getElementById("forecast-block").hidden = false;
      renderForecastChart(forecast);
    }
    if (typeof Chart === "undefined") {
      throw new Error("La bibliothèque de graphiques (CDN) n'a pas pu être chargée — vérifiez votre connexion Internet.");
    }

    renderCards(place, analysis, stats);
    renderPeriodChart(analysis, powerPeriod);
    renderMonthlyChart(monthly);
    renderAnnualChart(annual);
    renderEvents(daily, events, records);

    document.getElementById("results").hidden = false;
    setStatus(`Analyse terminée — données ${daily.time[0]} → ${daily.time[daily.time.length - 1]}.`);
  } catch (err) {
    console.error(err);
    setStatus(`Échec de l'analyse : ${err.message}`, true);
  } finally {
    btn.disabled = false;
  }
}

document.getElementById("analyze").addEventListener("click", analyze);

startDateInput.addEventListener("change", endFromStartAndDuration);
durationInput.addEventListener("change", endFromStartAndDuration);
endDateInput.addEventListener("change", () => {
  const start = startDateInput.value;
  const end = endDateInput.value;
  if (start && end && new Date(end) >= new Date(start)) {
    durationInput.value = windowLengthDays(start, end);
  }
});

(function init() {
  const d = new Date();
  const start = new Date(d);
  start.setDate(start.getDate() + 21);
  const iso = (x) => x.toISOString().slice(0, 10);
  startDateInput.value = iso(d);
  durationInput.value = "14";
  endFromStartAndDuration();
})();
