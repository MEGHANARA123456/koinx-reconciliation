const { stringify } = require('csv-stringify/sync');
const { ReconciliationEntry, ReconciliationRun } = require('../models');
const logger = require('../utils/logger');

/**
 * Persist all reconciliation entries to MongoDB.
 */
async function saveEntries(runId, entries) {
  const docs = entries.map(e => ({ runId, ...e }));
  await ReconciliationEntry.insertMany(docs, { ordered: false });
  logger.info(`Saved ${docs.length} reconciliation entries for runId=${runId}`);
}

/**
 * Compute summary counts from entries array.
 */
function computeSummary(entries, userDocs, exchangeDocs) {
  return {
    matched: entries.filter(e => e.category === 'matched').length,
    conflicting: entries.filter(e => e.category === 'conflicting').length,
    unmatchedUser: entries.filter(e => e.category === 'unmatched_user').length,
    unmatchedExchange: entries.filter(e => e.category === 'unmatched_exchange').length,
    totalUser: userDocs.length,
    totalExchange: exchangeDocs.length,
    invalidRows: [...userDocs, ...exchangeDocs].filter(t => !t.isValid).length,
    duplicateRows: [...userDocs, ...exchangeDocs].filter(t => t.isDuplicate).length,
  };
}

/**
 * Generate a CSV report from entries stored in DB for a given runId.
 * Returns the CSV string.
 */
async function generateCsvReport(runId) {
  const entries = await ReconciliationEntry.find({ runId }).lean();

  const rows = entries.map(e => {
    const u = e.userTransaction || {};
    const x = e.exchangeTransaction || {};
    const conflicts = (e.conflicts || []).map(c =>
      `${c.field}: user=${c.userValue} exc=${c.exchangeValue} (${c.delta})`
    ).join(' | ');

    return {
      category: e.category,
      reason: e.reason,
      // User side
      user_id: u.transaction_id || '',
      user_timestamp: u.timestamp || '',
      user_type: u.type || '',
      user_asset: u.asset || '',
      user_quantity: u.quantity ?? '',
      user_price_usd: u.price_usd ?? '',
      user_fee: u.fee ?? '',
      user_note: u.note || '',
      user_quality_issues: (u.qualityIssues || []).join('; '),
      // Exchange side
      exc_id: x.transaction_id || '',
      exc_timestamp: x.timestamp || '',
      exc_type: x.type || '',
      exc_asset: x.asset || '',
      exc_quantity: x.quantity ?? '',
      exc_price_usd: x.price_usd ?? '',
      exc_fee: x.fee ?? '',
      exc_note: x.note || '',
      exc_quality_issues: (x.qualityIssues || []).join('; '),
      // Conflict details
      conflict_details: conflicts,
    };
  });

  return stringify(rows, { header: true });
}

module.exports = { saveEntries, computeSummary, generateCsvReport };
