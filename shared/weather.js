const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager')

const secretsClient = new SecretsManagerClient({ region: process.env.AWS_REGION || 'us-east-1' })
const SECRET_NAME = process.env.WEATHER_SECRET_NAME || 'trip-planner/weather-api-key'
const WEATHER_API_URL = 'https://api.openweathermap.org/data/2.5/weather'

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

  const res = await fetch(url)
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

module.exports = { getWeather }
