import { createApp } from "https://unpkg.com/vue@3/dist/vue.esm-browser.js";

createApp({
  data() {
    return {
      cityInput: "",
      searchedName: "",
      forecast: null,
      isLoading: false,
      errorMessage: ""
    };
  },

  methods: {
    async searchCity() {
      this.searchedName = this.cityInput;
      this.isLoading = true;
      this.errorMessage = "";

      try {
        this.forecast = await this.getJson(
          `/api/forecast/${encodeURIComponent(this.searchedName)}`);
      } catch (error) {
        this.forecast = null;
        this.errorMessage = error.message;
      } finally {
        this.isLoading = false;
      }
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