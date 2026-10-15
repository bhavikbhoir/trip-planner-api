// Normalizes a caller-supplied shares map against the resolved split list —
// every member in `split` gets an explicit share count (default 1, the
// plain even-split case), and anything in `shares` for someone NOT in
// `split` is dropped rather than silently kept around. Used by both
// expenses/create.js and bookings/convertToExpense.js so the two paths
// that can produce an expense agree on the same validation.
function normalizeShares(shares, split) {
  const normalized = {}
  for (const userId of split) {
    const raw = shares?.[userId]
    if (raw === undefined) {
      normalized[userId] = 1
      continue
    }
    if (!Number.isInteger(raw) || raw < 1) {
      throw new Error(`shares.${userId} must be a positive whole number`)
    }
    normalized[userId] = raw
  }
  return normalized
}

module.exports = { normalizeShares }
