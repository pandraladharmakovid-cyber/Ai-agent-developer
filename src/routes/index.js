const express = require("express");

const router = express.Router();

/**
 * API route registry.
 *
 * The main application in src/app.js owns the core
 * agent/workspace endpoints.
 *
 * This router is intentionally kept lightweight so
 * it can be extended later without duplicating
 * backend logic.
 */

router.get("/", (req, res) => {
  res.json({
    ok: true,
    service: "ai-developer-agent",
    status: "online",
  });
});

module.exports = router;