import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    // Run tests from the /tests directory
    root: path.resolve(__dirname),
    include: ["**/*.test.js"],

    // Default: Node environment (no browser) for pure-logic tests
    environment: "node",

    // Integration tests get Happy DOM for real DOM manipulation
    environmentMatchGlobs: [["**/integration.test.js", "happy-dom"]],

    // Global setup for mocks
    setupFiles: ["./setup.js"],

    // Resolve imports from www/ as if we're in the browser
    alias: {
      // Allow tests to import production modules using relative paths from www/
      "@www": path.resolve(__dirname, "../../../www"),
    },

    // ESM support — match the bundler-free architecture
    deps: {
      interopDefault: true,
    },

    // Timeout for async tests
    testTimeout: 10000,

    // Reporter
    reporters: ["verbose"],
  },

  resolve: {
    alias: {
      "@www": path.resolve(__dirname, "../../../www"),
    },
  },
});
