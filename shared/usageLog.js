// The cheapest possible usage signal: a structured console.log line at each
// key lifecycle/feature-usage point, queryable via CloudWatch Logs Insights
// (e.g. `fields @timestamp, tripId | filter usageEvent = "trip_finalized"`)
// without a new table, new IAM permissions, or a new service. Deliberately
// not a full analytics platform — just enough to answer the two questions
// that were previously unanswerable: which features actually get used, and
// what fraction of created trips reach finalized.
function logUsageEvent(eventType, detail = {}) {
  console.log(JSON.stringify({ usageEvent: eventType, ...detail, at: new Date().toISOString() }))
}

module.exports = { logUsageEvent }
