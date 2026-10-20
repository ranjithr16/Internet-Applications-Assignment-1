# Internet-Applications-Assignment-1

CSU44000 Internet Applications, Assignment 1: a reactive internet application.

Enter a city and the app tells you what to pack for the next three days, shows the forecast and air quality, and maps how the weather varies across the surrounding area.

## Running it

You need Node.js 20.6 or later (for the built-in `fetch` and `--env-file`) and a free OpenWeatherMap API key from https://home.openweathermap.org/api_keys. The area map uses Open-Meteo, which needs no key.

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

Type a city and press **Get forecast**. The app shows the best match for that name. If other places share the name (Dublin, Ireland and Dublin, Ohio, for example), a **Not the right Dublin?** link lists them so you can switch. While a new place loads, the previous results stay on screen, faded, until the new forecast arrives.

### Packing list

For the chosen place, the app builds a packing list from the next three days:

- **Umbrella** if any rain is forecast. Once the area map has loaded, a second line says how widespread the rain is nearby, for example "scattered: 7 of 25 nearby areas get a wet day".
- **Warm coat, hat and gloves** if any day drops below 8°C.
- **Light layers** if any day spends time between 8°C and 24°C.
- **Light clothing, sunglasses and sun cream** if any day goes above 24°C.

A single day can trigger more than one item, for example a cold morning that warms up to a mild afternoon. Each item says which days it applies to and the relevant temperatures.

### Next 3 days

A table shows each day's low, high and average temperature, average wind and total rain. Each day has a bar showing its temperature range against cold (below 8°C), mild and hot (above 24°C) zones.

### Air quality

The panel shows OpenWeatherMap's overall air quality rating for the place. Each pollutant (SO₂, NO₂, PM10, PM2.5, O₃ and CO) is also graded on its own, using the concentration bands from OpenWeatherMap's air quality index. If any pollutant is above Good, it appears as a coloured chip. Selecting a chip shows the concentration, how many times over the Good limit it is, the health risk and advice for that level. The pollutant furthest over its limit is selected first.

### Around the city

A map shows a 5 × 5 grid of areas, 15 km apart and 75 km across, centred on the city. Each area is coloured and labelled with its forecast value. You can switch between:

- **Temperature**: the daytime high in °C.
- **Rain**: the day's total in mm.
- **Wind**: the strongest wind in m/s.

A slider moves through the three days. The colour scale covers all three days, so the same colour means the same value on every day. The lowest and highest areas are outlined, and a ring marks the city. Under the map, a sentence compares the city with its surroundings, for example "the city reaches 13°C. It is warmest 21 km to the south-east (15°C) and coolest 42 km to the south-west (9°C)." It also points out when the area spans more than one of the packing list's temperature bands. **How to read this** explains the map and notes that its data comes from a different source than the city forecast.

## How it is built

The server (`server.js`) is a small Express app. It serves the front end from `public/` and provides a JSON API that calls OpenWeatherMap and Open-Meteo on the browser's behalf, so the API key never leaves the server.

The front end is Vue 3, loaded as an ES module from unpkg, so there is no build step:

- `public/index.html` holds the page structure and the Vue template.
- `public/app.js` holds the app's state and logic: searching, choosing between matching places, working out the packing list, and drawing and describing the area map.
- `public/style.css` holds the styling.

The forecast appears as soon as it arrives. The air quality and area requests then run in parallel. If the area request fails, the error appears inside the map instead of replacing the results. If you switch places while a request is in flight, its response is ignored when it arrives, so a slow response for an old place never draws over a new one.

The map uses Leaflet. The Leaflet map object and its rectangles are kept outside Vue's reactive state, so Vue does not wrap them in proxies. Changing the layer or day repaints the existing rectangles instead of rebuilding the map, and a `ResizeObserver` refits the grid when the layout changes size.

### Layout

- At most widths, the packing list sits under the search box. Below it, the forecast table and air quality panel sit side by side, with the map underneath them.
- Below 820px wide, everything is in a single column.
- On screens at least 1240px wide and 720px tall, the page fills the window. Search and the packing list are on the left, the forecast table and air quality are in the middle, and the map fills the right-hand column.
- Below 520px wide, the search button stacks under the input.

### API

All errors come back as `{ "error": "..." }`. Any other path under the server returns a 404 in the same format.

`GET /api/forecast/:city?match=n`

Looks up `city` and returns a three-day forecast for one of the matching places. `match` picks which geocoder result to use and defaults to `0`, the best match. The response contains:

- `city`: the chosen place's `name`, `state` (or `null`), `country`, `lat` and `lon`.
- `otherMatches`: the other places with the same name, each with its `matchIndex`, so the browser can request them with `?match=`.
- `days`: three entries with `date`, `minTemperature`, `maxTemperature`, `averageTemperature` (°C), `averageWindSpeed` (m/s) and `rainfall` (mm).

The status is 400 for an empty name or a `match` that does not exist, 404 if no place is found, and 502 if OpenWeatherMap is unavailable.

`GET /api/air-quality?lat=..&lon=..`

Returns the current air quality at a location:

- `overallLevel`: OpenWeatherMap's overall rating, one of Good, Fair, Moderate, Poor or Very Poor.
- `pollutants`: each pollutant's `code`, `name`, `symbol`, `concentration` (μg/m³), `goodLimit`, `level` and `healthRisk`.
- `warnings`: the pollutants above Good, each with `timesGoodLimit` and `advice` added.

The status is 400 if `lat` or `lon` is not a number, and 502 if OpenWeatherMap is unavailable.

`GET /api/area-forecast?lat=..&lon=..`

Returns a three-day forecast for a 5 × 5 grid of points around a location, fetched from Open-Meteo in a single request. The response contains:

- `cells`: 25 entries in reading order (north-west first, the city at index 12). Each has its `bounds` for the map, `distanceKm` and `direction` from the city, and `days` with `temperature` (daily high, °C), `rain` (mm) and `wind` (strongest, m/s).
- `days`: per-day summaries with `date`, `wetCellCount` and `rainCoverage` (the share of cells with at least 1 mm of rain). There is also `temperature`, `rain` and `wind`, each giving the city's value and the lowest and highest cells.
- `cellCount`, `gridSize`, `spacingKm`, `widthKm`, `wetDayThresholdMm` and `source`.
- `distinctModelCellCount`: how many different cells of Open-Meteo's forecast model the 25 points fall in. Points in the same model cell get identical values, so this shows how much real detail the grid has.

Results are cached in memory for 30 minutes, keyed by coordinates rounded to two decimal places. The status is 400 if the coordinates are not valid, and 502 if Open-Meteo is unavailable.

### Outside services

- OpenWeatherMap [Geocoding API](https://openweathermap.org/api/geocoding-api) (`geo/1.0/direct`) to turn a city name into up to five places with coordinates.
- OpenWeatherMap [5 day / 3 hour forecast](https://openweathermap.org/forecast5) (`data/2.5/forecast`, metric units) for the city forecast.
- OpenWeatherMap [Air Pollution API](https://openweathermap.org/api/air-pollution) (`data/2.5/air_pollution`) for air quality.
- [Open-Meteo Forecast API](https://open-meteo.com/en/docs) for the area grid.
- [Leaflet](https://leafletjs.com/) 1.9.4 from unpkg for the map, with [OpenStreetMap](https://www.openstreetmap.org/copyright) tiles.
- Vue 3 from unpkg, and the Bricolage Grotesque and Instrument Sans fonts from Google Fonts.

### Known limitations

- The city forecast (OpenWeatherMap) and the area map (Open-Meteo) come from different models, so the map's centre value will not exactly match the table.
- The two sources count a rainy day differently: the city counts any rain, while the area counts a cell as wet from 1 mm.
- The area cache is a plain object. Expired entries are replaced when requested again but never removed, so it grows with the number of distinct places searched until the server restarts.