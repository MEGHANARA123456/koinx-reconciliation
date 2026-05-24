// Known asset aliases — easily extendable
const ASSET_ALIASES = {
  bitcoin: 'BTC',
  btc: 'BTC',
  ethereum: 'ETH',
  eth: 'ETH',
  solana: 'SOL',
  sol: 'SOL',
  usdt: 'USDT',
  tether: 'USDT',
  matic: 'MATIC',
  polygon: 'MATIC',
  link: 'LINK',
  chainlink: 'LINK',
};

/**
 * Normalize asset name to uppercase canonical form.
 * e.g. "bitcoin" -> "BTC", "ETH" -> "ETH"
 */
function normalizeAsset(asset) {
  if (!asset || typeof asset !== 'string') return null;
  const lower = asset.trim().toLowerCase();
  return ASSET_ALIASES[lower] || asset.trim().toUpperCase();
}

/**
 * Type mapping: TRANSFER_IN (exchange) <-> TRANSFER_OUT (user) are the same tx, opposite perspective.
 * Returns a canonical type for comparison.
 */
const TYPE_EQUIVALENTS = {
  TRANSFER_IN: 'TRANSFER',
  TRANSFER_OUT: 'TRANSFER',
};

function normalizeType(type) {
  if (!type || typeof type !== 'string') return null;
  const upper = type.trim().toUpperCase();
  return TYPE_EQUIVALENTS[upper] || upper;
}

module.exports = { normalizeAsset, normalizeType };
