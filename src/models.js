const mongoose = require('mongoose');

// ── Transaction Schema ──────────────────────────────────────────────────────
const transactionSchema = new mongoose.Schema(
  {
    source: { type: String, enum: ['user', 'exchange'], required: true },
    runId: { type: String, required: true, index: true },

    // Raw fields as parsed from CSV
    raw: {
      transaction_id: String,
      timestamp: String,
      type: String,
      asset: String,
      quantity: String,
      price_usd: String,
      fee: String,
      note: String,
    },

    // Cleaned / normalized fields (null if invalid)
    transaction_id: { type: String },
    timestamp: { type: Date, default: null },
    type: { type: String },
    asset: { type: String },           // normalized (e.g. BTC)
    normalizedType: { type: String },  // canonical (TRANSFER)
    quantity: { type: Number, default: null },
    price_usd: { type: Number, default: null },
    fee: { type: Number, default: null },
    note: { type: String },

    // Data quality
    isValid: { type: Boolean, default: true },
    isDuplicate: { type: Boolean, default: false },
    qualityIssues: [{ type: String }],
  },
  { timestamps: true }
);

// ── ReconciliationRun Schema ────────────────────────────────────────────────
const reconciliationRunSchema = new mongoose.Schema(
  {
    runId: { type: String, required: true, unique: true },
    status: {
      type: String,
      enum: ['pending', 'running', 'completed', 'failed'],
      default: 'pending',
    },
    config: {
      timestampToleranceSeconds: Number,
      quantityTolerancePct: Number,
    },
    summary: {
      matched: { type: Number, default: 0 },
      conflicting: { type: Number, default: 0 },
      unmatchedUser: { type: Number, default: 0 },
      unmatchedExchange: { type: Number, default: 0 },
      totalUser: { type: Number, default: 0 },
      totalExchange: { type: Number, default: 0 },
      invalidRows: { type: Number, default: 0 },
      duplicateRows: { type: Number, default: 0 },
    },
    error: { type: String },
  },
  { timestamps: true }
);

// ── ReconciliationEntry Schema ──────────────────────────────────────────────
const reconciliationEntrySchema = new mongoose.Schema(
  {
    runId: { type: String, required: true, index: true },
    category: {
      type: String,
      enum: ['matched', 'conflicting', 'unmatched_user', 'unmatched_exchange'],
      required: true,
      index: true,
    },
    reason: { type: String },
    userTransaction: { type: mongoose.Schema.Types.Mixed, default: null },
    exchangeTransaction: { type: mongoose.Schema.Types.Mixed, default: null },
    conflicts: [
      {
        field: String,
        userValue: mongoose.Schema.Types.Mixed,
        exchangeValue: mongoose.Schema.Types.Mixed,
        delta: mongoose.Schema.Types.Mixed,
      },
    ],
  },
  { timestamps: true }
);

const Transaction = mongoose.model('Transaction', transactionSchema);
const ReconciliationRun = mongoose.model('ReconciliationRun', reconciliationRunSchema);
const ReconciliationEntry = mongoose.model('ReconciliationEntry', reconciliationEntrySchema);

module.exports = { Transaction, ReconciliationRun, ReconciliationEntry };
