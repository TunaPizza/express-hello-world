const express = require('express')
const expressWs = require('express-ws')

const app = express()
expressWs(app)

const port = process.env.PORT || 3001
let connects = []
//入室しているユーザー管理(重複を許さない)(カワグチ)
let players = new Set()
//// WebSocket接続とユーザーIDを紐付けるMap()
let wsUserMap = new Map()
//チャットの履歴(カワグチ)
let chatHistory = [];

// ターン制御を保持(カワグチ)
let turnOrder = [];
// 現在のターンを保持(カワグチ)
let currentTurnIndex = 0;

let currentPhase = 'drawing';
// ラウンドの制御(カワグチ)
let currentRound = 1; // 現在のラウンド数を追跡
const totalRounds = 3; // ゲーム全体の総ラウンド数 (例として3に設定)
let currentTurnNumberInRound = 1; // 現在のラウンドにおけるターン数
let totalTurnsPerRound = 0; // 1ラウンドあたりの総ターン数 (プレイヤー数によって変動)

app.use(express.static('public'))

app.ws('/ws', (ws, req) => {
  connects.push(ws)


  ws.on('message', (message) => {
    //メッセージJSONに変換(カワグチ)
    const msg = JSON.parse(message)
    console.log('Received:', message)

    //undo/redo を最初に処理(お)
    if (msg.type === "undo" || msg.type === "redo" || msg.type === "paint") { //paint追加(カワグチ)
      broadcast(JSON.stringify(msg));
      return;
    }

    //参加したら(カワグチ)
    if (msg.type === 'join') {
      players.add(msg.id);
      wsUserMap.set(ws, msg.id);

      ws.send(JSON.stringify({
        type: 'init',
        players: Array.from(players),
        chatHistory: chatHistory
      }));


      const joinMsg = JSON.stringify({ type: 'join', id: msg.id });
      broadcast(joinMsg); // 全員にブロードキャスト
      broadcastPlayerCount();
      return;
    }

    if (msg.type === 'start') {
      // ひらがな1文字をランダムに選ぶ(カワグチ)
      const firstChar = getRandomHiragana();
      const shuffledPlayers = Array.from(players).sort(() => Math.random() - 0.5);
      console.log('Sending start message with turnOrder:', shuffledPlayers);

       turnOrder = shuffledPlayers;
        currentTurnIndex = 0;
            currentRound = 1; // ゲーム開始時にラウンドをリセット
            currentTurnNumberInRound = 1; // ゲーム開始時にターン数をリセット
            totalTurnsPerRound = players.size; // 1ラウンドの総ターン数はプレイヤー数と同じ
            currentPhase = 'drawing';


      // 全接続にゲーム開始通知を送る(カワグチ)
      connects.forEach((socket) => {
        if (socket.readyState === 1) {
          socket.send(JSON.stringify({
            type: 'start',
            firstChar: firstChar,
            turnOrder: shuffledPlayers,
            remainingTime: 60,
             currentRound: currentRound, // ★追加
                        totalRounds: totalRounds,   // ★追加
                        currentTurnNumber: currentTurnNumberInRound, // ★追加
                        totalTurnsPerRound: totalTurnsPerRound,     // ★追加
          }));
        }
      });
      notifyNextTurn();
      return;
    }

    // turnが終了したら(カワグチ)
    if (msg.type === 'turn_end') {
      console.log('サーバーで turn_end を受信 (回答完了)');
      if (currentPhase === 'answering') {
        advanceTurn(); // 次のプレイヤーの描画フェーズへ
      }
      return;
    }

    // 描画が完了したら(カワグチ)
    if (msg.type === 'drawing_completed') {
      console.log('サーバーで drawing_completed を受信');
      // 描画フェーズ中で、かつ現在のターンプレイヤーからの描画完了通知であること
      if (currentPhase === 'drawing' && wsUserMap.get(ws) === turnOrder[currentTurnIndex]) {
        currentPhase = 'answering'; // フェーズを回答中に変更
        console.log(`サーバー: フェーズ移行: 描画 -> 回答 (現在ターン: ${turnOrder[currentTurnIndex]})`);
        notifyNextTurn(); // 回答フェーズになったことをクライアントに通知
      }
      return;
    }

    // 描画時間切れや回答時間切れおこしたとき(カワグチ)
    if (msg.type === 'drawing_time_up' && currentPhase === 'drawing') {
                currentPhase = 'answering';
                console.log(`サーバー: 描画時間切れによりフェーズ移行: 描画 -> 回答 (現在ターン: ${turnOrder[currentTurnIndex]})`);
                notifyNextTurn(); // 回答フェーズになったことをクライアントに通知
            } else if (msg.type === 'answering_time_up' && currentPhase === 'answering') {
                advanceTurn(); // 次のプレイヤーの描画フェーズへ
            }
            return;
        }

    //チャットや回答(カワグチ)
    if (msg.type === 'chat' || msg.type === 'answer') {
      broadcast(message);
      if (msg.type === 'chat') {
        chatHistory.push({ id: msg.id, text: msg.text });
        if (chatHistory.length > 50) {
          chatHistory.shift();
        }
      }
      return;
    }

    //画像を送ったとき(カワグチ)
    if (msg.type === 'image_sended') {
      console.log('サーバーで image_sended を受信');
      // 画像データを送ってきた本人以外にブロードキャスト
      connects.forEach((socket) => {
        if (socket.readyState === 1 && socket !== ws) { // 送信者自身には送らない
          socket.send(JSON.stringify({ type: 'image_sended', imageData: msg.imageData }));
        }
      });
      return;
    }

    broadcast(message);
  })

  ws.on('close', () => {
    connects = connects.filter((conn) => conn !== ws)
    const userId = wsUserMap.get(ws);
    if (userId) {
      players.delete(userId);
      wsUserMap.delete(ws); // Mapからも削除
      console.log(`ユーザー ${userId} が切断されました。現在の登録プレイヤー: ${Array.from(players).length}`);
    } else {
      console.log('紐付けられたユーザーIDのないクライアントが切断されました。');
    }
    broadcastPlayerCount();

    const leaveMessage = {
      type: 'leave', // 新しいタイプ 'leave'
      id: userId // 誰が退室したか分かるようにIDを含める
    };
    broadcast(JSON.stringify(leaveMessage));
  })
})

// 全員に現在のプレイヤー数をブロードキャストする関数 (カワグチ)
function broadcastPlayerCount() {
  const playerCount = players.size; // 登録されているユニークなプレイヤーIDの数
  const message = JSON.stringify({
    type: 'player_count_update', // 新しいメッセージタイプ
    count: playerCount
  });
  connects.forEach((socket) => {
    if (socket.readyState === 1) { // OPEN状態のソケットにのみ送信
      socket.send(message);
    }
  });
  console.log(`現在の入室人数をブロードキャスト: ${playerCount}人`);

  // プレイヤーがいなくなった場合にゲームをリセットするなどの処理も検討
  if (playerCount === 0 && turnOrder.length > 0 || currentRound > 1) {
    console.log("全プレイヤーが退出しました。ゲーム状態をリセットします。");
    resetGameState(); // 後述するリセット関数を呼び出す
  }
}
function resetGameState() {
    players.clear();
    wsUserMap.clear();
    chatHistory = [];
    turnOrder = [];
    currentTurnIndex = 0;
    currentRound = 1; // ラウンドを初期化
    currentTurnNumberInRound = 1; // ターン数を初期化
    totalTurnsPerRound = 0; // 1ラウンドあたりの総ターン数を初期化
    currentPhase = 'drawing'; // フェーズを初期化
}


//連絡する関数(カワグチ)
function broadcast(message) {
  connects.forEach((socket) => {
    if (socket.readyState === 1) {
      socket.send(message);
    }
  });
}

//ターンを進める(カワグチ)
function advanceTurn() {
    // 現在のフェーズが「回答中」の場合にのみ、次のプレイヤーへターンを進める
    if (currentPhase === 'answering') {
        currentTurnIndex = (currentTurnIndex + 1) % turnOrder.length;
        currentTurnNumberInRound++; // ☆修正: 現在のラウンド内のターン数をインクリメント

        // 全員が1ターンずつ回った (ラウンドの終了判定)
        if (currentTurnIndex === 0) {
            if (currentRound < totalRounds) {
                currentRound++; // ☆修正: 次のラウンドへ
                currentTurnNumberInRound = 1; // ☆修正: 次のラウンドの最初のターンにリセット
                console.log(`サーバー: ラウンド終了。次のラウンド: ${currentRound}`);
            } else {
                // 全てのラウンドが終了した
                console.log("サーバー: 全てのラウンドが終了しました。ゲーム終了。");
                broadcast(JSON.stringify({ type: 'game_end', message: '全てのラウンドとターンが完了しました。' }));
                resetGameState(); // ☆修正: ゲーム終了時に状態をリセットする
                return;
            }
        }
        currentPhase = 'drawing';
        console.log(`サーバー: フェーズ移行: 回答 -> 描画 (現在ターン: ${turnOrder[currentTurnIndex]})`);
    } else {
        console.warn(`サーバー: currentPhaseが'answering'ではない状態でadvanceTurnが呼ばれました (現在のフェーズ: ${currentPhase})`);
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
        phase: currentPhase,
        currentRound: currentRound,         
        totalRounds: totalRounds,           
        currentTurnNumber: currentTurnNumberInRound, 
        totalTurnsPerRound: totalTurnsPerRound,     
    });
    broadcast(turnMsg);
}

//ひらがな　一文字を選ぶ関数(カワグチ)
function getRandomHiragana() {
  const hira = 'あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわをん';
  return hira[Math.floor(Math.random() * hira.length)];
}

app.listen(port, () => {
  console.log(`Server is running on http://localhost:${port}`)
})
