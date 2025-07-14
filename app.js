const express = require('express');
const expressWs = require('express-ws');

const app = express();
const wsInstance = expressWs(app); // express-ws をインスタンス化

const port = process.env.PORT || 3001;

let connections = new Set(); // Set を使用して接続を管理
let playerSockets = new Map(); // {player_id: websocket} のマッピング

// --- ゲーム状態管理オブジェクト ---
const gameState = {
    players: new Set(), // 接続中のプレイヤーIDのセット
    turnOrder: [],      // プレイヤーIDのリスト
    currentTurnIndex: -1,
    currentRound: 0,
    gameStarted: false,
    firstChar: "",
    chatHistory: [],    // 全チャット履歴
    // drawingHistory: {}, // {player_id: [stroke_data, ...]} 各プレイヤーの描画履歴（現状サーバーでは保持しないが、必要なら追加）
    // undoneHistory: {},  // {player_id: [undone_stroke_data, ...]} 各プレイヤーのundo履歴（現状サーバーでは保持しないが、必要なら追加）

    // ゲームフェーズ管理
    // 'waiting': ゲーム開始待ち
    // 'drawing': 描画フェーズ
    // 'answering': 回答フェーズ
    // 'results': 結果表示フェーズ (今回の実装では簡易的)
    current_game_phase: 'waiting',
    last_action_player_id: null, // 前のアクションを実行したプレイヤーID
    last_action_type: null,      // 前のアクションタイプ
};

function resetGame() {
    /** ゲームの状態を初期化する */
    gameState.turnOrder = [];
    gameState.currentTurnIndex = -1;
    gameState.currentRound = 0;
    gameState.gameStarted = false;
    gameState.firstChar = "";
    gameState.chatHistory = []; // 必要ならチャット履歴もリセット
    // gameState.drawingHistory = {};
    // gameState.undoneHistory = {};
    gameState.current_game_phase = 'waiting';
    gameState.last_action_player_id = null;
    gameState.last_action_type = null;
}

// 静的ファイルの提供
app.use(express.static('public'));

// --- ユーティリティ関数 ---
function broadcast(message) {
    /** 全ての接続中のクライアントにメッセージを送信する */
    connections.forEach(ws => {
        if (ws.readyState === ws.OPEN) {
            ws.send(message);
        }
    });
}

function sendToPlayer(playerId, message) {
    /** 特定のプレイヤーにメッセージを送信する */
    const ws = playerSockets.get(playerId);
    if (ws && ws.readyState === ws.OPEN) {
        ws.send(message);
    }
}

// --- ゲームロジック ---
function notifyNextTurn() {
    /** 次のプレイヤーにターン情報を通知する */
    if (!gameState.gameStarted || !gameState.turnOrder.length) {
        console.log("ゲームが開始されていないか、ターン順序が設定されていません。");
        return;
    }

    const currentTurnPlayerId = gameState.turnOrder[gameState.currentTurnIndex];
    console.log(`フェーズ: ${gameState.current_game_phase}, 現在のターンプレイヤー: ${currentTurnPlayerId}`);

    // 現在のターンプレイヤーにUIを切り替えさせるための詳細な情報を送る
    sendToPlayer(currentTurnPlayerId, JSON.stringify({
        type: 'next_turn',
        currentTurn: currentTurnPlayerId,
        turnOrder: gameState.turnOrder,
        round: gameState.currentRound,
        lastActionType: gameState.last_action_type,
        lastActionPlayerId: gameState.last_action_player_id,
        // gamePhase: gameState.current_game_phase, // クライアントがフェーズを判断するため
    }));

    // 他のプレイヤーには、現在の絵を描いている/回答しているプレイヤーのIDを伝え、待機UIに切り替えさせる
    gameState.players.forEach(pid => {
        if (pid !== currentTurnPlayerId) {
            sendToPlayer(pid, JSON.stringify({
                type: 'next_turn',
                currentTurn: currentTurnPlayerId, // 絵を描いている/回答しているプレイヤーのID
                turnOrder: gameState.turnOrder,
                round: gameState.currentRound,
                lastActionType: gameState.last_action_type,
                lastActionPlayerId: gameState.last_action_player_id,
                // gamePhase: gameState.current_game_phase, // クライアントがフェーズを判断するため
            }));
        }
    });
}

function advanceGamePhaseAndTurn(lastActionPlayerId, lastActionType) {
    /**
     * ゲームのフェーズを進め、次のターンプレイヤーを決定する
     * @param {string} lastActionPlayerId - 直前のアクションを実行したプレイヤーID
     * @param {string} lastActionType - 直前のアクションタイプ (e.g., 'drawing_finished', 'answer_submitted', 'time_up')
     */
    gameState.last_action_player_id = lastActionPlayerId;
    gameState.last_action_type = lastActionType;

    if (gameState.current_game_phase === 'drawing') {
        // 描画フェーズ終了 -> 回答フェーズへ移行
        gameState.current_game_phase = 'answering';
        console.log(`フェーズ変更: drawing -> answering. 描画者(${lastActionPlayerId})が回答。`);
        // 描画した人がそのまま回答フェーズに入るので、ターンインデックスは変更しない
    } else if (gameState.current_game_phase === 'answering') {
        // 回答フェーズ終了 -> 次の描画フェーズへ移行
        gameState.current_game_phase = 'drawing';

        // 次のターンプレイヤーを決定
        gameState.currentTurnIndex = (gameState.currentTurnIndex + 1) % gameState.turnOrder.length;

        // 全員が一周したらラウンドを増やす
        if (gameState.currentTurnIndex === 0) {
            gameState.currentRound++;
            console.log(`ラウンド ${gameState.currentRound} 開始！`);
            // TODO: ゲーム終了条件（例: 指定ラウンド数に達したら）をここでチェック
        }
        console.log(`フェーズ変更: answering -> drawing. 次の描画者: ${gameState.turnOrder[gameState.currentTurnIndex]}`);
    }
    // ここでクライアントに次のターン状態を通知
    notifyNextTurn();
}

// --- WebSocketハンドラ ---
app.ws('/ws', (ws, req) => {
    // プレイヤーIDの生成
    const playerId = `user_${Math.random().toString(36).substr(2, 8)}`;
    connections.add(ws);
    gameState.players.add(playerId);
    playerSockets.set(playerId, ws);

    console.log(`新規接続: ${playerId}. 現在の接続数: ${connections.size}`);

    // 接続時に現在のゲーム状態をクライアントに送信 (initメッセージ)
    // chatHistoryは全ての履歴を送る
    // currentTurnPlayerId は currentTurnIndex が -1 でなければ有効
    const currentTurnPlayerId = gameState.currentTurnIndex !== -1 ? gameState.turnOrder[gameState.currentTurnIndex] : null;

    ws.send(JSON.stringify({
        type: 'init',
        players: Array.from(gameState.players),
        gameStarted: gameState.gameStarted,
        chatHistory: gameState.chatHistory,
        currentTurn: currentTurnPlayerId,
        turnOrder: gameState.turnOrder, // 初期状態では空配列
        round: gameState.currentRound,
        firstChar: gameState.firstChar,
        gamePhase: gameState.current_game_phase,
    }));

    // 全クライアントにプレイヤーリスト更新を通知
    broadcast(JSON.stringify({
        type: 'players',
        players: Array.from(gameState.players),
    }));
    broadcast(JSON.stringify({
        type: 'chat',
        id: playerId,
        text: 'が入室しました',
    }));

    ws.on('message', (message) => {
        const msg = JSON.parse(message);
        console.log(`Received from ${playerId}: ${JSON.stringify(msg)}`);

        // 誰のターンでもない場合に許可するメッセージ (チャット、参加、ゲーム開始など)
        if (!gameState.gameStarted || gameState.turnOrder[gameState.currentTurnIndex] !== playerId) {
            if (msg.type === 'chat') {
                const fullMessage = { id: msg.id || playerId, text: msg.text, type: 'chat' };
                gameState.chatHistory.push(fullMessage);
                broadcast(JSON.stringify(fullMessage));
                return; // ここで処理終了
            }
            if (msg.type === 'start') {
                if (!gameState.gameStarted && gameState.players.size >= 1) { // 最低人数1人
                    resetGame(); // ゲーム状態をリセット
                    gameState.gameStarted = true;
                    gameState.currentRound = 1;
                    gameState.current_game_phase = 'drawing'; // 最初のフェーズは描画

                    // ターン順をランダムに決定
                    gameState.turnOrder = Array.from(gameState.players);
                    // Fisher-Yates shuffle
                    for (let i = gameState.turnOrder.length - 1; i > 0; i--) {
                        const j = Math.floor(Math.random() * (i + 1));
                        [gameState.turnOrder[i], gameState.turnOrder[j]] = [gameState.turnOrder[j], gameState.turnOrder[i]];
                    }
                    gameState.currentTurnIndex = 0; // 最初のプレイヤー

                    // 最初の文字をランダムに決定
                    const firstChars = 'あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわをん';
                    gameState.firstChar = firstChars[Math.floor(Math.random() * firstChars.length)];

                    console.log(`ゲーム開始！最初の文字: ${gameState.firstChar}, ターン順: ${gameState.turnOrder}`);

                    // 全クライアントにゲーム開始と最初のターン情報を通知
                    broadcast(JSON.stringify({
                        type: 'start',
                        firstChar: gameState.firstChar,
                        currentTurn: gameState.turnOrder[gameState.currentTurnIndex],
                        turnOrder: gameState.turnOrder,
                        round: gameState.currentRound,
                    }));
                    notifyNextTurn(); // 最初のターンを通知
                } else {
                    sendToPlayer(playerId, JSON.stringify({ type: 'error', message: 'ゲームを開始できませんでした。' }));
                }
                return; // ここで処理終了
            }
            // 自分のターンではないが、描画関連のブロードキャストは受け付ける (他の人の描画を見るため)
            if (msg.type === 'paint' || msg.type === 'undo' || msg.type === 'redo' || msg.type === 'image_sended' || msg.type === 'answer') {
                 // これらは後続のロジックで現在のターンプレイヤーかどうかを厳密にチェックするため、ここでは `return` しない
            } else {
                 // その他の予期しないメッセージは無視またはエラー
                 console.warn(`Unrecognized message type or not player's turn: ${msg.type}`);
                 return;
            }
        }

        // --- 現在のターンプレイヤーのみが実行できるアクション ---
        const isCurrentTurnPlayer = (gameState.gameStarted && gameState.turnOrder[gameState.currentTurnIndex] === playerId);

        if (msg.type === 'paint') {
            if (isCurrentTurnPlayer && gameState.current_game_phase === 'drawing') {
                broadcast(message); // 描画データはそのまま転送
            } else {
                sendToPlayer(playerId, JSON.stringify({ type: 'error', message: '描画するターンではありません。' }));
            }
        } else if (msg.type === 'undo' || msg.type === 'redo') {
            if (isCurrentTurnPlayer && gameState.current_game_phase === 'drawing') {
                broadcast(message); // undo/redo イベントをブロードキャスト
            } else {
                sendToPlayer(playerId, JSON.stringify({ type: 'error', message: '操作するターンではありません。' }));
            }
        } else if (msg.type === 'image_sended') {
            if (isCurrentTurnPlayer && gameState.current_game_phase === 'drawing') {
                broadcast(JSON.stringify({ type: 'image_sended', imageData: msg.imageData }));
                console.log(`プレイヤー ${playerId} が絵を送信しました。次のフェーズへ。`);
                advanceGamePhaseAndTurn(playerId, 'drawing_finished'); // 回答フェーズへ移行
            } else {
                sendToPlayer(playerId, JSON.stringify({ type: 'error', message: '絵を送信するターンではありません。' }));
            }
        } else if (msg.type === 'answer') {
            if (isCurrentTurnPlayer && gameState.current_game_phase === 'answering') {
                const fullMessage = { id: msg.id || playerId, text: msg.text, type: 'answer' };
                // 回答はチャット履歴には含めないが、チャットエリアには表示するのでブロードキャスト
                broadcast(JSON.stringify(fullMessage));
                console.log(`プレイヤー ${playerId} が回答しました: ${msg.text}`);
                // クライアントが 'turn_end' を送ってくるのを待つ
            } else {
                sendToPlayer(playerId, JSON.stringify({ type: 'error', message: '回答するターンではありません。' }));
            }
        } else if (msg.type === 'turn_end') {
            // 回答送信後にクライアントから明示的に送られるターン終了通知
            if (isCurrentTurnPlayer && gameState.current_game_phase === 'answering') {
                console.log(`プレイヤー ${playerId} がターン終了を通知。次のターンへ。`);
                advanceGamePhaseAndTurn(playerId, 'answer_submitted'); // 次の描画フェーズへ移行
            } else {
                sendToPlayer(playerId, JSON.stringify({ type: 'error', message: '現在あなたのターンではありません。' }));
            }
        } else if (msg.type === 'drawing_time_up' || msg.type === 'answering_time_up') {
            if (isCurrentTurnPlayer &&
                ((msg.type === 'drawing_time_up' && gameState.current_game_phase === 'drawing') ||
                 (msg.type === 'answering_time_up' && gameState.current_game_phase === 'answering'))
            ) {
                console.log(`プレイヤー ${playerId} の${msg.type === 'drawing_time_up' ? '描画' : '回答'}時間切れ。強制的に次のフェーズ/ターンへ。`);
                advanceGamePhaseAndTurn(playerId, msg.type); // 時間切れに応じて次のフェーズ/ターンへ移行
            } else {
                console.warn(`警告: プレイヤー ${playerId} が時間切れを報告しましたが、現在のターンプレイヤーではありませんでした。またはフェーズが一致しませんでした。`);
            }
        }
    });

    ws.on('close', () => {
        connections.delete(ws);
        gameState.players.delete(playerId);
        playerSockets.delete(playerId);

        console.log(`接続終了: ${playerId}. 残りの接続数: ${connections.size}`);

        // プレイヤーリスト更新を通知
        broadcast(JSON.stringify({
            type: 'players',
            players: Array.from(gameState.players),
        }));
        broadcast(JSON.stringify({
            type: 'chat',
            id: playerId,
            text: 'が退室しました',
        }));

        // もし退室したプレイヤーが現在のターンプレイヤーだった場合、ターンを進める
        if (gameState.gameStarted && gameState.turnOrder[gameState.currentTurnIndex] === playerId) {
            console.log(`現在のターンプレイヤー ${playerId} が退室しました。ターンを強制的に進めます。`);
            // 退室したプレイヤーのアクションとして'player_disconnected'を渡し、次のターンへ
            advanceGamePhaseAndTurn(playerId, 'player_disconnected');
        }
    });

    ws.on('error', (error) => {
        console.error('WebSocket Error:', error);
    });
});

//ひらがな　一文字を選ぶ関数(カワグチ)
function getRandomHiragana() {
    const hira = 'あいうえおかきくけこさしすせそたちつてとなにぬねのはひふへほまみむめもやゆよらりるれろわをん';
    return hira[Math.floor(Math.random() * hira.length)];
}

app.listen(port, () => {
    console.log(`Server is running on http://localhost:${port}`);
});