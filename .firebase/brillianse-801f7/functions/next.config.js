"use strict";

// frontend/next.config.js
var nextConfig = {
  reactStrictMode: true,
  images: {
    // This part whitelists your Firebase Storage
    remotePatterns: [
      {
        protocol: "https",
        hostname: "firebasestorage.googleapis.com",
        port: "",
        // You can be more specific, but this allows all images
        // from your project's bucket.
        pathname: "/v0/b/brillianse-801f7.firebasestorage.app/**"
      }
    ]
  }
};
module.exports = nextConfig;
