const API = 'https://api.telegram.org'
function send(res, status, body) { res.status(status).setHeader('Content-Type', 'application/json; charset=utf-8').setHeader('Cache-Control', 'no-store').send(JSON.stringify(body)) }
function getMedia(message) {
  if (message.audio) return { file: message.audio, type: message.audio.mime_type || 'audio/mpeg', name: message.audio.file_name || message.caption || 'Telegram audio' }
  if (message.document && (/^audio\//i.test(message.document.mime_type || '') || /\.(mp3|wav|m4a|aac|aiff?|ogg|flac|opus)$/i.test(message.document.file_name || ''))) {
    return { file: message.document, type: message.document.mime_type || 'audio/mpeg', name: message.document.file_name || message.caption || 'Telegram audio' }
  }
  return null
}
export default async function handler(req, res) {
  if (req.method !== 'GET') return send(res, 405, { error: 'Method not allowed' })
  const token = process.env.TELEGRAM_BOT_TOKEN
  if (!token) return send(res, 503, { error: 'Добавь TELEGRAM_BOT_TOKEN в настройках Vercel и сделай бота администратором канала @dnb_selected.' })
  try {
    const [meResponse, webhookResponse] = await Promise.all([
      fetch(API + '/bot' + token + '/getMe'),
      fetch(API + '/bot' + token + '/getWebhookInfo'),
    ])
    const meData = await meResponse.json()
    const webhookData = await webhookResponse.json()
    if (!meData.ok) return send(res, 502, { error: 'Telegram не подтвердил токен через getMe. Проверь, что в Vercel сохранён токен нужного бота.' })
    if (!webhookData.ok) return send(res, 502, { error: 'Не удалось проверить настройки получения обновлений Telegram.' })
    const botUsername = meData.result?.username || null
    const webhookEnabled = Boolean(webhookData.result?.url)
    const webhookPendingCount = Number(webhookData.result?.pending_update_count || 0)
    const response = await fetch(API + '/bot' + token + '/getUpdates?timeout=0&allowed_updates=' + encodeURIComponent(JSON.stringify(['channel_post', 'message'])))
    const data = await response.json()
    if (!response.ok || !data.ok) {
      const description = data.description || 'Telegram Bot API error'
      if (String(description).includes('webhook')) return send(res, 409, { error: 'У бота включён webhook. Для этой версии интеграции нужен getUpdates; отключи webhook у бота.' })
      return send(res, 502, { error: description })
    }
    const updates = data.result || []
    const tracks = []
    let maxUpdateId = null
    let channelPosts = 0
    let matchingChannelPosts = 0
    let recognizedAudioPosts = 0
    for (const update of updates) {
      maxUpdateId = Math.max(maxUpdateId ?? -1, update.update_id)
      const post = update.channel_post || update.message
      if (!post) continue
      if (update.channel_post) channelPosts += 1
      const isChannelPost = update.channel_post && post.chat?.username?.toLowerCase() === 'dnb_selected'
      if (isChannelPost) matchingChannelPosts += 1
      const forwardedOrigin = post.forward_origin?.chat?.username || post.forward_from_chat?.username || ''
      const isForwardedChannelPost = update.message && String(forwardedOrigin).toLowerCase() === 'dnb_selected'
      if (!isChannelPost && !isForwardedChannelPost) continue
      const media = getMedia(post)
      if (media?.file?.file_id) recognizedAudioPosts += 1
      if (!media || !media.file.file_id) continue
      tracks.push({
        updateId: update.update_id,
        fileId: media.file.file_id,
        name: String(media.name).slice(0, 240),
        type: media.type,
        size: Number(media.file.file_size || 0),
        duration: Number(media.file.duration || 0) || undefined,
        caption: String(post.caption || '').slice(0, 500),
      })
    }
    return send(res, 200, { tracks, maxUpdateId, diagnostics: { botUsername, webhookEnabled, webhookPendingCount, pendingUpdates: updates.length, channelPosts, matchingChannelPosts, recognizedAudioPosts } })
  } catch {
    return send(res, 502, { error: 'Не удалось связаться с Telegram. Попробуй ещё раз.' })
  }
}
