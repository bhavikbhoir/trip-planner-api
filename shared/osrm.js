// Real driving-route grounding between consecutive itinerary stops, via the
// free public OSRM demo server. Verified empirically that this server only
// actually serves its car/driving network — requesting other profile names
// in the URL (walking, bicycle, even nonsense strings) silently returns
// identical driving-network results rather than erroring, so this module
// only ever asks for 'driving' and never claims real pedestrian routing.
// Walking is instead estimated from straight-line distance (see
// estimateWalkMinutes) and labeled honestly as an estimate, not a route.
const OSRM_URL = 'https://router.project-osrm.org'
const WALK_METERS_PER_MINUTE = 80 // ~4.8 km/h average pace

function haversineMeters(lat1, lng1, lat2, lng2) {
  const R = 6371000
  const toRad = (d) => (d * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLng = toRad(lng2 - lng1)
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function estimateWalkMinutes(meters) {
  return Math.max(1, Math.round(meters / WALK_METERS_PER_MINUTE))
}

// Best-effort, single attempt — a slow/unavailable OSRM instance degrades to
// null (caller falls back to the walk-only estimate) rather than blocking
// or failing generation.
async function getDrivingRoute(fromLat, fromLng, toLat, toLng) {
  const url = `${OSRM_URL}/route/v1/driving/${fromLng},${fromLat};${toLng},${toLat}?overview=false`
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) })
    if (!res.ok) throw new Error(`OSRM returned ${res.status}`)
    const data = await res.json()
    if (data.code !== 'Ok' || !data.routes?.[0]) return null
    return { distanceMeters: data.routes[0].distance, durationSeconds: data.routes[0].duration }
  } catch (e) {
    console.warn('OSRM driving-route lookup failed, degrading gracefully', e.message)
    return null
  }
}

// One combined lookup per stop-to-stop leg: real driving time from OSRM plus
// a straight-line walking estimate, computed together since both need the
// same haversine distance as a base (and the walk estimate needs it as its
// only input regardless of whether the OSRM call succeeds).
async function getLegOptions(fromLat, fromLng, toLat, toLng) {
  const straightLineMeters = haversineMeters(fromLat, fromLng, toLat, toLng)
  const drive = await getDrivingRoute(fromLat, fromLng, toLat, toLng)
  return {
    walkMinutes: estimateWalkMinutes(straightLineMeters),
    straightLineMeters: Math.round(straightLineMeters),
    drive: drive ? { distanceMeters: Math.round(drive.distanceMeters), durationMinutes: Math.max(1, Math.round(drive.durationSeconds / 60)) } : null,
  }
}

module.exports = { getLegOptions }
