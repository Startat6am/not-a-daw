const API = 'https://api.telegram.org'

function send(res, status, body) {
  res.status(status)
    .setHeader('Content-Type', 'application/json; charset=utf-8')
    .setHeader('Cache-Control', 'no-store')
    .send(JSON.stringify(body))
}

function getMedia(message) {
  if (message.audio) {
    return { file: message.audio, type: message.audio.mime_type || 'audio/mpeg', name: message.audio.file_name || message.caption || 'Telegram audio' }
  }
  if (message.document && (/^audio\//i.test(message.document.mime_type || '') || /\.(mp3|wav|m4a|aac|aiff?|ogg|flac|opus)$/i.test(message.document.file_name || ''))) {
    return { file: message.document, type: message.document.mime_type || 'audio/mpeg', name: message.document.file_name || message.caption || 'Telegram audio' }
  }
  return null
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return send(res, 405, { error: 'Method not allowed' })
  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token) return send(res, 503, { error: 'Добавь TELEGRAM_BOT_TOKEN в настройках Vercel.' })

  try {
    const [meResponse, webhookResponse] = await Promise.all([
      fetch(API + '/bot' + token + '/getMe'),
      fetch(API + '/bot' + token + '/getWebhookInfo'),
    ])
    const meData = await meResponse.json()
    const webhookData = await webhookResponse.json()
    if (!meData.ok) return send(res, 502, { error: 'Telegram не подтвердил токен. Проверь TELEGRAM_BOT_TOKEN в Vercel.' })
    if (!webhookData.ok) return send(res, 502, { error: 'Не удалось проверить настройки Telegram.' })

    const webhookEnabled = Boolean(webhookData.result?.url)
    const webhookPendingCount = Number(webhookData.result?.pending_update_count || 0)
    const response = await fetch(API + '/bot' + token + '/getUpdates?timeout=0&allowed_updates=' + encodeURIComponent(JSON.stringify(['message'])))
    const data = await response.json()
    if (!response.ok || !data.ok) {
      const description = data.description || 'Telegram Bot API error'
      if (String(description).includes('webhook')) return send(res, 409, { error: 'У бота включён webhook. Для импорта из личного чата нужен getUpdates; отключи webhook у бота.' })
      return send(res, 502, { error: description })
    }

    const updates = data.result || []
    const tracks = []
    let maxUpdateId = null
    let privateMessages = 0
    let recognizedAudioFiles = 0

    for (const update of updates) {
      maxUpdateId = Math.max(maxUpdateId ?? -1, update.update_id)
      const message = update.message
      if (!message || message.chat?.type !== 'private') continue
      privateMessages += 1
      const media = getMedia(message)
      if (media?.file?.file_id) recognizedAudioFiles += 1
      if (!media?.file?.file_id) continue
      tracks.push({
        updateId: update.update_id,
        fileId: media.file.file_id,
        name: String(media.name).slice(0, 240),
        type: media.type,
        size: Number(media.file.file_size || 0),
        duration: Number(media.file.duration || 0) || undefined,
        caption: String(message.caption || '').slice(0, 500),
      })
    }

    // Consume unrelated private messages so they don't block later audio messages.
    if (tracks.length === 0 && maxUpdateId !== null) {
      const ackResponse = await fetch(API + '/bot' + token + '/getUpdates?offset=' + (maxUpdateId + 1) + '&timeout=0&allowed_updates=' + encodeURIComponent(JSON.stringify(['message'])))
      const ackData = await ackResponse.json()
      if (!ackResponse.ok || !ackData.ok) return send(res, 502, { error: ackData.description || 'Не удалось обработать очередь Telegram.' })
    }

    return send(res, 200, {
      tracks,
      maxUpdateId,
      diagnostics: {
        botUsername: meData.result?.username || null,
        webhookEnabled,
        webhookPendingCount,
        pendingUpdates: updates.length,
        privateMessages,
        recognizedAudioFiles,
      },
    })
  } catch {
    return send(res, 502, { error: 'Не удалось связаться с Telegram. Попробуй ещё раз.' })
  }
}
