export default async function handler(req, res) {
  if (req.method !== 'POST') { res.status(405).json({ error: 'Method not allowed' }); return }
  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token) { res.status(503).json({ error: 'Telegram integration is not configured' }); return }
  const offset = Number(req.body?.offset)
  if (!Number.isSafeInteger(offset) || offset < 1) { res.status(400).json({ error: 'Invalid offset' }); return }
  try {
    const response = await fetch('https://api.telegram.org/bot' + token + '/getUpdates?offset=' + offset + '&timeout=0&allowed_updates=' + encodeURIComponent(JSON.stringify(['message'])))
    const data = await response.json()
    if (!response.ok || !data.ok) { res.status(502).json({ error: data.description || 'Telegram acknowledgement failed' }); return }
    res.status(200).json({ ok: true })
  } catch { res.status(502).json({ error: 'Telegram acknowledgement failed' }) }
}
