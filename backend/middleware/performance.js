const logger = require("../utils/logger");

// Performance monitoring middleware
const performanceMonitor = (req, res, next) => {
  const start = Date.now();

  // Track request details
  const requestInfo = {
    method: req.method,
    url: req.url,
    userAgent: req.get("User-Agent"),
    ip: req.ip || req.connection.remoteAddress,
    timestamp: new Date().toISOString(),
  };

  // Override res.end to capture response time
  const originalEnd = res.end;
  res.end = function (chunk, encoding) {
    const duration = Date.now() - start;

    // Log slow requests (>1000ms)
    if (duration > 1000) {
      logger.warn(
        `Slow request detected: ${req.method} ${req.url} - ${duration}ms`,
        {
          ...requestInfo,
          duration,
          statusCode: res.statusCode,
        },
      );
    }

    // Log all requests in development
    if (process.env.NODE_ENV === "development") {
      logger.info(
        `${req.method} ${req.url} - ${duration}ms - ${res.statusCode}`,
      );
    }

    // Add performance headers only if not already sent
    if (!res.headersSent) {
      res.setHeader("X-Response-Time", `${duration}ms`);
      res.setHeader("X-Request-ID", req.requestId || "unknown");
    }

    originalEnd.call(this, chunk, encoding);
  };

  next();
};

// Simple in-memory cache for frequently accessed data
class MemoryCache {
  constructor(maxSize = 100, ttl = 300000) {
    // 5 minutes default TTL
    this.cache = new Map();
    this.maxSize = maxSize;
    this.ttl = ttl;
  }

  get(key) {
    const item = this.cache.get(key);
    if (!item) return null;

    if (Date.now() > item.expiry) {
      this.cache.delete(key);
      return null;
    }

    return item.value;
  }

  set(key, value, customTTL = null) {
    const ttl = customTTL || this.ttl;
    const expiry = Date.now() + ttl;

    // Remove oldest items if cache is full
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }

    this.cache.set(key, { value, expiry });
  }

  delete(key) {
    this.cache.delete(key);
  }

  clear() {
    this.cache.clear();
  }

  size() {
    return this.cache.size;
  }
}

// Create cache instances
const apiCache = new MemoryCache(200, 60000); // 1 minute TTL for API responses
const dataCache = new MemoryCache(50, 300000); // 5 minutes TTL for data

// Caching middleware
const cacheMiddleware = (ttl = 60000) => {
  return (req, res, next) => {
    // Only cache GET requests
    if (req.method !== "GET") {
      return next();
    }

    // Create cache key from URL and user info
    const userId = req.user?.id || "anonymous";
    const cacheKey = `${req.originalUrl}:${userId}`;

    // Check if response is cached
    const cachedResponse = apiCache.get(cacheKey);
    if (cachedResponse) {
      if (!res.headersSent) {
        res.setHeader("X-Cache-Status", "HIT");
        res.setHeader("X-Cache-Key", cacheKey);
      }
      return res.json(cachedResponse);
    }

    // Override res.json to cache the response
    const originalJson = res.json;
    res.json = function (data) {
      // Only cache successful responses
      if (res.statusCode === 200) {
        apiCache.set(cacheKey, data, ttl);
        if (!res.headersSent) {
          res.setHeader("X-Cache-Status", "MISS");
          res.setHeader("X-Cache-Key", cacheKey);
        }
      }

      return originalJson.call(this, data);
    };

    next();
  };
};

// Database connection pool monitoring
const monitorDatabaseConnections = () => {
  const mongoose = require("mongoose");

  setInterval(() => {
    const connections = mongoose.connections;
    const stats = {
      totalConnections: connections.length,
      activeConnections: connections.filter((conn) => conn.readyState === 1)
        .length,
      connectingConnections: connections.filter((conn) => conn.readyState === 2)
        .length,
      disconnectedConnections: connections.filter(
        (conn) => conn.readyState === 0,
      ).length,
    };

    if (stats.activeConnections === 0) {
      logger.error("No active database connections detected", stats);
    } else if (stats.connectingConnections > 0) {
      logger.warn("Database connections in connecting state", stats);
    }

    // Log stats every 5 minutes
    if (process.env.NODE_ENV === "development") {
      logger.info("Database connection stats", stats);
    }
  }, 300000); // 5 minutes
};

// Memory usage monitoring
const monitorMemoryUsage = () => {
  setInterval(() => {
    const memUsage = process.memoryUsage();
    const stats = {
      rss: Math.round(memUsage.rss / 1024 / 1024), // MB
      heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024), // MB
      heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024), // MB
      external: Math.round(memUsage.external / 1024 / 1024), // MB
      cacheSize: apiCache.size(),
    };

    // Alert if memory usage is high
    if (stats.heapUsed > 400) {
      // 400MB threshold
      logger.warn("High memory usage detected", stats);
    }

    // Clear cache if memory is getting low
    if (stats.heapUsed > 300) {
      // 300MB threshold
      apiCache.clear();
      logger.info("Cache cleared due to high memory usage");
    }

    if (process.env.NODE_ENV === "development") {
      logger.info("Memory usage stats", stats);
    }
  }, 120000); // 2 minutes
};

// Request ID middleware
const requestIdMiddleware = (req, res, next) => {
  req.requestId =
    req.get("X-Request-ID") ||
    `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  if (!res.headersSent) {
    res.setHeader("X-Request-ID", req.requestId);
  }
  next();
};

// Compression middleware for responses
const compressionMiddleware = (req, res, next) => {
  const acceptEncoding = req.headers["accept-encoding"];
  if (!acceptEncoding) {
    return next();
  }

  // Set compression hint for nginx
  if (acceptEncoding.includes("gzip") && !res.headersSent) {
    res.setHeader("X-Should-Compress", "true");
  }

  next();
};

// Health check with performance metrics
const healthCheckWithMetrics = (req, res) => {
  const memUsage = process.memoryUsage();
  const uptime = process.uptime();

  const health = {
    status: "healthy",
    timestamp: new Date().toISOString(),
    uptime: `${Math.floor(uptime / 60)} minutes`,
    environment: process.env.NODE_ENV || "development",
    version: "1.9.2",
    performance: {
      memoryUsage: {
        rss: Math.round(memUsage.rss / 1024 / 1024) + " MB",
        heapUsed: Math.round(memUsage.heapUsed / 1024 / 1024) + " MB",
        heapTotal: Math.round(memUsage.heapTotal / 1024 / 1024) + " MB",
      },
      cacheStats: {
        apiCacheSize: apiCache.size(),
        dataCacheSize: dataCache.size(),
      },
    },
  };

  res.status(200).json(health);
};

// Initialize monitoring
const initializeMonitoring = () => {
  monitorDatabaseConnections();
  monitorMemoryUsage();
  logger.info("Performance monitoring initialized");
};

module.exports = {
  performanceMonitor,
  cacheMiddleware,
  MemoryCache,
  apiCache,
  dataCache,
  requestIdMiddleware,
  compressionMiddleware,
  healthCheckWithMetrics,
  initializeMonitoring,
};
