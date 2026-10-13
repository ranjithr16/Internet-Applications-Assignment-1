"use strict";

const express = require('express');
const path = require("path");

const app = express();
const port = process.env.PORT || 3000;
const apiKey = process.env.OPENWEATHER_API_KEY;

const OPENWEATHER_BASE_URL = "https://api.openweathermap.org";
const FORECAST_DAYS = 3;

const MAX_PLACE_MATCHES = 5;

if (!apiKey) {
  console.error("OPENWEATHER_API_KEY is not set. Copy .env.example to .env and add your key.");
  process.exit(1);
}

app.use(express.static(path.resolve(__dirname, "public")));

app.get("/api/forecast/:city", sendForecast);

app.use((req, res) => {
  res.status(404).json({ error: "Resource not found." });
});

app.listen(port, () => {
  console.log(`Weather packing server is running at http://localhost:${port}`);
});

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

function listOtherPlaces(places, chosenPlace) {
  const otherPlaces = [];
  places.forEach((place) => {
    if (place !== chosenPlace) {
      otherPlaces.push(place);
    }
  });
  return otherPlaces;
}

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

function sendError(res, error, notFoundMessage) {
  if (error.upstreamStatus === 404) {
    res.status(404).json({ error: notFoundMessage });
    return;
  }
  console.error(error.message);
  res.status(502).json({ error: "The weather service is unavailable right now. Please try again later." });
}

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

function roundToOneDecimal(value) {
  return Math.round(value * 10) / 10;
}