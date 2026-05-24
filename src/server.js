require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const config = require('./config');
const routes = require('./api/routes');
const logger = require('./utils/logger');

const app = express();
app.use(express.json());

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok', timestamp: new Date() }));

// API routes
app.use('/', routes);

// 404 handler
app.use((req, res) => res.status(404).json({ error: 'Route not found' }));

// Global error handler
app.use((err, req, res, next) => {
  logger.error(`Unhandled error: ${err.message}`);
  res.status(500).json({ error: 'Internal server error' });
});

async function start() {
  try {
    await mongoose.connect(config.mongoUri);
    logger.info(`Connected to MongoDB: ${config.mongoUri}`);

    app.listen(config.port, () => {
      logger.info(`KoinX Reconciliation Engine running on port ${config.port}`);
      logger.info(`Config: timestampTolerance=${config.matching.timestampToleranceSeconds}s, quantityTolerance=${config.matching.quantityTolerancePct}%`);
    });
  } catch (err) {
    logger.error(`Failed to start server: ${err.message}`);
    process.exit(1);
  }
}

start();

module.exports = app;
