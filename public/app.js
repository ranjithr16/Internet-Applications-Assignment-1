import { createApp } from "https://unpkg.com/vue@3/dist/vue.esm-browser.js";

const COLD_BELOW = 8;
const HOT_ABOVE = 24;

const SCALE_PADDING = 4;

const MAP_LAYERS = [
  {
    id: "temperature", label: "Temperature", legendTitle: "Daytime high, °C", unit: "°C",
    lowColour: "#fdf0b8", highColour: "#d9573a", minimumSpan: 4
  },
  {
    id: "rain", label: "Rain", legendTitle: "Rain, mm", unit: " mm",
    lowColour: "#e6eef5", highColour: "#14293d", minimumSpan: 10
  },
  {
    id: "wind", label: "Wind", legendTitle: "Strongest wind, m/s", unit: " m/s",
    lowColour: "#e7f2ee", highColour: "#1d6a5c", minimumSpan: 4
  }
];
const DARK_CELL_FROM = 0.55;

const MAP_TILE_URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";
const MAP_ELEMENT_ID = "area-map";

const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const SHORT_NAME_LENGTH = 3;

const MAP_ATTRIBUTION = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

function blendColours(startColour, endColour, amount) {
  const channels = [1, 3, 5].map((offset) => {
    const start = parseInt(startColour.slice(offset, offset + 2), 16);
    const end = parseInt(endColour.slice(offset, offset + 2), 16);
    return Math.round(start + (end - start) * amount);
  });
  return `rgb(${channels.join(", ")})`;
}

createApp({
  data() {
    return {
      cityInput: "",
      searchedName: "",
      isPlaceListOpen: false,
      forecast: null,
      airQuality: null,
      selectedWarning: null,
      areaForecast: null,
      areaErrorMessage: "",
      isAreaLoading: false,
      isShowingPreviousCity: false,
      mapLayers: MAP_LAYERS,
      selectedLayer: "temperature",
      selectedDayIndex: 0,
      isLoading: false,
      errorMessage: "",
      coldBelow: COLD_BELOW,
      hotAbove: HOT_ABOVE
    };
  },

  methods: {
    searchCity() {
      this.searchedName = this.cityInput;
      return this.loadForecast(0);
    },

    choosePlace(place) {
      return this.loadForecast(place.matchIndex);
    },

    async loadForecast(matchIndex) {
      const previousForecast = this.forecast;
      this.isPlaceListOpen = false;
      this.isLoading = true;
      this.isShowingPreviousCity = previousForecast !== null;
      this.errorMessage = "";

      try {
        const forecast = await this.getJson(
          `/api/forecast/${encodeURIComponent(this.searchedName)}?match=${matchIndex}`);
        this.clearResults();
        this.forecast = forecast;
        this.isShowingPreviousCity = false;

        this.loadAreaForecast(this.forecast);
        this.airQuality = await this.getJson(
          `/api/air-quality?lat=${forecast.city.lat}&lon=${forecast.city.lon}`);
        this.selectedWarning = this.findWorstWarning(this.airQuality.warnings);
      } catch (error) {
        if (this.forecast === previousForecast) {
          this.clearResults();
        }
        this.errorMessage = error.message;
      } finally {
        this.isLoading = false;
        this.isShowingPreviousCity = false;
      }
    },

    clearResults() {
      this.removeMap();
      this.forecast = null;
      this.airQuality = null;
      this.selectedWarning = null;
      this.areaForecast = null;
      this.areaErrorMessage = "";
      this.isAreaLoading = false;
      this.selectedDayIndex = 0;
    },

    async loadAreaForecast(forecast) {
      this.isAreaLoading = true;
      try {
        const areaForecast = await this.getJson(
          `/api/area-forecast?lat=${forecast.city.lat}&lon=${forecast.city.lon}`);
        if (this.forecast === forecast) {
          this.areaForecast = areaForecast;
          this.drawMap();
        }
      } catch (error) {
        if (this.forecast === forecast) {
          this.areaErrorMessage = error.message;
        }
      } finally {
        if (this.forecast === forecast) {
          this.isAreaLoading = false;
        }
      }
    },

    findWorstWarning(warnings) {
      let worst = null;
      warnings.forEach((warning) => {
        if (worst === null || warning.timesGoodLimit > worst.timesGoodLimit) {
          worst = warning;
        }
      });
      return worst;
    },

    findRainyDays() {
      const rainyDays = [];
      this.forecast.days.forEach((day) => {
        if (day.rainfall > 0) {
          rainyDays.push(day);
        }
      });
      return rainyDays;
    },

    packingList() {
      const rainyDays = this.findRainyDays();
      const coldDays = [];
      const mildDays = [];
      const hotDays = [];
      this.forecast.days.forEach((day) => {
        if (day.minTemperature < COLD_BELOW) {
          coldDays.push(day);
        }
        if (day.maxTemperature >= COLD_BELOW && day.minTemperature <= HOT_ABOVE) {
          mildDays.push(day);
        }
        if (day.maxTemperature > HOT_ABOVE) {
          hotDays.push(day);
        }
      });

      const items = [];
      if (rainyDays.length > 0) {
        items.push({
          name: "Umbrella",
          reason: `Rain is forecast on ${this.describeDays(rainyDays)}.`
        });
      }
      if (coldDays.length > 0) {
        items.push({
          name: "Warm coat, hat and gloves",
          reason: `Cold on ${this.describeDays(coldDays)}, with lows of ${this.lowestTemperature(coldDays)}°C.`
        });
      }
      if (mildDays.length > 0) {
        items.push({
          name: "Light layers",
          reason: `Mild on ${this.describeDays(mildDays)}${this.describeMildRange(mildDays)}.`
        });
      }
      if (hotDays.length > 0) {
        items.push({
          name: "Light clothing, sunglasses and sun cream",
          reason: `Hot on ${this.describeDays(hotDays)}, with highs of ${this.highestTemperature(hotDays)}°C.`
        });
      }
      return items;
    },

    lowestTemperature(days) {
      let lowest = days[0].minTemperature;
      days.forEach((day) => {
        if (day.minTemperature < lowest) {
          lowest = day.minTemperature;
        }
      });
      return lowest;
    },

    highestTemperature(days) {
      let highest = days[0].maxTemperature;
      days.forEach((day) => {
        if (day.maxTemperature > highest) {
          highest = day.maxTemperature;
        }
      });
      return highest;
    },

    currentLayer() {
      return this.mapLayers.find((layer) => layer.id === this.selectedLayer);
    },

    mapScale() {
      const layer = this.currentLayer();
      let min = this.areaForecast.days[0][layer.id].lowest.value;
      let max = this.areaForecast.days[0][layer.id].highest.value;
      this.areaForecast.days.forEach((areaDay) => {
        const extremes = areaDay[layer.id];
        if (extremes.lowest.value < min) {
          min = extremes.lowest.value;
        }
        if (extremes.highest.value > max) {
          max = extremes.highest.value;
        }
      });

      if (layer.id === "rain") {
        return { min: 0, max: Math.max(max, layer.minimumSpan) };
      }
      const shortfall = layer.minimumSpan - (max - min);
      if (shortfall > 0) {
        min -= shortfall / 2;
        max += shortfall / 2;
      }
      return { min: min, max: max };
    },

    mapLegend() {
      const layer = this.currentLayer();
      const scale = this.mapScale();
      return {
        title: layer.legendTitle,
        lowLabel: Math.round(scale.min),
        highLabel: Math.round(scale.max),
        gradient: `linear-gradient(to right, ${layer.lowColour}, ${layer.highColour})`
      };
    },

    drawMap() {
      this.removeMap();
      const mapElement = document.getElementById(MAP_ELEMENT_ID);
      const city = this.forecast.city;

      this.leafletMap = L.map(mapElement, { scrollWheelZoom: false, zoomSnap: 0.25 });
      L.tileLayer(MAP_TILE_URL, { attribution: MAP_ATTRIBUTION }).addTo(this.leafletMap);

      this.cellRectangles = this.areaForecast.cells.map((cell) =>
        L.rectangle(cell.bounds, { color: "#14293d", fillOpacity: 0.7 }).addTo(this.leafletMap));
      const gridBounds = L.featureGroup(this.cellRectangles).getBounds();
      this.leafletMap.fitBounds(gridBounds, { padding: [8, 8] });

      this.mapResizeObserver = new ResizeObserver(() => {
        this.leafletMap.invalidateSize();
        this.leafletMap.fitBounds(gridBounds, { padding: [8, 8], animate: false });
      });
      this.mapResizeObserver.observe(mapElement);

      L.circleMarker([city.lat, city.lon], { radius: 17, color: "#f4c430", weight: 3, fill: false, interactive: false })
        .addTo(this.leafletMap);

      this.paintMapCells();
    },

    removeMap() {
      if (this.leafletMap) {
        this.mapResizeObserver.disconnect();
        this.leafletMap.remove();
        this.leafletMap = null;
        this.cellRectangles = null;
      }
    },

    paintMapCells() {
      if (!this.cellRectangles) {
        return;
      }
      const layer = this.currentLayer();
      const scale = this.mapScale();

      this.cellRectangles.forEach((rectangle, index) => {
        const value = this.areaForecast.cells[index].days[this.selectedDayIndex][layer.id];
        const amount = Math.min(Math.max((value - scale.min) / (scale.max - scale.min), 0), 1);

        rectangle.setStyle({
          fillColor: blendColours(layer.lowColour, layer.highColour, amount),
          weight: 1,
          opacity: 0.2
        });

        const labelClass = amount > DARK_CELL_FROM ? "cell-value on-dark" : "cell-value";
        rectangle.unbindTooltip();
        rectangle.bindTooltip(`<span class="${labelClass}">${Math.round(value)}</span>`, {
          permanent: true,
          direction: "center",
          className: "cell-label"
        });
      });
    },

    describePlace(place) {
      const parts = [place.name];
      if (place.state) {
        parts.push(place.state);
      }
      parts.push(place.country);
      return parts.join(", ");
    },

    async getJson(url) {
      const response = await fetch(url);
      const body = await response.json();
      if (!response.ok) {
        throw new Error(body.error || "Something went wrong. Please try again.");
      }
      return body;
    },

    temperatureScale() {
      const days = this.forecast.days;
      return {
        min: Math.min(this.lowestTemperature(days), COLD_BELOW) - SCALE_PADDING,
        max: Math.max(this.highestTemperature(days), HOT_ABOVE) + SCALE_PADDING
      };
    },

    scalePercent(temperature) {
      const scale = this.temperatureScale();
      return ((temperature - scale.min) / (scale.max - scale.min)) * 100;
    },

    scaleStyle() {
      return {
        "--cold-end": `${this.scalePercent(COLD_BELOW)}%`,
        "--hot-start": `${this.scalePercent(HOT_ABOVE)}%`
      };
    },

    rangeBarStyle(day) {
      const start = this.scalePercent(day.minTemperature);
      const end = this.scalePercent(day.maxTemperature);
      return { left: `${start}%`, width: `${end - start}%` };
    },

    formatWeekday(isoDate) {
      return WEEKDAY_NAMES[this.toDate(isoDate).getUTCDay()];
    },

    formatShortWeekday(isoDate) {
      return this.formatWeekday(isoDate).slice(0, SHORT_NAME_LENGTH);
    },

    formatDate(isoDate) {
      const date = this.toDate(isoDate);
      return `${date.getUTCDate()} ${MONTH_NAMES[date.getUTCMonth()]}`;
    },

    toDate(isoDate) {
      return new Date(`${isoDate}T00:00:00Z`);
    },

    describeDays(days) {
      if (days.length === this.forecast.days.length) {
        return "all three days";
      }
      return this.joinAsList(days.map((day) => this.formatWeekday(day.date)));
    },

    describeMildRange(mildDays) {
      const lowest = this.lowestTemperature(mildDays);
      const highest = this.highestTemperature(mildDays);
      const startsMild = lowest >= COLD_BELOW;
      const endsMild = highest <= HOT_ABOVE;

      if (startsMild && endsMild) {
        return `, between ${lowest}°C and ${highest}°C`;
      }
      if (startsMild) {
        return `, with lows of ${lowest}°C`;
      }
      if (endsMild) {
        return `, with highs of ${highest}°C`;
      }
      return "";
    },

    joinAsList(words) {
      if (words.length === 1) {
        return words[0];
      }
      const lastWord = words[words.length - 1];
      return `${words.slice(0, -1).join(", ")} and ${lastWord}`;
    },

    levelClass(level) {
      return `level-${level.toLowerCase().replace(" ", "-")}`;
    }
  }
}).mount("#app");