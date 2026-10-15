const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager')

const secretsClient = new SecretsManagerClient({ region: process.env.AWS_REGION || 'us-east-1' })
const SECRET_NAME = process.env.WEATHER_SECRET_NAME || 'trip-planner/weather-api-key'
const WEATHER_API_URL = 'https://api.openweathermap.org/data/2.5/weather'
const FORECAST_API_URL = 'https://api.openweathermap.org/data/2.5/forecast'

let cachedApiKey = null

async function getApiKey() {
  if (cachedApiKey) return cachedApiKey
  const res = await secretsClient.send(new GetSecretValueCommand({ SecretId: SECRET_NAME }))
  cachedApiKey = res.SecretString
  return cachedApiKey
}

async function fetchWeather(city) {
  const apiKey = await getApiKey()
  const url = `${WEATHER_API_URL}?q=${encodeURIComponent(city)}&appid=${apiKey}&units=imperial`

  // Explicit fast-fail — a hanging/slow upstream shouldn't be able to eat
  // more than ~4s per attempt (~8s total across the one retry below).
  const res = await fetch(url, { signal: AbortSignal.timeout(4000) })
  if (!res.ok) throw new Error(`Weather API returned ${res.status}`)

  const data = await res.json()
  return {
    temperature: Math.round(data.main.temp),
    condition: data.weather[0]?.description ?? 'Unknown',
    city: data.name,
    icon: data.weather[0]?.icon ?? null,
  }
}

// Best-effort — callers should treat a null return as "no weather context available"
// rather than fail the whole request (this mirrors personal-planner-api/functions/weather).
async function getWeather(city) {
  if (!city) return null
  try {
    return await fetchWeather(city)
  } catch (firstErr) {
    console.warn('Weather fetch failed, retrying once', firstErr.message)
    try {
      return await fetchWeather(city)
    } catch (secondErr) {
      console.warn('Weather fetch failed after retry, degrading gracefully', secondErr.message)
      return null
    }
  }
}

async function fetchForecastEntries(city) {
  const apiKey = await getApiKey()
  const url = `${FORECAST_API_URL}?q=${encodeURIComponent(city)}&appid=${apiKey}&units=imperial`
  const res = await fetch(url, { signal: AbortSignal.timeout(4000) })
  if (!res.ok) throw new Error(`Weather forecast API returned ${res.status}`)
  const data = await res.json()
  return data.list || []
}

// OpenWeatherMap's forecast endpoint returns one entry per 3-hour slot,
// about 5 days out. Groups those into a hi/lo summary per calendar date,
// picking the slot closest to 1pm local as the representative condition/icon
// for that day. Days beyond the forecast window just aren't in the result —
// callers show nothing for those rather than a guessed number.
function aggregateByDay(entries) {
  const byDate = new Map()
  for (const entry of entries) {
    const date = entry.dt_txt.slice(0, 10)
    const hour = Number(entry.dt_txt.slice(11, 13))
    const temp = entry.main.temp
    const hourDiff = Math.abs(hour - 13)
    const existing = byDate.get(date)
    if (!existing) {
      byDate.set(date, {
        date,
        high: temp,
        low: temp,
        condition: entry.weather[0]?.description ?? 'Unknown',
        icon: entry.weather[0]?.icon ?? null,
        bestHourDiff: hourDiff,
      })
      continue
    }
    existing.high = Math.max(existing.high, temp)
    existing.low = Math.min(existing.low, temp)
    if (hourDiff < existing.bestHourDiff) {
      existing.condition = entry.weather[0]?.description ?? existing.condition
      existing.icon = entry.weather[0]?.icon ?? existing.icon
      existing.bestHourDiff = hourDiff
    }
  }
  return [...byDate.values()]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(({ date, high, low, condition, icon }) => ({
      date,
      high: Math.round(high),
      low: Math.round(low),
      condition,
      icon,
    }))
}

// Best-effort, same contract as getWeather — an empty array means "no
// forecast available for these days," not an error the caller must handle.
async function getForecast(city) {
  if (!city) return []
  try {
    return aggregateByDay(await fetchForecastEntries(city))
  } catch (firstErr) {
    console.warn('Weather forecast fetch failed, retrying once', firstErr.message)
    try {
      return aggregateByDay(await fetchForecastEntries(city))
    } catch (secondErr) {
      console.warn('Weather forecast fetch failed after retry, degrading gracefully', secondErr.message)
      return []
    }
  }
}

module.exports = { getWeather, getForecast }
