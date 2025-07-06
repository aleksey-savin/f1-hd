const logger = require("../utils/logger");

class AppError extends Error {
  constructor(
    message,
    statusCode,
    isOperational = true,
    originalError = null,
    metadata = {},
  ) {
    super(message);

    this.statusCode = statusCode;
    this.isOperational = isOperational;
    this.code = `ERR_${statusCode}`;
    this.originalError = originalError;
    this.metadata = metadata;

    Error.captureStackTrace(this, this.constructor);
  }
}

const errorResponse = (error, req, res, next) => {
  try {
    // Create a standardized error
    const standardError =
      error instanceof AppError
        ? error
        : new AppError(
            error.message || "An unexpected error occurred",
            error.statusCode || 500,
            true,
            error,
          );

    // Add request context if available
    let logData = {
      statusCode: standardError.statusCode,
      code: standardError.code,
      stack: standardError.stack,
    };

    // Include original error details if they exist
    if (standardError.originalError) {
      logData.originalError = {
        message: standardError.originalError.message,
        stack: standardError.originalError.stack,
        name: standardError.originalError.name,
      };

      // Include all enumerable properties from the original error
      for (const key in standardError.originalError) {
        if (
          Object.prototype.hasOwnProperty.call(
            standardError.originalError,
            key,
          ) &&
          !logData.originalError[key]
        ) {
          logData.originalError[key] = standardError.originalError[key];
        }
      }
    }

    // Include any metadata passed to AppError
    if (
      standardError.metadata &&
      Object.keys(standardError.metadata).length > 0
    ) {
      logData.metadata = standardError.metadata;
    }

    if (req) {
      logData = {
        ...logData,
        route: req.originalUrl,
        method: req.method,
        ip: req.ip || req.connection?.remoteAddress,
      };
    }

    // Log the error with our logger
    if (req) {
      const contextLogger = logger.addNoAuthContext(req);
      contextLogger.log("error", standardError.message, logData);
    } else {
      // Fallback to direct logging if no request
      logger.logDirect("error", standardError.message, logData);
    }

    // Return appropriate response to client
    if (res && !res.headersSent) {
      return res.status(standardError.statusCode).json({
        error: true,
        status: standardError.statusCode,
        code: standardError.code,
        message: standardError.message,
        ...(process.env.NODE_ENV === "development" && {
          stack: standardError.stack,
          ...(standardError.originalError && {
            originalError: {
              message: standardError.originalError.message,
              stack: standardError.originalError.stack,
            },
          }),
        }),
      });
    }
  } catch (loggingError) {
    // If even our error handler fails, log to console as last resort
    console.error("Error in error handling middleware:", loggingError);
    console.error("Original error:", error);

    // Try to send a response if possible
    if (res && !res.headersSent) {
      res.status(500).json({
        error: true,
        status: 500,
        message: "Internal server error occurred",
      });
    }
  }

  // If next is provided, pass to next middleware (important for Express error chains)
  if (next) {
    next(error);
  }
};

module.exports = {
  AppError,
  errorResponse,
};
