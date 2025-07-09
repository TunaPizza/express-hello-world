const express = require('express');
const expressWs = require('express-ws');

const app = express();
expressWs(app);

const port = process.env.PORT || 3001;
let connects = [];

app.use(express.static('public'));

function broadcast(msg) {
  const json = JSON.stringify(msg);
  connects.forEach((socket) => {
    if (socket.readyState === 1) {
      socket.send(json);
    }
  });
}

app.ws('/ws', (ws, req) => {
  connects.push(ws);

  ws.on('message', (message) => {
    let data;
    try {
      data = JSON.parse(message);
    } catch (e) {
      return;
    }

    if (data.type === 'join') {
      // 入室メッセージを全員に通知
      broadcast(data);
      return;
    }

    // paint/chatなどはそのままbroadcast
    broadcast(data);
  });

  ws.on('close', () => {
    connects = connects.filter((conn) => conn !== ws);
  });
});

app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});
