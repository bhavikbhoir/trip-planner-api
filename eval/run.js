#!/usr/bin/env node
// Lightweight prompt eval harness — catches the specific regression classes
// this project has actually shipped (generic "Traveler N" labels, events
// scheduled before a hard arrival anchor, malformed output) without needing
// a deploy or a real DynamoDB-backed trip.
//
// Usage:
//   node eval/run.js            — dry run: builds and prints each fixture's
//                                  real prompt, calls nothing, costs nothing.
//                                  Good for reviewing a prompt change by eye.
//   node eval/run.js --live     — calls the real Bedrock model (small real
//                                  cost) and runs the structural assertions
//                                  against the actual response.
//
// Requires AWS credentials with bedrock:InvokeModel for --live (same as
// what generateWorker.js's own Lambda role has in prod).

const { fixtures } = require('./fixtures')
const { assertValidSchema, assertNoGenericLabels, assertNoEventsBeforeArrival } = require('./assertions')
const { buildPrompt, ITINERARY_TOOL } = require('../functions/plan/generateWorker')
const { invokeClaude } = require('../shared/bedrock')

const isLive = process.argv.includes('--live')

function lastArrivalDatetime(logistics) {
  const arrivals = logistics.map((l) => l.arrival?.datetime).filter(Boolean)
  return arrivals.length ? arrivals.sort().reverse()[0] : null
}

async function runFixture(name, fixture) {
  console.log(`\n${'='.repeat(60)}\n${name}\n${'='.repeat(60)}`)

  const prompt = buildPrompt(fixture)

  if (!isLive) {
    console.log(`(dry run — prompt is ${prompt.length} chars, not calling Bedrock)\n`)
    console.log(prompt)
    return true
  }

  console.log('Calling Bedrock (sonnet)...')
  let plan
  try {
    plan = await invokeClaude({
      prompt,
      model: 'sonnet',
      maxTokens: 8000,
      tools: [ITINERARY_TOOL],
      toolChoice: { type: 'tool', name: 'propose_itinerary' },
    })
  } catch (e) {
    console.log(`FAIL  generation itself failed: ${e.message}`)
    return false
  }

  const memberNames = fixture.members.map((m) => m.displayName)
  const checks = [
    assertValidSchema(plan),
    assertNoGenericLabels(plan),
    assertNoEventsBeforeArrival(plan, lastArrivalDatetime(fixture.logistics), memberNames),
  ]

  let allPassed = true
  for (const { pass, message } of checks) {
    console.log(`${pass ? 'PASS' : 'FAIL'}  ${message}`)
    if (!pass) allPassed = false
  }
  return allPassed
}

async function main() {
  const results = []
  for (const [name, fixture] of Object.entries(fixtures)) {
    results.push(await runFixture(name, fixture))
  }

  if (isLive) {
    const failed = results.filter((r) => !r).length
    console.log(`\n${'='.repeat(60)}`)
    console.log(failed ? `${failed}/${results.length} fixture(s) failed` : `All ${results.length} fixtures passed`)
    process.exit(failed ? 1 : 0)
  }
}

main().catch((e) => {
  console.error('Eval harness crashed:', e)
  process.exit(1)
})
