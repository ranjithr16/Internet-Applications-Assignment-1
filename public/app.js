import { createApp } from "https://unpkg.com/vue@3/dist/vue.esm-browser.js";

const COLD_BELOW = 8;
const HOT_ABOVE = 24;

const SCALE_PADDING = 4;

const WEEKDAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const SHORT_NAME_LENGTH = 3;

createApp({
  data() {
    return {
      cityInput: "",
      searchedName: "",
      isPlaceListOpen: false,
      forecast: null,
      airQuality: null,
      selectedWarning: null,
      isShowingPreviousCity: false,
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
      this.forecast = null;
      this.airQuality = null;
      this.selectedWarning = null;
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