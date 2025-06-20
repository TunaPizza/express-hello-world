const express = require('express')
const expressWs = require('express-ws')

const app = express()
expressWs(app)

const port = process.env.PORT || 3001
let connects = []

app.use(express.static('public'))

app.ws('/ws', (ws, req) => {
  connects.push(ws)

  ws.on('message', (message) => {
    console.log('Received:', message)
    let data

    try {
      data = JSON.parse(message)
    } catch (e) {
      console.error('Invalid JSON:', message)
      return
    }

    // type が "chat" のときだけ text を加工する
    if (data.type === 'chat' && typeof data.text === 'string') {
      data.text += '♡'
    }

    const addmessage = JSON.stringify(data)

    connects.forEach((socket) => {
      if (socket.readyState === 1) {
        socket.send(addmessage)
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
