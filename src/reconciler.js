require('dotenv').config();
const { v4: uuidv4 } = require('uuid');
const { ReconciliationRun } = require('./models');
const { ingestAll } = require('./ingestion/ingest');
const { matchTransactions } = require('./matching/engine');
const { saveEntries, computeSummary } = require('./report/report');
const config = require('./config');
const logger = require('./utils/logger');

async function runReconciliation(overrides = {}) {
  const runId = uuidv4();
  const matchConfig = {
    timestampToleranceSeconds: overrides.timestampToleranceSeconds ?? config.matching.timestampToleranceSeconds,
    quantityTolerancePct: overrides.quantityTolerancePct ?? config.matching.quantityTolerancePct,
  };
  await ReconciliationRun.create({ runId, status: 'running', config: matchConfig });
  logger.info(`Started reconciliation runId=${runId}`);
  try {
    const { userDocs, exchangeDocs } = await ingestAll(runId);
    const entries = matchTransactions(userDocs, exchangeDocs, matchConfig);
    await saveEntries(runId, entries);
    const summary = computeSummary(entries, userDocs, exchangeDocs);
    await ReconciliationRun.findOneAndUpdate({ runId }, { status: 'completed', summary }, { new: true });
    logger.info(`Completed runId=${runId}`);
    return runId;
  } catch (err) {
    await ReconciliationRun.findOneAndUpdate({ runId }, { status: 'failed', error: err.message });
    logger.error(`Failed runId=${runId}: ${err.message}`);
    throw err;
  }
}

module.exports = { runReconciliation };
