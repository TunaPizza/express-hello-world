const express = require('express')
const expressWs = require('express-ws')

const app = express()
expressWs(app)

const port = process.env.PORT || 3001
let connects = []
//入室しているユーザー管理(重複を許さない)(カワグチ)
let players = new Set()
let chatHistory = [];

// グローバルでターン制御を保持(カワグチ)
let turnOrder = [];
let currentTurnIndex = 0;
let round = 1;

app.use(express.static('public'))

app.ws('/ws', (ws, req) => {
  connects.push(ws)

  ws.on('message', (message) => {
    //メッセージJSONに変換(カワグチ)
    const msg = JSON.parse(message)
    console.log('Received:', message) // 受信したメッセージをログに出力

    // undo/redo を最初に処理(お)
    if (msg.type === "undo" || msg.type === "redo" || msg.type === "paint") { // paintもブロードキャスト
      broadcast(JSON.stringify(msg));
      return;
    }

    // 参加したら(カワグチ)
    if (msg.type === 'join') {
      players.add(msg.id);

      // 新しく入室した人に、履歴をまとめて送信(カワグチ)
      ws.send(JSON.stringify({
        type: 'init',
        players: Array.from(players),
        chatHistory: chatHistory // 必要であればチャット履歴も送る
      }));

      // 全クライアントに現在の参加者リストを送信(カワグチ)
      const playersMsg = JSON.stringify({
        type: 'players',
        players: Array.from(players),
      });

      connects.forEach((socket) => {
        if (socket.readyState === 1) {
          socket.send(playersMsg);
        }
      });

      // 他のクライアントに入室通知も送る(カワグチ)
      const joinMsg = JSON.stringify({ type: 'join', id: msg.id });
      connects.forEach((socket) => {
        if (socket.readyState === 1) {
          socket.send(joinMsg);
        }
      });
      return; // joinメッセージの処理が完了したらここで終了
    }

    // ゲーム開始メッセージの処理
    if (msg.type === 'start') {
      const firstChar = getRandomHiragana();
      const shuffledPlayers = Array.from(players).sort(() => Math.random() - 0.5);
      console.log('Sending start message with turnOrder:', shuffledPlayers);
      turnOrder = shuffledPlayers;
      currentTurnIndex = 0; // ゲーム開始時は最初のプレイヤーに設定

      // 全接続にゲーム開始通知を送る(カワグチ)
      connects.forEach((socket) => {
        if (socket.readyState === 1) {
          socket.send(JSON.stringify({
            type: 'start',
            firstChar: firstChar,
            turnOrder: shuffledPlayers,
          }));
        }
      });
      notifyNextTurn(); // 最初のターンプレイヤーに通知
      return;
    }

    // クライアントからの 'turn_end' メッセージ処理 (カワグチの元のコードから移動)
    // クライアントサイドの setAnsweringTurnUI() で ws.send({ type: 'turn_end' }) が呼ばれる想定
    if (msg.type === 'turn_end') {
      console.log('サーバーで turn_end を受信');
      advanceTurn(); // ターンを進める関数を呼び出す
      return;
    }

    // クライアントからの 'drawing_completed' メッセージ処理 (追加)
    // クライアントサイドの sendPictureButton.onclick で呼ばれる想定
    if (msg.type === 'drawing_completed') {
        console.log('サーバーで drawing_completed を受信');
        // 描画完了後、回答ターンへ移行するため、ターンを進める (または次のプレイヤーの描画ターンへ)
        // ここでの advanceTurn は、描画ターンから回答ターンへの移行ではなく、
        // 次のプレイヤーの描画ターンへの移行を意味することが多い。
        // もし「描画が終わったら次のプレイヤーの回答ターン」ではなく、
        // 「描画が終わったら同じプレイヤーの回答ターン」なら、ここでは advanceTurn を呼ばない。
        // 今回のクライアントコードの isAnsweringTurn = true; があるので、ここでは advanceTurn を呼ばず、
        // 回答完了時（turn_end）に呼ぶのが正しい。
        // ただし、時間切れで回答に移る場合は、時間切れのメッセージを受け取ったときにターンを進める必要がある。
        // この `drawing_completed` は、次のプレイヤーの描画ターンに移るトリガーにはしない。
        // 主にサーバーで「このプレイヤーは描き終えた」という状態を管理するために使う。
        return;
    }

    // 描画時間切れや回答時間切れのメッセージを受けたときにターン進行
    // これはクライアントが時間切れになった際に、サーバーに通知する目的
    if (msg.type === 'drawing_time_up' || msg.type === 'answering_time_up') {
      console.log(`サーバーで ${msg.type} を受信`);
      advanceTurn(); // ターンを進める
      return;
    }

    // その他のメッセージ（チャット、描画データ、回答など）はそのままブロードキャスト
    broadcast(message);
  });

  ws.on('close', () => {
    connects = connects.filter((conn) => conn !== ws);
    // プレイヤーが退室した際の処理があればここに追加
    // 例: players Set から退室したユーザーを削除し、全クライアントに通知
  });
});

// 全ての接続中のクライアントにメッセージをブロードキャストするヘルパー関数
function broadcast(message) {
  connects.forEach((socket) => {
    if (socket.readyState === 1) { // WebSocket.OPEN state
      socket.send(message);
    }
  });
}

// ターンを進める(カワグチ)
function advanceTurn() {
  currentTurnIndex = (currentTurnIndex + 1) % turnOrder.length;
  // 全員のターンが一巡したら次のラウンドへ
  if (currentTurnIndex === 0) { // 配列の最初に戻ったらラウンド数増加
    round++;
  }
  notifyNextTurn();
}

// 次のプレイヤーに通知(カワグチ)
function notifyNextTurn() {
  const currentPlayer = turnOrder[currentTurnIndex];
  const turnMsg = JSON.stringify({
    type: 'next_turn',
    currentTurn: currentPlayer,
    turnOrder: turnOrder,
    round: round
  });

  broadcast(turnMsg); // broadcast関数を使う
}

//ひらがな　一文字を選ぶ関数(カワグチ)
function getRandomHiragana() {
  const hira = 'あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわをん';
  return hira[Math.floor(Math.random() * hira.length)];
}

app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`)
})