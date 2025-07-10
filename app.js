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
      if (!hostId) {
        hostId = msg.id;
      }

      // 各接続にhostIdを送る
      const joinMsg = JSON.stringify({
        type: 'join',
        id: msg.id,
        hostId: hostId,
      });

      connects.forEach((socket) => {
        if (socket.readyState === 1) {
          socket.send(joinMsg);
        }
      });
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
