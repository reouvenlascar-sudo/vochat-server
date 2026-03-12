const WebSocket = require('ws');
const http = require('http');

const PORT = process.env.PORT || 3001;
const server = http.createServer((req, res) => {
  res.writeHead(200); res.end('VoChat Signaling Server OK');
});
const wss = new WebSocket.Server({ server });

// rooms: { roomId: { userId: { ws, name, color, vcChannel } } }
const rooms = {};

function broadcast(roomId, data, excludeId = null) {
  if (!rooms[roomId]) return;
  const msg = JSON.stringify(data);
  Object.entries(rooms[roomId]).forEach(([uid, peer]) => {
    if (uid !== excludeId && peer.ws.readyState === WebSocket.OPEN) {
      peer.ws.send(msg);
    }
  });
}

function send(ws, data) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(data));
}

wss.on('connection', (ws) => {
  let userId = null, roomId = null;

  ws.on('message', (raw) => {
    let d;
    try { d = JSON.parse(raw); } catch { return; }

    switch (d.type) {

      case 'join': {
        userId = d.id;
        roomId = d.room;
        if (!rooms[roomId]) rooms[roomId] = {};

        // Send existing members to new user
        const existing = Object.entries(rooms[roomId]).map(([uid, p]) => ({
          id: uid, name: p.name, color: p.color, vcChannel: p.vcChannel
        }));
        send(ws, { type: 'room_state', members: existing });

        // Add to room
        rooms[roomId][userId] = { ws, name: d.name, color: d.color, vcChannel: null };

        // Announce join to others
        broadcast(roomId, { type: 'join', id: userId, name: d.name, color: d.color }, userId);
        break;
      }

      case 'chat': {
        broadcast(roomId, { type: 'chat', id: userId, name: d.name, color: d.color, text: d.text, time: d.time, channel: d.channel }, userId);
        break;
      }

      case 'voice_join': {
        if (rooms[roomId]?.[userId]) rooms[roomId][userId].vcChannel = d.vcChannel;
        broadcast(roomId, { type: 'voice_join', id: userId, name: d.name, vcChannel: d.vcChannel }, userId);
        // Trigger WebRTC offer from existing voice members
        Object.entries(rooms[roomId]).forEach(([uid, peer]) => {
          if (uid !== userId && peer.vcChannel === d.vcChannel) {
            send(peer.ws, { type: 'peer_joined_voice', peerId: userId });
          }
        });
        break;
      }

      case 'voice_leave': {
        if (rooms[roomId]?.[userId]) rooms[roomId][userId].vcChannel = null;
        broadcast(roomId, { type: 'voice_leave', id: userId, name: d.name, vcChannel: d.vcChannel }, userId);
        break;
      }

      case 'speaking': {
        broadcast(roomId, { type: 'speaking', id: userId, speaking: d.speaking }, userId);
        break;
      }

      // WebRTC relay
      case 'offer':
      case 'answer':
      case 'ice': {
        const target = rooms[roomId]?.[d.target];
        if (target) send(target.ws, { ...d, id: userId });
        break;
      }
    }
  });

  ws.on('close', () => {
    if (!roomId || !userId || !rooms[roomId]) return;
    const peer = rooms[roomId][userId];
    broadcast(roomId, { type: 'leave', id: userId, name: peer?.name }, userId);
    delete rooms[roomId][userId];
    if (Object.keys(rooms[roomId]).length === 0) delete rooms[roomId];
  });
});

server.listen(PORT, () => console.log(`VoChat server running on port ${PORT}`));
