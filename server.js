"use strict";

const express = require("express");
const path = require("path");

const app = express();
const port = process.env.PORT || 3000;
const apiKey = process.env.OPENWEATHER_API_KEY;

const OPENWEATHER_BASE_URL = "https://api.openweathermap.org";
const FORECAST_DAYS = 3;

const MAX_PLACE_MATCHES = 5;

const OPEN_METEO_FORECAST_URL = "https://api.open-meteo.com/v1/forecast";
const GRID_SIZE = 5;
const GRID_SPACING_KM = 15;
const KM_PER_DEGREE_LATITUDE = 111.32;
const WET_DAY_THRESHOLD_MM = 1;
const AREA_CACHE_LIFETIME_MS = 30 * 60 * 1000;
const COMPASS_DIRECTIONS = ["north", "north-east", "east", "south-east", "south", "south-west", "west", "north-west"];

const areaForecastCache = {};

if (!apiKey) {
  console.error("OPENWEATHER_API_KEY is not set. Copy .env.example to .env and add your key.");
  process.exit(1);
}

const AIR_QUALITY_LEVELS = ["Good", "Fair", "Moderate", "Poor", "Very Poor"];

// Pollutants we report on, with the lower bound of each air quality band after "Good" (µg/m³).
const POLLUTANTS = [
  {
    code: "so2",
    name: "Sulphur dioxide (SO₂)",
    symbol: "SO₂",
    bandLowerBounds: [20, 80, 250, 350],
    healthRisk: "Irritates the nose, throat and airways and can trigger wheezing and chest tightness, particularly for people with asthma."
  },
  {
    code: "no2",
    name: "Nitrogen dioxide (NO₂)",
    symbol: "NO₂",
    bandLowerBounds: [40, 70, 150, 200],
    healthRisk: "Inflames the lining of the lungs, worsens asthma and lowers resistance to respiratory infections."
  },
  {
    code: "pm10",
    name: "Coarse particulate matter (PM10)",
    symbol: "PM10",
    bandLowerBounds: [20, 50, 100, 200],
    healthRisk: "Inhaled particles irritate the eyes, nose and throat and can aggravate asthma and other lung conditions."
  },
  {
    code: "pm2_5",
    name: "Fine particulate matter (PM2.5)",
    symbol: "PM2.5",
    bandLowerBounds: [10, 25, 50, 75],
    healthRisk: "Fine particles reach deep into the lungs and the bloodstream, aggravating heart and lung disease and increasing the risk of respiratory illness."
  },
  {
    code: "o3",
    name: "Ozone (O₃)",
    symbol: "O₃",
    bandLowerBounds: [60, 100, 140, 180],
    healthRisk: "Causes coughing, throat irritation and reduced lung function, especially during exercise outdoors."
  },
  {
    code: "co",
    name: "Carbon monoxide (CO)",
    symbol: "CO",
    bandLowerBounds: [4400, 9400, 12400, 15400],
    healthRisk: "Reduces the amount of oxygen the blood can carry, causing headaches, dizziness and added strain for people with heart disease."
  }
];

// Health advice shown alongside a pollutant warning, by level.
const ADVICE_BY_LEVEL = {
  Fair: "Unusually sensitive people may notice mild symptoms.",
  Moderate: "Sensitive groups (children, older adults, people with asthma or heart disease) should limit prolonged outdoor exertion.",
  Poor: "Everyone may begin to feel effects; sensitive groups should avoid outdoor exertion.",
  "Very Poor": "Health alert: everyone should avoid outdoor exertion and consider wearing a mask outdoors."
};

// Serve the front end and register the API routes.
app.use(express.static(path.resolve(__dirname, "public")));

app.get("/api/forecast/:city", sendForecast);
app.get("/api/air-quality", sendAirQuality);
app.get("/api/area-forecast", sendAreaForecast);

// Fallback for unknown routes.
app.use((req, res) => {
  res.status(404).json({ error: "Resource not found." });
});

app.listen(port, () => {
  console.log(`Weather packing server is running at http://localhost:${port}`);
});

// GET /api/forecast/:city - 3-day forecast for a city, using ?match= to pick between places with the same name.
async function sendForecast(req, res) {
  const city = req.params.city.trim();
  if (city === "") {
    res.status(400).json({ error: "Please provide a city name." });
    return;
  }

  try {
    const places = await findPlaces(city);
    const matchIndex = req.query.match === undefined ? 0 : Number(req.query.match);
    const place = places.find((candidate) => candidate.matchIndex === matchIndex);
    if (!place) {
      res.status(400).json({ error: `There is no match ${req.query.match} for "${city}".` });
      return;
    }

    const forecast = await fetchFromOpenWeather("data/2.5/forecast", {
      lat: place.lat, lon: place.lon, units: "metric"
    });
    res.json({
      city: {
        name: place.name,
        state: place.state,
        country: place.country,
        lat: forecast.city.coord.lat,
        lon: forecast.city.coord.lon
      },
      otherMatches: listOtherPlaces(places, place),
      days: summariseForecastByDay(forecast.list, forecast.city.timezone)
    });
  } catch (error) {
    sendError(res, error, `Could not find a forecast for "${city}".`);
  }
}

// GET /api/air-quality - current air quality and pollutant warnings for a lat/lon.
async function sendAirQuality(req, res) {
  const lat = parseFloat(req.query.lat);
  const lon = parseFloat(req.query.lon);
  if (isNaN(lat) || isNaN(lon)) {
    res.status(400).json({ error: "lat and lon query parameters must be numbers." });
    return;
  }

  try {
    const airPollution = await fetchFromOpenWeather("data/2.5/air_pollution", { lat: lat, lon: lon });
    const reading = airPollution.list[0];
    const pollutants = classifyPollutants(reading.components);
    res.json({
      overallLevel: AIR_QUALITY_LEVELS[reading.main.aqi - 1],
      pollutants: pollutants,
      warnings: buildPollutantWarnings(pollutants)
    });
  } catch (error) {
    sendError(res, error, "Could not find air quality data for that location.");
  }
}

// GET /api/area-forecast - forecast for a grid around a lat/lon, cached for 30 minutes.
async function sendAreaForecast(req, res) {
  const lat = parseFloat(req.query.lat);
  const lon = parseFloat(req.query.lon);
  if (isNaN(lat) || isNaN(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    res.status(400).json({ error: "lat and lon query parameters must be valid coordinates." });
    return;
  }

  const cacheKey = `${lat.toFixed(2)},${lon.toFixed(2)}`;
  const cached = areaForecastCache[cacheKey];
  if (cached && Date.now() - cached.storedAt < AREA_CACHE_LIFETIME_MS) {
    res.json(cached.areaForecast);
    return;
  }

  try {
    const gridPoints = buildGridPoints(lat, lon);
    const pointForecasts = await fetchGridForecasts(gridPoints);
    const areaForecast = summariseAreaForecast(gridPoints, pointForecasts);
    areaForecastCache[cacheKey] = { storedAt: Date.now(), areaForecast: areaForecast };
    res.json(areaForecast);
  } catch (error) {
    console.error(error.message);
    res.status(502).json({ error: "The area forecast is unavailable right now." });
  }
}

// Looks up places matching a city name, dropping duplicate name/state/country entries.
async function findPlaces(city) {
  const matches = await fetchFromOpenWeather("geo/1.0/direct", { q: city, limit: MAX_PLACE_MATCHES });
  if (matches.length === 0) {
    const error = new Error(`No place found for "${city}"`);
    error.upstreamStatus = 404;
    throw error;
  }

  const places = [];
  matches.forEach((match, matchIndex) => {
    const place = {
      matchIndex: matchIndex,
      name: match.name,
      state: match.state || null,
      country: match.country,
      lat: match.lat,
      lon: match.lon
    };
    const alreadyListed = places.find((listed) =>
      listed.name === place.name && listed.state === place.state && listed.country === place.country);
    if (!alreadyListed) {
      places.push(place);
    }
  });
  return places;
}

// Every place except the chosen one, so the user can switch to another match.
function listOtherPlaces(places, chosenPlace) {
  const otherPlaces = [];
  places.forEach((place) => {
    if (place !== chosenPlace) {
      otherPlaces.push(place);
    }
  });
  return otherPlaces;
}

// Calls an OpenWeatherMap endpoint with the API key and returns the JSON, throwing on a non-OK response.
async function fetchFromOpenWeather(endpoint, queryParameters) {
  const query = new URLSearchParams(queryParameters);
  query.append("appid", apiKey);
  const response = await fetch(`${OPENWEATHER_BASE_URL}/${endpoint}?${query}`);

  if (!response.ok) {
    const error = new Error(`OpenWeatherMap responded with status ${response.status}`);
    error.upstreamStatus = response.status;
    throw error;
  }
  return response.json();
}

// Sends a 404 if the upstream said not found, otherwise a generic 502.
function sendError(res, error, notFoundMessage) {
  if (error.upstreamStatus === 404) {
    res.status(404).json({ error: notFoundMessage });
    return;
  }
  console.error(error.message);
  res.status(502).json({ error: "The weather service is unavailable right now. Please try again later." });
}

// Groups the 3-hourly forecast entries by the city's local date and summarises the first few days.
function summariseForecastByDay(forecastEntries, timezoneOffsetSeconds) {
  const days = [];

  forecastEntries.forEach((entry) => {
    const localDate = new Date((entry.dt + timezoneOffsetSeconds) * 1000).toISOString().slice(0, 10);
    let day = days.find((existingDay) => existingDay.date === localDate);
    if (!day) {
      day = { date: localDate, entries: [] };
      days.push(day);
    }
    day.entries.push(entry);
  });

  return days.slice(0, FORECAST_DAYS).map((day) => summariseDay(day.date, day.entries));
}

// Min/max/average temperature, average wind and total rainfall for one day's entries.
function summariseDay(date, entries) {
  let minTemperature = entries[0].main.temp;
  let maxTemperature = entries[0].main.temp;
  let temperatureTotal = 0;
  let windSpeedTotal = 0;
  let rainfall = 0;

  entries.forEach((entry) => {
    const temperature = entry.main.temp;
    if (temperature < minTemperature) {
      minTemperature = temperature;
    }
    if (temperature > maxTemperature) {
      maxTemperature = temperature;
    }
    temperatureTotal += temperature;
    windSpeedTotal += entry.wind.speed;
    if (entry.rain) {
      rainfall += entry.rain["3h"];
    }
  });

  return {
    date: date,
    minTemperature: roundToOneDecimal(minTemperature),
    maxTemperature: roundToOneDecimal(maxTemperature),
    averageTemperature: roundToOneDecimal(temperatureTotal / entries.length),
    averageWindSpeed: roundToOneDecimal(windSpeedTotal / entries.length),
    rainfall: roundToOneDecimal(rainfall)
  };
}

// Builds a square grid of points centred on the city, each with its distance, direction and map bounds.
function buildGridPoints(centreLat, centreLon) {
  const latStep = GRID_SPACING_KM / KM_PER_DEGREE_LATITUDE;
  const lonStep = GRID_SPACING_KM / (KM_PER_DEGREE_LATITUDE * Math.cos(toRadians(centreLat)));
  const middle = (GRID_SIZE - 1) / 2;
  const gridPoints = [];

  for (let row = 0; row < GRID_SIZE; row++) {
    for (let column = 0; column < GRID_SIZE; column++) {
      const lat = centreLat + (middle - row) * latStep;
      const lon = centreLon + (column - middle) * lonStep;
      const kmEast = (column - middle) * GRID_SPACING_KM;
      const kmNorth = (middle - row) * GRID_SPACING_KM;
      gridPoints.push({
        lat: lat,
        lon: lon,
        distanceKm: Math.round(Math.hypot(kmEast, kmNorth)),
        direction: describeDirection(kmEast, kmNorth),
        bounds: [
          [lat - latStep / 2, lon - lonStep / 2],
          [lat + latStep / 2, lon + lonStep / 2]
        ]
      });
    }
  }
  return gridPoints;
}

// Fetches daily forecasts for every grid point in a single Open-Meteo request.
async function fetchGridForecasts(gridPoints) {
  const query = new URLSearchParams({
    latitude: gridPoints.map((point) => point.lat.toFixed(4)).join(","),
    longitude: gridPoints.map((point) => point.lon.toFixed(4)).join(","),
    daily: "temperature_2m_max,precipitation_sum,wind_speed_10m_max",
    wind_speed_unit: "ms",
    forecast_days: FORECAST_DAYS,
    timezone: "auto"
  });
  const response = await fetch(`${OPEN_METEO_FORECAST_URL}?${query}`);

  if (!response.ok) {
    throw new Error(`Open-Meteo responded with status ${response.status}`);
  }
  return response.json();
}

// Combines the grid forecasts into per-cell values and per-day extremes and rain coverage.
function summariseAreaForecast(gridPoints, pointForecasts) {
  const centreIndex = Math.floor(gridPoints.length / 2);
  const dates = pointForecasts[centreIndex].daily.time;

  const cells = gridPoints.map((point, index) => {
    const daily = pointForecasts[index].daily;
    return {
      bounds: point.bounds,
      distanceKm: point.distanceKm,
      direction: point.direction,
      days: dates.map((date, dayIndex) => ({
        temperature: daily.temperature_2m_max[dayIndex],
        rain: roundToOneDecimal(daily.precipitation_sum[dayIndex]),
        wind: roundToOneDecimal(daily.wind_speed_10m_max[dayIndex])
      }))
    };
  });

  const days = dates.map((date, dayIndex) => {
    let wetCellCount = 0;
    cells.forEach((cell) => {
      if (cell.days[dayIndex].rain >= WET_DAY_THRESHOLD_MM) {
        wetCellCount++;
      }
    });
    return {
      date: date,
      wetCellCount: wetCellCount,
      rainCoverage: roundToTwoDecimals(wetCellCount / cells.length),
      temperature: findExtremes(cells, dayIndex, "temperature", centreIndex),
      rain: findExtremes(cells, dayIndex, "rain", centreIndex),
      wind: findExtremes(cells, dayIndex, "wind", centreIndex)
    };
  });

  const modelCells = new Set(pointForecasts.map((forecast) => `${forecast.latitude},${forecast.longitude}`));

  return {
    source: "Open-Meteo",
    gridSize: GRID_SIZE,
    spacingKm: GRID_SPACING_KM,
    widthKm: GRID_SIZE * GRID_SPACING_KM,
    cellCount: cells.length,
    distinctModelCellCount: modelCells.size,
    wetDayThresholdMm: WET_DAY_THRESHOLD_MM,
    days: days,
    cells: cells
  };
}

// The city's value plus the lowest and highest cells for one measure on one day.
function findExtremes(cells, dayIndex, measure, centreIndex) {
  let lowestIndex = 0;
  let highestIndex = 0;

  cells.forEach((cell, index) => {
    const value = cell.days[dayIndex][measure];
    if (value < cells[lowestIndex].days[dayIndex][measure]) {
      lowestIndex = index;
    }
    if (value > cells[highestIndex].days[dayIndex][measure]) {
      highestIndex = index;
    }
  });

  return {
    cityValue: cells[centreIndex].days[dayIndex][measure],
    lowest: { cellIndex: lowestIndex, value: cells[lowestIndex].days[dayIndex][measure] },
    highest: { cellIndex: highestIndex, value: cells[highestIndex].days[dayIndex][measure] }
  };
}

// Turns an east/north offset into a compass direction like "north-east".
function describeDirection(kmEast, kmNorth) {
  if (kmEast === 0 && kmNorth === 0) {
    return "centre";
  }
  const bearing = (toDegrees(Math.atan2(kmEast, kmNorth)) + 360) % 360;
  return COMPASS_DIRECTIONS[Math.round(bearing / 45) % COMPASS_DIRECTIONS.length];
}

// Assigns an air quality level to each pollutant based on its concentration.
function classifyPollutants(components) {
  return POLLUTANTS.map((pollutant) => {
    const concentration = components[pollutant.code];
    let levelIndex = 0;
    pollutant.bandLowerBounds.forEach((bound) => {
      if (concentration >= bound) {
        levelIndex++;
      }
    });
    return {
      code: pollutant.code,
      name: pollutant.name,
      symbol: pollutant.symbol,
      concentration: concentration,
      goodLimit: pollutant.bandLowerBounds[0],
      level: AIR_QUALITY_LEVELS[levelIndex],
      healthRisk: pollutant.healthRisk
    };
  });
}

// Warnings for any pollutant above "Good", with how far over the limit it is and advice.
function buildPollutantWarnings(pollutants) {
  const warnings = [];
  pollutants.forEach((pollutant) => {
    if (pollutant.level !== "Good") {
      warnings.push({
        code: pollutant.code,
        name: pollutant.name,
        symbol: pollutant.symbol,
        level: pollutant.level,
        concentration: pollutant.concentration,
        goodLimit: pollutant.goodLimit,
        timesGoodLimit: roundToOneDecimal(pollutant.concentration / pollutant.goodLimit),
        healthRisk: pollutant.healthRisk,
        advice: ADVICE_BY_LEVEL[pollutant.level]
      });
    }
  });
  return warnings;
}

// Small numeric helpers.
function roundToOneDecimal(value) {
  return Math.round(value * 10) / 10;
}

function roundToTwoDecimals(value) {
  return Math.round(value * 100) / 100;
}

function toRadians(degrees) {
  return (degrees * Math.PI) / 180;
}

function toDegrees(radians) {
  return (radians * 180) / Math.PI;
}