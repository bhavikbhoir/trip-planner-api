// Real-world grounding for the itinerary prompt's hedged guess-language
// ("phrase hours/wait-time claims as general guidance to verify locally").
// Uses the free public Overpass API (OpenStreetMap) — no key required, but
// it's a shared community resource, so this is deliberately conservative:
// one combined query per location (not two), a small concurrency cap, hard
// per-call timeouts, and best-effort degrade-to-null on any failure.
const OVERPASS_URL = 'https://overpass-api.de/api/interpreter'
const USER_AGENT = 'Manifest-TripPlanner/1.0 (contextual trip-planning lookups)'

function buildQuery(lat, lng) {
  return `[out:json][timeout:8];(node(around:150,${lat},${lng})["opening_hours"];way(around:150,${lat},${lng})["opening_hours"];node(around:400,${lat},${lng})["amenity"="parking"];);out center 5;`
}

async function queryOverpass(lat, lng) {
  const res = await fetch(OVERPASS_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': USER_AGENT },
    body: `data=${encodeURIComponent(buildQuery(lat, lng))}`,
    // Observed empirically: the public instance's own gateway times out
    // around ~9.3s on slow queries and returns a proper 504 rather than
    // hanging — set client-side just above that so a real server error
    // surfaces instead of an abort racing it.
    signal: AbortSignal.timeout(10000),
  })
  if (!res.ok) throw new Error(`Overpass API returned ${res.status}`)
  const data = await res.json()
  return data.elements || []
}

async function findLocationContext(lat, lng) {
  if (lat == null || lng == null) return { openingHours: null, parking: null }
  try {
    const elements = await queryOverpass(lat, lng)
    const hoursEl = elements.find((el) => el.tags?.opening_hours && el.tags?.name)
    const parkingEl = elements.find((el) => el.tags?.amenity === 'parking')
    return {
      openingHours: hoursEl ? { name: hoursEl.tags.name, hours: hoursEl.tags.opening_hours } : null,
      parking: parkingEl ? { name: parkingEl.tags?.name || 'Parking nearby' } : null,
    }
  } catch (e) {
    console.warn('Overpass lookup failed, degrading gracefully', e.message)
    return { openingHours: null, parking: null }
  }
}

// Sequential, not parallel — verified empirically against the live public
// instance: a single request reliably completes in ~2s, but firing even 2
// concurrent requests from the same client causes both to stall past a 9s
// timeout. Whether that's deliberate per-connection throttling or queuing
// under shared load, the practical result is the same — concurrency here
// makes this slower and less reliable, not faster.
async function findLocationContexts(locations, concurrency = 1) {
  const results = new Array(locations.length)
  let next = 0
  async function worker() {
    while (next < locations.length) {
      const i = next++
      results[i] = await findLocationContext(locations[i].lat, locations[i].lng)
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, locations.length) }, worker))
  return results
}

module.exports = { findLocationContexts }
