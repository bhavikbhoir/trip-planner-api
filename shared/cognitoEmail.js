const { CognitoIdentityProviderClient, AdminGetUserCommand } = require('@aws-sdk/client-cognito-identity-provider')

const client = new CognitoIdentityProviderClient({ region: process.env.AWS_REGION || 'us-east-1' })
const USER_POOL_ID = process.env.COGNITO_USER_POOL_ID

// The registered email lives in Cognito, not our own table — this pool uses
// UsernameAttributes: ['email'], so Cognito auto-generates the Username as
// the same UUID as `sub`, meaning the userId we already have everywhere
// (from the JWT's `sub`) doubles as the AdminGetUser Username. Deliberately
// not cached in DynamoDB (unlike displayName, which predates this and was
// never worth migrating): email-sending is a background/batch path, not a
// hot one, so a fresh lookup avoids ever emailing a stale/changed address.
async function getUserEmail(userId) {
  try {
    const res = await client.send(new AdminGetUserCommand({ UserPoolId: USER_POOL_ID, Username: userId }))
    return res.UserAttributes?.find((a) => a.Name === 'email')?.Value || null
  } catch (e) {
    console.log(JSON.stringify({ emailLookupFailed: true, userId, error: e.message }))
    return null
  }
}

module.exports = { getUserEmail }
