
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const fs = require('fs');

const config = require('./config/env');
const { initDb, closeDb } = require('./config/db');
const logger = require('./utils/logger');
const errorHandler = require('./middleware/errorHandler');
const { apiLimiter } = require('./middleware/rateLimiter');

// Routes
const authRoutes = require('./routes/authRoutes');
const userRoutes = require('./routes/userRoutes');
const accountRoutes = require('./routes/accountRoutes');
const transactionRoutes = require('./routes/transactionRoutes');

const app = express();

// Server port
const PORT = config.port;

// Allowed frontend origins
const allowedOrigins = [
  config.corsOrigin,
];

// Allow localhost only during development
if (config.nodeEnv !== 'production') {
  allowedOrigins.push(
    'http://localhost:5173',
    'http://127.0.0.1:5173'
  );
}

// Security middleware
app.use(
  helmet({
    contentSecurityPolicy: false,
    crossOriginEmbedderPolicy: false,
  })
);

// CORS configuration
app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests without an Origin header.
      if (!origin) {
        return callback(null, true);
      }

      if (
        allowedOrigins.includes(origin) ||
        origin === app.locals.desktopOrigin
      ) {
        return callback(null, true);
      }

      return callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  })
);

// Request body limits
app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: true, limit: '10kb' }));

// API rate limiting
app.use('/api', apiLimiter);

// Health check
app.get('/api/health', (req, res) => {
  res.status(200).json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    service: 'Secure Banking Authentication and Account Dashboard API',
    version: '1.0.0',
  });
});

// API routes
app.use('/api/auth', authRoutes);
app.use('/api/user', userRoutes);
app.use('/api/account', accountRoutes);
app.use('/api/transactions', transactionRoutes);

// Frontend static files (if available)
const frontendDist = path.join(__dirname, '../frontend/dist');

if (fs.existsSync(frontendDist)) {
  app.use(express.static(frontendDist));

  // Serve React application for non-API routes.
  app.use((req, res, next) => {
    if (req.method === 'GET' && !req.path.startsWith('/api')) {
      return res.sendFile(
        path.join(frontendDist, 'index.html')
      );
    }

    next();
  });
}

// API 404 handler
app.use((req, res, next) => {
  if (req.path.startsWith('/api')) {
    return res.status(404).json({
      success: false,
      message: `API endpoint '${req.originalUrl}' not found.`,
    });
  }

  next();
});

// General 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: 'Resource not found.',
  });
});

// Centralized error handler
app.use(errorHandler);

// Start server only after PostgreSQL initialization succeeds.
if (require.main === module) {
  let server;
  let isShuttingDown = false;

  const shutdown = async (signal) => {
    if (isShuttingDown) return;

    isShuttingDown = true;
    logger.info(`${signal} received. Shutting down server...`);

    try {
      if (server) {
        await new Promise((resolve, reject) => {
          server.close((error) => {
            if (error) {
              return reject(error);
            }

            resolve();
          });
        });
      }

      await closeDb();

      logger.info('Server and database connections closed.');
      process.exit(0);
    } catch (error) {
      logger.error('Error during graceful shutdown:', error);
      process.exit(1);
    }
  };

  const startServer = async () => {
    try {
      await initDb();

      logger.info('PostgreSQL database initialized successfully.');

      server = app.listen(PORT, '0.0.0.0', () => {
        logger.info(`Fortis Vault server running on port ${PORT}`);
        logger.info(`Environment: ${config.nodeEnv}`);
        logger.info('Health endpoint: /api/health');
      });
    } catch (error) {
      logger.error('Failed to initialize application:', error);

      try {
        await closeDb();
      } catch (closeError) {
        logger.error('Failed to close database:', closeError);
      }

      process.exit(1);
    }
  };

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));

  startServer();
}

module.exports = app;
