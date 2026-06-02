const rooms = new Map();

function getOrCreatePublicRoom() {
  const id = 'public';
  if (!rooms.has(id)) {
    rooms.set(id, { id, type: 'public', code: null, players: new Map() });
  }
  return rooms.get(id);
}

function getOrCreatePrivateRoom(code) {
  const id = `private:${code.toUpperCase()}`;
  if (!rooms.has(id)) {
    rooms.set(id, { id, type: 'private', code: code.toUpperCase(), players: new Map() });
  }
  return rooms.get(id);
}

function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

module.exports = {
  rooms,
  getOrCreatePublicRoom,
  getOrCreatePrivateRoom,
  generateRoomCode,
};
