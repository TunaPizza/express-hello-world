const express = require('express')
const expressWs = require('express-ws')

const app = express()
expressWs(app)

const port = process.env.PORT || 3001
let connects = []
let players = new Set()
let chatHistory = [];

let turnOrder = [];
let currentTurnIndex = 0;
let round = 1;

app.use(express.static('public'))

app.ws('/ws', (ws, req) => {
  connects.push(ws)

  ws.on('message', (message) => {
    const msg = JSON.parse(message)
    console.log('Received:', message)

    if (msg.type === "undo" || msg.type === "redo" || msg.type === "paint") {
      // 描画データやUNDO/REDOは全員にブロードキャスト
      broadcast(JSON.stringify(msg));
      return;
    }

    if (msg.type === 'join') {
      players.add(msg.id);

      ws.send(JSON.stringify({
        type: 'init',
        players: Array.from(players),
        chatHistory: chatHistory
      }));

      const playersMsg = JSON.stringify({
        type: 'players',
        players: Array.from(players),
      });
      broadcast(playersMsg); // 全員にブロードキャスト

      const joinMsg = JSON.stringify({ type: 'join', id: msg.id });
      broadcast(joinMsg); // 全員にブロードキャスト
      return;
    }

    if (msg.type === 'start') {
      const firstChar = getRandomHiragana();
      const shuffledPlayers = Array.from(players).sort(() => Math.random() - 0.5);
      console.log('Sending start message with turnOrder:', shuffledPlayers);
      turnOrder = shuffledPlayers;
      currentTurnIndex = 0;

      connects.forEach((socket) => {
        if (socket.readyState === 1) {
          socket.send(JSON.stringify({
            type: 'start',
            firstChar: firstChar,
            turnOrder: shuffledPlayers,
          }));
        }
      });
      notifyNextTurn();
      return;
    }

    // クライアントからの 'turn_end' メッセージ処理
    if (msg.type === 'turn_end') {
      console.log('サーバーで turn_end を受信');
      advanceTurn();
      return;
    }

    // クライアントからの 'drawing_completed' メッセージ処理
    if (msg.type === 'drawing_completed') {
        console.log('サーバーで drawing_completed を受信');
        // この時点ではまだ回答ターンなのでターンは進めない
        return;
    }

    // 描画時間切れや回答時間切れのメッセージを受けたときにターン進行
    if (msg.type === 'drawing_time_up' || msg.type === 'answering_time_up') {
      console.log(`サーバーで ${msg.type} を受信`);
      advanceTurn();
      return;
    }

    // ここが重要：'image_sended' メッセージの処理
    if (msg.type === 'image_sended') {
        console.log('サーバーで image_sended を受信');
        // 画像データを送ってきた本人以外にブロードキャスト
        connects.forEach((socket) => {
            if (socket.readyState === 1 && socket !== ws) { // 送信者自身には送らない
                socket.send(JSON.stringify({ type: 'image_sended', imageData: msg.imageData }));
            }
        });
        return; // 他の処理に移らないようにreturn
    }

    // その他のメッセージ（チャット、回答など）はそのままブロードキャスト
    broadcast(message);
  });

  ws.on('close', () => {
    connects = connects.filter((conn) => conn !== ws);
    // プレイヤーが退室した際の処理があればここに追加
  });
})

function broadcast(message) {
  connects.forEach((socket) => {
    if (socket.readyState === 1) {
      socket.send(message);
    }
  });
}

function advanceTurn() {
  currentTurnIndex = (currentTurnIndex + 1) % turnOrder.length;
  if (currentTurnIndex === 0) {
    round++;
  }
  notifyNextTurn();
}

function notifyNextTurn() {
  const currentPlayer = turnOrder[currentTurnIndex];
  const turnMsg = JSON.stringify({
    type: 'next_turn',
    currentTurn: currentPlayer,
    turnOrder: turnOrder,
    round: round
  });
  broadcast(turnMsg);
}

function getRandomHiragana() {
  const hira = 'あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわをん';
  return hira[Math.floor(Math.random() * hira.length)];
}

app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`)
})