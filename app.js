const express = require('express')
const expressWs = require('express-ws')

const app = express()
expressWs(app)

const port = process.env.PORT || 3001
let connects = []
let chatHistory = [];
let players = new Set()

let turnOrder = [];       // ターン順をグローバル管理
let currentTurnIndex = 0; // 現在のターンのインデックス

app.use(express.static('public'))

app.ws('/ws', (ws, req) => {
  connects.push(ws)

  ws.on('message', (message) => {
    const msg = JSON.parse(message)
    console.log('Received:', message)

    //undo/redo を最初に処理
    if (msg.type === "undo" || msg.type === "redo") {
      broadcast(JSON.stringify(msg));
      return;
    }

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
      const firstChar = getRandomHiragana();
      turnOrder = Array.from(players).sort(() => Math.random() - 0.5);
      currentTurnIndex = 0;

      // 全接続にゲーム開始通知を送る
      connects.forEach((socket) => {
        if (socket.readyState === 1) {
          socket.send(JSON.stringify({
            type: 'start',
            firstChar: firstChar,
            turnOrder: turnOrder,
          }));
        }
      });
      notifyNextTurn();
      return;
    }

    if (msg.type === 'answer') {
      // 他クライアントに回答を送信（保存処理もあれば実装）
      connects.forEach((socket) => {
        if (socket.readyState === 1) {
          socket.send(message);  // 受け取ったanswerメッセージをそのまま送る
        }
      });


      currentTurnIndex++;
      if (currentTurnIndex >= turnOrder.length) {
        currentTurnIndex = 0;
        // ここでラウンド処理もあれば追記
      }
      connects.forEach((socket) => {
        if (socket.readyState === 1) {
          socket.send(JSON.stringify({
            type: 'next_turn',
            currentPlayer: turnOrder[currentTurnIndex],
            turnOrder: turnOrder
          }));
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

function getRandomHiragana() {
  const hira = 'あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわをん';
  return hira[Math.floor(Math.random() * hira.length)];
}

app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`)
})
