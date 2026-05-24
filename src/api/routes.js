const express = require('express');
const router = express.Router();
const { runReconciliation } = require('../reconciler');
const { ReconciliationRun, ReconciliationEntry } = require('../models');
const { generateCsvReport } = require('../report/report');
const logger = require('../utils/logger');

// ── POST /reconcile ──────────────────────────────────────────────────────────
// Trigger a reconciliation run. Accepts optional tolerance overrides in body.
router.post('/reconcile', async (req, res) => {
  try {
    const overrides = {};

    if (req.body.timestampToleranceSeconds !== undefined) {
      const v = Number(req.body.timestampToleranceSeconds);
      if (isNaN(v) || v < 0) {
        return res.status(400).json({ error: 'timestampToleranceSeconds must be a non-negative number' });
      }
      overrides.timestampToleranceSeconds = v;
    }

    if (req.body.quantityTolerancePct !== undefined) {
      const v = Number(req.body.quantityTolerancePct);
      if (isNaN(v) || v < 0) {
        return res.status(400).json({ error: 'quantityTolerancePct must be a non-negative number' });
      }
      overrides.quantityTolerancePct = v;
    }

    // Run async — return runId immediately so caller can poll
    const runId = await runReconciliation(overrides);

    return res.status(202).json({
      message: 'Reconciliation completed',
      runId,
    });
  } catch (err) {
    logger.error(`POST /reconcile error: ${err.message}`);
    return res.status(500).json({ error: err.message });
  }
});

// ── GET /report/:runId ───────────────────────────────────────────────────────
// Full reconciliation report as JSON (or CSV if ?format=csv)
router.get('/report/:runId', async (req, res) => {
  try {
    const { runId } = req.params;
    const run = await ReconciliationRun.findOne({ runId }).lean();
    if (!run) return res.status(404).json({ error: 'Run not found' });

    if (req.query.format === 'csv') {
      const csv = await generateCsvReport(runId);
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="reconciliation_${runId}.csv"`);
      return res.send(csv);
    }

    const entries = await ReconciliationEntry.find({ runId }).lean();
    return res.json({ run, entries });
  } catch (err) {
    logger.error(`GET /report/${req.params.runId} error: ${err.message}`);
    return res.status(500).json({ error: err.message });
  }
});

// ── GET /report/:runId/summary ───────────────────────────────────────────────
// Just the counts
router.get('/report/:runId/summary', async (req, res) => {
  try {
    const { runId } = req.params;
    const run = await ReconciliationRun.findOne({ runId }, 'runId status config summary createdAt').lean();
    if (!run) return res.status(404).json({ error: 'Run not found' });
    return res.json(run);
  } catch (err) {
    logger.error(`GET /report/${req.params.runId}/summary error: ${err.message}`);
    return res.status(500).json({ error: err.message });
  }
});

// ── GET /report/:runId/unmatched ─────────────────────────────────────────────
// Only unmatched rows with reasons
router.get('/report/:runId/unmatched', async (req, res) => {
  try {
    const { runId } = req.params;
    const run = await ReconciliationRun.findOne({ runId }).lean();
    if (!run) return res.status(404).json({ error: 'Run not found' });

    const entries = await ReconciliationEntry.find({
      runId,
      category: { $in: ['unmatched_user', 'unmatched_exchange'] },
    }).lean();

    return res.json({ runId, count: entries.length, entries });
  } catch (err) {
    logger.error(`GET /report/${req.params.runId}/unmatched error: ${err.message}`);
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
