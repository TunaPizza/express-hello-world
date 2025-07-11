const express = require('express')
const expressWs = require('express-ws')

const app = express()
expressWs(app)

const port = process.env.PORT || 3001
let connects = []
let chatHistory = [];
let players = new Set()

app.use(express.static('public'))

app.ws('/ws', (ws, req) => {
  connects.push(ws)

  ws.on('message', (message) => {
    const msg = JSON.parse(message)
    console.log('Received:', message)

    if (msg.type === 'join') {
      players.add(msg.id)

      // 新しく入室した人に、履歴をまとめて送る
      ws.send(JSON.stringify({
        type: 'init',
        players: Array.from(players),
        chatHistory: chatHistory
      }));

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

    if (msg.type === 'start') {
      // ひらがな1文字をランダムに選ぶ
      const hiraganaList = 'あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわ'.split('');
      const randomChar = hiraganaList[Math.floor(Math.random() * hiraganaList.length)];
      const shuffledPlayers = Array.from(players).sort(() => Math.random() - 0.5);
      // 全接続にゲーム開始通知を送る
      connects.forEach((socket) => {
        if (socket.readyState === 1) {
          socket.send(JSON.stringify({ type: 'start', firstChar: randomChar,turnOrder: shuffledPlayers,}));
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
