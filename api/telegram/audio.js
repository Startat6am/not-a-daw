const API = 'https://api.telegram.org'
export default async function handler(req, res) {
  if (req.method !== 'GET') { res.status(405).json({ error: 'Method not allowed' }); return }
  const token = process.env.TELEGRAM_BOT_TOKEN
  const fileId = typeof req.query.fileId === 'string' ? req.query.fileId : ''
  if (!token) { res.status(503).json({ error: 'Telegram integration is not configured' }); return }
  if (!fileId || fileId.length > 1024) { res.status(400).json({ error: 'Invalid file id' }); return }
  try {
    const infoResponse = await fetch(API + '/bot' + token + '/getFile?file_id=' + encodeURIComponent(fileId))
    const info = await infoResponse.json()
    if (!infoResponse.ok || !info.ok || !info.result?.file_path) { res.status(502).json({ error: info.description || 'Telegram file is unavailable' }); return }
    if (Number(info.result.file_size || 0) > 20 * 1024 * 1024) { res.status(413).json({ error: 'Этот файл больше 20 МБ. Bot API не позволяет скачать его через обычный бот.' }); return }
    const fileResponse = await fetch(API + '/file/bot' + token + '/' + info.result.file_path)
    if (!fileResponse.ok) { res.status(502).json({ error: 'Не удалось скачать аудио из Telegram' }); return }
    const bytes = Buffer.from(await fileResponse.arrayBuffer())
    res.status(200)
    res.setHeader('Content-Type', fileResponse.headers.get('content-type') || 'application/octet-stream')
    res.setHeader('Content-Length', String(bytes.length))
    res.setHeader('Content-Disposition', 'attachment; filename="telegram-audio"')
    res.setHeader('Cache-Control', 'private, no-store')
    res.end(bytes)
  } catch {
    if (!res.headersSent) res.status(502).json({ error: 'Ошибка загрузки аудио из Telegram' })
  }
}
