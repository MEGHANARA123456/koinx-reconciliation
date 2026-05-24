const fs = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const { Transaction } = require('../models');
const { normalizeAsset, normalizeType } = require('../utils/normalize');
const logger = require('../utils/logger');

const DATA_DIR = path.join(__dirname, '../../data');

/**
 * Parse and validate a single raw row.
 * Returns { cleaned, issues, isValid, isDuplicate:false }
 */
function validateRow(raw, source) {
  const issues = [];
  let isValid = true;

  // ── Timestamp ──────────────────────────────────────────────────────────────
  let timestamp = null;
  if (!raw.timestamp || raw.timestamp.trim() === '') {
    issues.push('Missing timestamp');
    isValid = false;
  } else {
    const d = new Date(raw.timestamp.trim());
    if (isNaN(d.getTime())) {
      issues.push(`Malformed timestamp: "${raw.timestamp}"`);
      isValid = false;
    } else {
      timestamp = d;
    }
  }

  // ── Type ───────────────────────────────────────────────────────────────────
  if (!raw.type || raw.type.trim() === '') {
    issues.push('Missing type');
    isValid = false;
  }

  // ── Asset ──────────────────────────────────────────────────────────────────
  const asset = raw.asset ? normalizeAsset(raw.asset) : null;
  if (!asset) {
    issues.push('Missing asset');
    isValid = false;
  }

  // ── Quantity ───────────────────────────────────────────────────────────────
  let quantity = null;
  if (raw.quantity === undefined || raw.quantity === null || raw.quantity.trim() === '') {
    issues.push('Missing quantity');
    isValid = false;
  } else {
    quantity = parseFloat(raw.quantity);
    if (isNaN(quantity)) {
      issues.push(`Non-numeric quantity: "${raw.quantity}"`);
      isValid = false;
    } else if (quantity < 0) {
      issues.push(`Negative quantity: ${quantity}`);
      isValid = false;
    }
  }

  // ── Optional numeric fields ────────────────────────────────────────────────
  const price_usd = raw.price_usd && raw.price_usd.trim() !== ''
    ? parseFloat(raw.price_usd) : null;
  const fee = raw.fee && raw.fee.trim() !== ''
    ? parseFloat(raw.fee) : null;

  return {
    raw,
    isValid,
    qualityIssues: issues,
    isDuplicate: false,
    transaction_id: raw.transaction_id ? raw.transaction_id.trim() : null,
    timestamp,
    type: raw.type ? raw.type.trim().toUpperCase() : null,
    normalizedType: raw.type ? normalizeType(raw.type) : null,
    asset,
    quantity,
    price_usd,
    fee,
    note: raw.note || '',
  };
}

/**
 * Ingest a CSV file for a given source ('user' | 'exchange').
 * Handles: validation, alias normalization, duplicate detection (by transaction_id within source).
 * Flags bad rows — never silently drops them.
 */
async function ingestFile(filename, source, runId) {
  const filePath = path.join(DATA_DIR, filename);
  const content = fs.readFileSync(filePath, 'utf8');

  let rows;
  try {
    rows = parse(content, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true, // don't crash on ragged rows
    });
  } catch (err) {
    logger.error(`Failed to parse ${filename}: ${err.message}`);
    throw err;
  }

  logger.info(`[${source}] Parsed ${rows.length} raw rows from ${filename}`);

  const seenIds = new Map(); // transaction_id -> index for dup detection
  const docs = [];

  for (let i = 0; i < rows.length; i++) {
    const raw = rows[i];
    const validated = validateRow(raw, source);

    // Duplicate detection within same source by transaction_id
    const tid = validated.transaction_id;
    if (tid) {
      if (seenIds.has(tid)) {
        validated.isDuplicate = true;
        validated.qualityIssues.push(`Duplicate transaction_id "${tid}" (first seen at row ${seenIds.get(tid) + 2})`);
        logger.warn(`[${source}] Row ${i + 2}: duplicate transaction_id "${tid}"`);
      } else {
        seenIds.set(tid, i);
      }
    }

    if (!validated.isValid) {
      logger.warn(`[${source}] Row ${i + 2} flagged invalid: ${validated.qualityIssues.join('; ')}`);
    }

    docs.push({
      source,
      runId,
      raw: validated.raw,
      transaction_id: validated.transaction_id,
      timestamp: validated.timestamp,
      type: validated.type,
      normalizedType: validated.normalizedType,
      asset: validated.asset,
      quantity: validated.quantity,
      price_usd: validated.price_usd,
      fee: validated.fee,
      note: validated.note,
      isValid: validated.isValid,
      isDuplicate: validated.isDuplicate,
      qualityIssues: validated.qualityIssues,
    });
  }

  // Bulk insert
  const inserted = await Transaction.insertMany(docs, { ordered: false });
  logger.info(`[${source}] Inserted ${inserted.length} documents for runId=${runId}`);

  return docs;
}

/**
 * Ingest both files and return { userDocs, exchangeDocs }
 */
async function ingestAll(runId) {
  const [userDocs, exchangeDocs] = await Promise.all([
    ingestFile('user_transactions.csv', 'user', runId),
    ingestFile('exchange_transactions.csv', 'exchange', runId),
  ]);
  return { userDocs, exchangeDocs };
}

module.exports = { ingestAll };
