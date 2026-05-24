const logger = require('../utils/logger');

/**
 * Check if two timestamps are within tolerance (seconds).
 */
function withinTimestamp(t1, t2, toleranceSecs) {
  if (!t1 || !t2) return false;
  return Math.abs(t1.getTime() - t2.getTime()) <= toleranceSecs * 1000;
}

/**
 * Check if two quantities are within tolerance (percentage).
 * tolerancePct = 0.01 means 0.01%
 */
function withinQuantity(q1, q2, tolerancePct) {
  if (q1 === null || q2 === null) return false;
  if (q1 === 0 && q2 === 0) return true;
  const avg = (Math.abs(q1) + Math.abs(q2)) / 2;
  const pct = (Math.abs(q1 - q2) / avg) * 100;
  return pct <= tolerancePct;
}

/**
 * Build conflict details between two transactions.
 * Returns array of { field, userValue, exchangeValue, delta }
 */
function detectConflicts(user, exchange, config) {
  const conflicts = [];

  // Timestamp conflict
  if (user.timestamp && exchange.timestamp) {
    const diffSecs = Math.abs(user.timestamp.getTime() - exchange.timestamp.getTime()) / 1000;
    if (diffSecs > config.timestampToleranceSeconds) {
      conflicts.push({
        field: 'timestamp',
        userValue: user.timestamp,
        exchangeValue: exchange.timestamp,
        delta: `${diffSecs.toFixed(0)}s apart (tolerance: ${config.timestampToleranceSeconds}s)`,
      });
    }
  }

  // Quantity conflict
  if (user.quantity !== null && exchange.quantity !== null) {
    const avg = (Math.abs(user.quantity) + Math.abs(exchange.quantity)) / 2;
    const pct = avg === 0 ? 0 : (Math.abs(user.quantity - exchange.quantity) / avg) * 100;
    if (pct > config.quantityTolerancePct) {
      conflicts.push({
        field: 'quantity',
        userValue: user.quantity,
        exchangeValue: exchange.quantity,
        delta: `${pct.toFixed(4)}% difference (tolerance: ${config.quantityTolerancePct}%)`,
      });
    }
  }

  return conflicts;
}

/**
 * Main matching engine.
 *
 * Strategy:
 * 1. Skip invalid or duplicate rows from matching (they go to report as flagged).
 * 2. For each valid user tx, find candidate exchange txs:
 *    - Same normalized asset
 *    - Same normalized type
 *    - Timestamp within tolerance
 * 3. Among candidates, pick best match by smallest timestamp delta.
 * 4. If matched: check quantity — if within tolerance -> MATCHED, else -> CONFLICTING.
 * 5. Remaining unmatched user -> unmatched_user
 * 6. Remaining unmatched exchange -> unmatched_exchange
 *
 * Returns array of reconciliation entries.
 */
function matchTransactions(userDocs, exchangeDocs, config) {
  const entries = [];

  // Separate valid matchable rows from invalid/duplicate
  const validUser = userDocs.filter(t => t.isValid && !t.isDuplicate);
  const validExchange = exchangeDocs.filter(t => t.isValid && !t.isDuplicate);

  // Track which exchange rows have been matched
  const matchedExchangeIndices = new Set();

  for (const user of validUser) {
    // Find candidates: same asset + normalized type + timestamp window
    const candidates = validExchange
      .map((exc, idx) => ({ exc, idx }))
      .filter(({ exc, idx }) => {
        if (matchedExchangeIndices.has(idx)) return false;
        if (exc.asset !== user.asset) return false;
        if (exc.normalizedType !== user.normalizedType) return false;
        return withinTimestamp(user.timestamp, exc.timestamp, config.timestampToleranceSeconds);
      });

    if (candidates.length === 0) {
      // No match found
      entries.push({
        category: 'unmatched_user',
        reason: 'No matching exchange transaction found within tolerance window',
        userTransaction: serializeTx(user),
        exchangeTransaction: null,
        conflicts: [],
      });
      continue;
    }

    // Pick best candidate: smallest timestamp delta
    candidates.sort((a, b) => {
      const dA = Math.abs(user.timestamp - a.exc.timestamp);
      const dB = Math.abs(user.timestamp - b.exc.timestamp);
      return dA - dB;
    });

    const { exc, idx } = candidates[0];
    matchedExchangeIndices.add(idx);

    // Check for conflicts
    const conflicts = detectConflicts(user, exc, config);

    if (conflicts.length === 0) {
      entries.push({
        category: 'matched',
        reason: 'Transaction matched within all tolerances',
        userTransaction: serializeTx(user),
        exchangeTransaction: serializeTx(exc),
        conflicts: [],
      });
    } else {
      entries.push({
        category: 'conflicting',
        reason: `Matched by proximity but has ${conflicts.length} field conflict(s): ${conflicts.map(c => c.field).join(', ')}`,
        userTransaction: serializeTx(user),
        exchangeTransaction: serializeTx(exc),
        conflicts,
      });
    }
  }

  // Remaining unmatched exchange rows
  validExchange.forEach((exc, idx) => {
    if (!matchedExchangeIndices.has(idx)) {
      entries.push({
        category: 'unmatched_exchange',
        reason: 'No matching user transaction found within tolerance window',
        userTransaction: null,
        exchangeTransaction: serializeTx(exc),
        conflicts: [],
      });
    }
  });

  // Invalid / duplicate rows — add as flagged entries
  const invalidUser = userDocs.filter(t => !t.isValid || t.isDuplicate);
  const invalidExchange = exchangeDocs.filter(t => !t.isValid || t.isDuplicate);

  for (const t of invalidUser) {
    entries.push({
      category: 'unmatched_user',
      reason: `Row skipped from matching — data quality issues: ${t.qualityIssues.join('; ')}`,
      userTransaction: serializeTx(t),
      exchangeTransaction: null,
      conflicts: [],
    });
  }

  for (const t of invalidExchange) {
    entries.push({
      category: 'unmatched_exchange',
      reason: `Row skipped from matching — data quality issues: ${t.qualityIssues.join('; ')}`,
      userTransaction: null,
      exchangeTransaction: serializeTx(t),
      conflicts: [],
    });
  }

  logger.info(`Matching complete: ${entries.filter(e => e.category === 'matched').length} matched, ` +
    `${entries.filter(e => e.category === 'conflicting').length} conflicting, ` +
    `${entries.filter(e => e.category === 'unmatched_user').length} unmatched_user, ` +
    `${entries.filter(e => e.category === 'unmatched_exchange').length} unmatched_exchange`);

  return entries;
}

function serializeTx(t) {
  return {
    transaction_id: t.transaction_id,
    timestamp: t.timestamp,
    type: t.type,
    asset: t.asset,
    quantity: t.quantity,
    price_usd: t.price_usd,
    fee: t.fee,
    note: t.note,
    source: t.source,
    isValid: t.isValid,
    isDuplicate: t.isDuplicate,
    qualityIssues: t.qualityIssues,
  };
}

module.exports = { matchTransactions };
