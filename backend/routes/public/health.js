const express = require('express');
const router = express.Router();
const mongoose = require('mongoose');

// Health check endpoint
router.get('/', async (req, res) => {
  try {
    // Check MongoDB connection
    const mongoStatus = mongoose.connection.readyState === 1 ? 'connected' : 'disconnected';

    // Get basic system info
    const uptime = process.uptime();
    const memoryUsage = process.memoryUsage();
    const timestamp = new Date().toISOString();

    // Check if database is responsive
    let dbCheck = false;
    try {
      await mongoose.connection.db.admin().ping();
      dbCheck = true;
    } catch (error) {
      console.error('Database ping failed:', error);
    }

    const healthStatus = {
      status: 'healthy',
      timestamp,
      uptime: Math.floor(uptime),
      version: process.env.npm_package_version || '1.0.0',
      environment: process.env.NODE_ENV || 'development',
      database: {
        status: mongoStatus,
        connected: dbCheck
      },
      memory: {
        used: Math.round(memoryUsage.heapUsed / 1024 / 1024 * 100) / 100,
        total: Math.round(memoryUsage.heapTotal / 1024 / 1024 * 100) / 100,
        external: Math.round(memoryUsage.external / 1024 / 1024 * 100) / 100
      },
      pid: process.pid
    };

    // If database is not connected, mark as unhealthy
    if (!dbCheck || mongoStatus !== 'connected') {
      healthStatus.status = 'unhealthy';
      return res.status(503).json(healthStatus);
    }

    res.status(200).json(healthStatus);
  } catch (error) {
    console.error('Health check error:', error);
    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: error.message
    });
  }
});

// Readiness check endpoint
router.get('/ready', async (req, res) => {
  try {
    // Check if all required services are ready
    const checks = [];

    // Database readiness
    try {
      await mongoose.connection.db.admin().ping();
      checks.push({ service: 'database', status: 'ready' });
    } catch (error) {
      checks.push({ service: 'database', status: 'not_ready', error: error.message });
    }

    // Check environment variables
    const requiredEnvVars = ['MONGODB_USERNAME', 'MONGODB_PASSWORD', 'JWT_SECRET'];
    const envCheck = requiredEnvVars.every(envVar => process.env[envVar]);
    checks.push({
      service: 'environment',
      status: envCheck ? 'ready' : 'not_ready',
      missing: envCheck ? undefined : requiredEnvVars.filter(envVar => !process.env[envVar])
    });

    const allReady = checks.every(check => check.status === 'ready');

    const readinessStatus = {
      status: allReady ? 'ready' : 'not_ready',
      timestamp: new Date().toISOString(),
      checks
    };

    res.status(allReady ? 200 : 503).json(readinessStatus);
  } catch (error) {
    console.error('Readiness check error:', error);
    res.status(503).json({
      status: 'not_ready',
      timestamp: new Date().toISOString(),
      error: error.message
    });
  }
});

// Liveness check endpoint (minimal check)
router.get('/live', (req, res) => {
  res.status(200).json({
    status: 'alive',
    timestamp: new Date().toISOString(),
    pid: process.pid
  });
});

module.exports = router;
