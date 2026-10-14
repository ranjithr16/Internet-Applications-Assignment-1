import { createApp } from "https://unpkg.com/vue@3/dist/vue.esm-browser.js";

createApp({
  data() {
    return {
      cityInput: "",
      searchedName: "",
      isPlaceListOpen: false,
      forecast: null,
      isLoading: false,
      errorMessage: ""
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
      this.isPlaceListOpen = false;
      this.isLoading = true;
      this.errorMessage = "";

      try {
        this.forecast = await this.getJson(
          `/api/forecast/${encodeURIComponent(this.searchedName)}?match=${matchIndex}`);
      } catch (error) {
        this.forecast = null;
        this.errorMessage = error.message;
      } finally {
        this.isLoading = false;
      }
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
    }
  }
}).mount("#app");