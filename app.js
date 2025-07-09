const express = require('express')
const expressWs = require('express-ws')

const app = express()
expressWs(app)

const port = process.env.PORT || 3001
let connects = []
let players = [] // 参加者リスト

app.use(express.static('public'))

app.ws('/ws', (ws, req) => {
  connects.push(ws)

  ws.on('message', (message) => {
    let data
    try {
      data = JSON.parse(message)
    } catch (e) {
      console.error('Invalid JSON:', message)
      return
    }

    if (data.type === 'join') {
      // 参加者を追加
      players.push({ id: data.id, turns: data.turns, rounds: data.rounds })
      // 全員に参加者リストを送る
      broadcast({ type: 'players', players })
      // ゲーム開始を促すメッセージを送る例（必要に応じて）
      // broadcast({ type: 'info', text: `${data.id}さんが参加しました` })
      // すぐ開始するならstartも送る
      // broadcast({ type: 'start' })
      return
    }

    if (data.type === 'start') {
      // 全員にゲーム開始通知を送る
      broadcast({ type: 'start' })
      return
    }

    // チャットやペイントはそのまま全員にブロードキャスト
    broadcast(data)
  })

  ws.on('close', () => {
    connects = connects.filter((conn) => conn !== ws)
    // playersの整理も必要
  })
})

function broadcast(msg) {
  const json = JSON.stringify(msg)
  connects.forEach((socket) => {
    if (socket.readyState === 1) {
      socket.send(json)
    }
  })
}

app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`)
})
