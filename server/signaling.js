import { WebSocketServer } from 'ws';
import { v4 as uuidv4 } from 'uuid';

const rooms = new Map(); // roomId -> Set of peers
const peerData = new Map(); // peerId -> { roomId, ws }

export function setupSignalingServer(server) {
    const wss = new WebSocketServer({ server });

    wss.on('connection', (ws) => {
        const peerId = uuidv4();
        console.log(`New peer connected: ${peerId}`);

        ws.on('message', (message) => {
            try {
                const data = JSON.parse(message);
                handleMessage(ws, peerId, data);
            } catch (error) {
                console.error('Error parsing message:', error);
            }
        });

        ws.on('close', () => {
            handleDisconnect(peerId);
        });
    });

    function handleMessage(ws, peerId, data) {
        switch (data.type) {
            case 'join':
                handleJoin(ws, peerId, data.roomId);
                break;
            case 'offer':
            case 'answer':
            case 'candidate':
            case 'message':
                forwardMessage(peerId, data);
                break;
            default:
                console.warn('Unknown message type:', data.type);
        }
    }

    function handleJoin(ws, peerId, roomId) {
        // Initialize room if it doesn't exist
        if (!rooms.has(roomId)) {
            rooms.set(roomId, new Set());
        }

        // Add peer to room
        rooms.get(roomId).add(peerId);
        peerData.set(peerId, { roomId, ws });

        // Notify others in the room
        const peersInRoom = Array.from(rooms.get(roomId)).filter(id => id !== peerId);
        ws.send(JSON.stringify({
            type: 'peers',
            peers: peersInRoom
        }));

        console.log(`Peer ${peerId} joined room ${roomId}`);
    }

    function forwardMessage(senderId, message) {
        const senderData = peerData.get(senderId);
        if (!senderData) return;

        const { roomId } = senderData;
        const peersInRoom = rooms.get(roomId);

        if (!peersInRoom) return;

        // Add sender info to the message
        message.sender = senderId;

        // Send to all peers in room except sender
        peersInRoom.forEach(peerId => {
            if (peerId !== senderId) {
                const peer = peerData.get(peerId);
                if (peer && peer.ws.readyState === peer.ws.OPEN) {
                    peer.ws.send(JSON.stringify(message));
                }
            }
        });
    }

    function handleDisconnect(peerId) {
        const data = peerData.get(peerId);
        if (!data) return;

        const { roomId } = data;
        peerData.delete(peerId);

        if (rooms.has(roomId)) {
            const room = rooms.get(roomId);
            room.delete(peerId);

            // Notify remaining peers about the disconnect
            room.forEach(remainingPeerId => {
                const peer = peerData.get(remainingPeerId);
                if (peer && peer.ws.readyState === peer.ws.OPEN) {
                    peer.ws.send(JSON.stringify({
                        type: 'peer-disconnected',
                        peerId
                    }));
                }
            });

            // Clean up empty rooms
            if (room.size === 0) {
                rooms.delete(roomId);
            }
        }

        console.log(`Peer ${peerId} disconnected`);
    }
}