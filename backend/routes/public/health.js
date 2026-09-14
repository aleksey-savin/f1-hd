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
    // JWT_SECRET больше не нужен: подписанных нами токенов не осталось, сеансы
    // живут на сервере. BETTER_AUTH_SECRET занял его место — на нём же
    // шифруются секреты второго фактора, и без него не поднимется вход.
    const requiredEnvVars = ['MONGODB_USERNAME', 'MONGODB_PASSWORD', 'MONGODB_DATABASE', 'BETTER_AUTH_SECRET'];
    const missing = requiredEnvVars.filter(envVar => !process.env[envVar]);
    // Ключ шифрования хранимых секретов: новое имя APP_ENC_KEY, старое
    // MIKROTIK_ENC_KEY по-прежнему принимается (см. services/crypto/secretBox).
    if (!process.env.APP_ENC_KEY && !process.env.MIKROTIK_ENC_KEY) {
      missing.push('APP_ENC_KEY');
    }
    checks.push({
      service: 'environment',
      status: missing.length ? 'not_ready' : 'ready',
      missing: missing.length ? missing : undefined
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
