const { SESv2Client, SendEmailCommand } = require('@aws-sdk/client-sesv2')

const client = new SESv2Client({ region: process.env.AWS_REGION || 'us-east-1' })
const FROM_EMAIL = process.env.SES_FROM_EMAIL
const MAILING_ADDRESS = process.env.SES_MAILING_ADDRESS

// Guarded on purpose, on two separate things:
// 1. SES_FROM_EMAIL — SES starts in sandbox mode and needs a verified
//    sending identity + an AWS production-access approval before it can
//    email anyone outside a verified allowlist — neither exists yet.
// 2. SES_MAILING_ADDRESS — CAN-SPAM requires a real postal address in every
//    email; sending without one is a compliance violation, not just a
//    missing feature, so this blocks on it exactly like a missing identity.
// Until both are set, every call here just logs what would have been sent
// instead of throwing, so the rest of the pipeline can be built, deployed,
// and exercised safely with zero risk of a real, non-compliant email going out.
async function sendEmail({ to, subject, html, text }) {
  if (!FROM_EMAIL || !MAILING_ADDRESS) {
    console.log(
      JSON.stringify({
        emailSkipped: true,
        reason: !FROM_EMAIL ? 'SES_FROM_EMAIL not configured' : 'SES_MAILING_ADDRESS not configured',
        to,
        subject,
      })
    )
    return { sent: false }
  }
  try {
    await client.send(
      new SendEmailCommand({
        FromEmailAddress: FROM_EMAIL,
        Destination: { ToAddresses: [to] },
        Content: {
          Simple: {
            Subject: { Data: subject, Charset: 'UTF-8' },
            Body: {
              Html: { Data: html, Charset: 'UTF-8' },
              Text: { Data: text, Charset: 'UTF-8' },
            },
          },
        },
      })
    )
    return { sent: true }
  } catch (e) {
    // A failed send should never break the caller's own action (joining a
    // trip, adding a suggestion) — email is a side-effect, not the point.
    console.log(JSON.stringify({ emailFailed: true, to, subject, error: e.message }))
    return { sent: false, error: e.message }
  }
}

module.exports = { sendEmail }
