const express = require('express')
const expressWs = require('express-ws')

const app = express()
expressWs(app)

const port = process.env.PORT || 3001
let connects = []
let players = new Set()

app.use(express.static('public'))

app.ws('/ws', (ws, req) => {
  connects.push(ws)

  ws.on('message', (message) => {
    const msg = JSON.parse(message)
    console.log('Received:', message)

    if (msg.type === 'join') {
      players.add(msg.id)

      // 全クライアントに現在の参加者リストを送信
      const playersMsg = JSON.stringify({
        type: 'players',
        players: Array.from(players),
      })

      connects.forEach((socket) => {
        if (socket.readyState === 1) {
          socket.send(playersMsg)
        }
      })

      // 他のクライアントに入室通知も送る
      const joinMsg = JSON.stringify({ type: 'join', id: msg.id })
      connects.forEach((socket) => {
        if (socket.readyState === 1) {
          socket.send(joinMsg)
        }
      })

      return
    }

    connects.forEach((socket) => {
      if (socket.readyState === 1) {
        socket.send(message)
      }
    })
  })

  ws.on('close', () => {
    connects = connects.filter((conn) => conn !== ws)
  })
})

app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`)
})
