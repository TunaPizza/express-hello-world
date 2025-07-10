const express = require('express')
const expressWs = require('express-ws')

const app = express()
expressWs(app)

const port = process.env.PORT || 3001
let connects = []
let users = new Map()

app.use(express.static('public'))

app.ws('/ws', (ws, req) => {
  connects.push(ws)

  ws.on('message', (message) => {
    const msg = JSON.parse(message)
    console.log('Received:', message)

    if (msg.type === 'join') {
      const isHost = connects.length === 1
      users.set(ws, { id: msg.id, isHost })

      // 全員に join 通知を送信
      connects.forEach((socket) => {
        if (socket.readyState === 1) {
          const isSelf = socket === ws
          socket.send(JSON.stringify({
            type: 'join',
            id: msg.id,
            isHost: isSelf ? isHost : false
          }))
        }
      })
      return
    }

    if (msg.type === 'start') {
      // 全員にゲーム開始通知
      connects.forEach((socket) => {
        if (socket.readyState === 1) {
          socket.send(JSON.stringify({ type: 'start' }))
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
