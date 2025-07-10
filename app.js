const express = require('express')
const expressWs = require('express-ws')

const app = express()
expressWs(app)

const port = process.env.PORT || 3001
let connects = []
let chatHistory = [];
let players = new Set();

app.use(express.static('public'))

app.ws('/ws', (ws, req) => {

  connects.push(ws)

  ws.on('message', (message) => {
    //const msg = JSON.parse(message);
    console.log('Received:', message)

    if (msg.type === 'join') {
      players.add(msg.id);

      // 新しいクライアントにチャット履歴と参加者リストを送る
      ws.send(JSON.stringify({ type: 'history', chatHistory: chatHistory, players: Array.from(players) }));

      // 他の人に入室通知
      const joinMsg = JSON.stringify({ type: 'join', id: msg.id });
      connects.forEach((socket) => {
        if (socket !== ws && socket.readyState === 1) {
          socket.send(joinMsg);
        }
      });

      return;
    }

    if (msg.type === 'chat') {
      chatHistory.push({ id: msg.id, text: msg.text });
    }

    if (msg.type === 'start') {
      // ゲーム開始通知
      connects.forEach((socket) => {
        if (socket.readyState === 1) {
          socket.send(JSON.stringify({ type: 'start' }));
        }
      });
      return;
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
