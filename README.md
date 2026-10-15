# Internet-Applications-Assignment-1

CSU44000 Internet Applications, Assignment 1: a reactive internet application.

Enter a city and the app tells you what to pack for the next three days and shows the forecast.

## Running it

You need Node.js 20.6 or later (for the built-in `fetch` and `--env-file`) and a free OpenWeatherMap API key from https://home.openweathermap.org/api_keys.

```
npm install
cp .env.example .env
```

Open `.env` and paste your key in place of `your_key_here`, then:

```
npm start
```

The app is at http://localhost:3000. To use a different port, change `PORT` in `.env`.

## What it does

Type a city and press **Get forecast**. The app shows the best match for that name, and if other places share it (Dublin, Ireland and Dublin, Ohio, for example), a **Not the right Dublin?** link lists them so you can switch.

For the chosen place it builds a packing list from the next three days:

- **Umbrella** if any rain is forecast.
- **Warm coat, hat and gloves** if any day drops below 8°C.
- **Light layers** if any day spends time between 8°C and 24°C.
- **Light clothing, sunglasses and sun cream** if any day goes above 24°C.

A single day can trigger more than one item, for example a cold morning that warms up to a mild afternoon. Each item says which days it applies to and the relevant temperatures. Below the list, each day's low, high, average wind and total rain are shown.

## How it is built

The server (`server.js`) is a small Express app. It serves the front end from `public/` and provides a JSON API that calls OpenWeatherMap on the browser's behalf, so the API key never leaves the server.

The front end is Vue 3, loaded as an ES module from unpkg, so there is no build step:

- `public/index.html` holds the page structure and the Vue template.
- `public/app.js` holds the app's state and logic: searching, choosing between matching places, and working out the packing list.
- `public/style.css` holds the styling. The page is a single column by default, becomes two columns (search and packing list on the left, forecast on the right) on screens at least 1240px wide and 720px tall, and stacks the search button under the input on screens narrower than 520px.

### API

`GET /api/forecast/:city?match=n`

Looks up `city` and returns a three-day forecast for one of the matching places. `match` picks which geocoder result to use and defaults to `0`, the best match. The response contains:

- `city`: the chosen place's `name`, `state` (or `null`), `country`, `lat` and `lon`.
- `otherMatches`: the other places with the same name, each with its `matchIndex`, so the browser can request them with `?match=`.
- `days`: three entries with `date`, `minTemperature`, `maxTemperature`, `averageTemperature` (°C), `averageWindSpeed` (m/s) and `rainfall` (mm).

Errors come back as `{ "error": "..." }`, with status 400 for an empty name or a `match` that does not exist, 404 if no place is found, and 502 if OpenWeatherMap is unavailable. Any other path under the server returns a 404 in the same format.

### Outside services

- OpenWeatherMap [Geocoding API](https://openweathermap.org/api/geocoding-api) (`geo/1.0/direct`) to turn a city name into up to five places with coordinates.
- OpenWeatherMap [5 day / 3 hour forecast](https://openweathermap.org/forecast5) (`data/2.5/forecast`, metric units) for the weather.
- Vue 3 from unpkg and the Bricolage Grotesque and Instrument Sans fonts from Google Fonts.