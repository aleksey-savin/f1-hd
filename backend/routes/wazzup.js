const express = require('express');
const rateLimit = require('express-rate-limit');
const { createWebhook } = require('../services/wazzup/webhook');
const router = express.Router();
router.post('/webhook', rateLimit({ windowMs: 60_000, limit: 600, standardHeaders: true, legacyHeaders: false }), createWebhook());
// Dedicated service identity; never fall through into a browser session router.
router.use((_req, res) => res.sendStatus(404));
module.exports = router;
