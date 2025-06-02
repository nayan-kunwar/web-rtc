class WebRTCClient {
    constructor() {
        this.peerId = null;
        this.roomId = null;
        this.peers = new Map(); // peerId -> RTCPeerConnection
        this.localStream = null;
        this.remoteStreams = new Map(); // peerId -> MediaStream
        
        // DOM elements
        this.localVideo = document.getElementById('localVideo');
        this.remoteVideo = document.getElementById('remoteVideo');
        this.roomIdInput = document.getElementById('roomId');
        this.joinBtn = document.getElementById('joinBtn');
        this.leaveBtn = document.getElementById('leaveBtn');
        this.messageInput = document.getElementById('messageInput');
        this.sendBtn = document.getElementById('sendBtn');
        this.messagesDiv = document.getElementById('messages');
        
        // Initialize WebSocket
        this.socket = new WebSocket(`ws://${window.location.host}`);
        
        // Event listeners
        this.setupEventListeners();
        this.setupSocketEvents();
    }
    
    setupEventListeners() {
        this.joinBtn.addEventListener('click', () => this.joinRoom());
        this.leaveBtn.addEventListener('click', () => this.leaveRoom());
        this.sendBtn.addEventListener('click', () => this.sendMessage());
        this.messageInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') this.sendMessage();
        });
    }
    
    setupSocketEvents() {
        this.socket.onopen = () => {
            console.log('Connected to signaling server');
        };
        
        this.socket.onmessage = async (event) => {
            const data = JSON.parse(event.data);
            
            switch (data.type) {
                case 'peers':
                    this.handlePeers(data.peers);
                    break;
                case 'offer':
                    await this.handleOffer(data.sender, data.offer);
                    break;
                case 'answer':
                    await this.handleAnswer(data.sender, data.answer);
                    break;
                case 'candidate':
                    await this.handleCandidate(data.sender, data.candidate);
                    break;
                case 'peer-disconnected':
                    this.handlePeerDisconnected(data.peerId);
                    break;
                case 'message':
                    this.displayMessage(data.sender, data.message, false);
                    break;
                default:
                    console.warn('Unknown message type:', data.type);
            }
        };
        
        this.socket.onclose = () => {
            console.log('Disconnected from signaling server');
        };
    }
    
    async joinRoom() {
        this.roomId = this.roomIdInput.value.trim();
        if (!this.roomId) return;
        
        try {
            // Get local media stream
            this.localStream = await navigator.mediaDevices.getUserMedia({
                video: true,
                audio: true
            });
            this.localVideo.srcObject = this.localStream;
            
            // Notify server we're joining a room
            this.socket.send(JSON.stringify({
                type: 'join',
                roomId: this.roomId
            }));
            
            // Update UI
            this.joinBtn.disabled = true;
            this.leaveBtn.disabled = false;
            this.roomIdInput.disabled = true;
            
            console.log(`Joined room: ${this.roomId}`);
        } catch (error) {
            console.error('Error joining room:', error);
            alert('Could not access media devices. Please check permissions.');
        }
    }
    
    leaveRoom() {
        // Close all peer connections
        this.peers.forEach((pc, peerId) => {
            this.closePeerConnection(peerId);
        });
        this.peers.clear();
        this.remoteStreams.clear();
        
        // Stop local stream
        if (this.localStream) {
            this.localStream.getTracks().forEach(track => track.stop());
            this.localStream = null;
            this.localVideo.srcObject = null;
        }
        
        // Clear remote video
        this.remoteVideo.srcObject = null;
        
        // Notify server we're leaving
        if (this.roomId) {
            this.socket.send(JSON.stringify({
                type: 'leave',
                roomId: this.roomId
            }));
        }
        
        // Update UI
        this.joinBtn.disabled = false;
        this.leaveBtn.disabled = true;
        this.roomIdInput.disabled = false;
        
        console.log(`Left room: ${this.roomId}`);
        this.roomId = null;
    }
    
    handlePeers(peerIds) {
        peerIds.forEach(peerId => this.createPeerConnection(peerId));
    }
    
    createPeerConnection(peerId) {
        if (this.peers.has(peerId)) return;
        
        const pc = new RTCPeerConnection({
            iceServers: [
                { urls: 'stun:stun.l.google.com:19302' },
                // Add your own TURN servers here if needed
            ]
        });
        
        // Add local stream to connection
        if (this.localStream) {
            this.localStream.getTracks().forEach(track => {
                pc.addTrack(track, this.localStream);
            });
        }
        
        // Handle ICE candidates
        pc.onicecandidate = (event) => {
            if (event.candidate) {
                this.socket.send(JSON.stringify({
                    type: 'candidate',
                    recipient: peerId,
                    candidate: event.candidate
                }));
            }
        };
        
        // Handle remote stream
        pc.ontrack = (event) => {
            const remoteStream = event.streams[0];
            this.remoteStreams.set(peerId, remoteStream);
            
            // For simplicity, we'll just show the most recent remote stream
            this.remoteVideo.srcObject = remoteStream;
        };
        
        pc.oniceconnectionstatechange = () => {
            if (pc.iceConnectionState === 'disconnected' || 
                pc.iceConnectionState === 'failed') {
                this.closePeerConnection(peerId);
            }
        };
        
        this.peers.set(peerId, pc);
        
        // If we're the new peer, create an offer
        if (this.localStream) {
            this.createOffer(peerId);
        }
    }
    
    async createOffer(peerId) {
        const pc = this.peers.get(peerId);
        if (!pc) return;
        
        try {
            const offer = await pc.createOffer();
            await pc.setLocalDescription(offer);
            
            this.socket.send(JSON.stringify({
                type: 'offer',
                recipient: peerId,
                offer: offer
            }));
        } catch (error) {
            console.error('Error creating offer:', error);
        }
    }
    
    async handleOffer(senderId, offer) {
        const pc = this.peers.get(senderId) || this.createPeerConnection(senderId);
        
        try {
            await pc.setRemoteDescription(new RTCSessionDescription(offer));
            const answer = await pc.createAnswer();
            await pc.setLocalDescription(answer);
            
            this.socket.send(JSON.stringify({
                type: 'answer',
                recipient: senderId,
                answer: answer
            }));
        } catch (error) {
            console.error('Error handling offer:', error);
        }
    }
    
    async handleAnswer(senderId, answer) {
        const pc = this.peers.get(senderId);
        if (!pc) return;
        
        try {
            await pc.setRemoteDescription(new RTCSessionDescription(answer));
        } catch (error) {
            console.error('Error handling answer:', error);
        }
    }
    
    async handleCandidate(senderId, candidate) {
        const pc = this.peers.get(senderId);
        if (!pc) return;
        
        try {
            await pc.addIceCandidate(new RTCIceCandidate(candidate));
        } catch (error) {
            console.error('Error adding ICE candidate:', error);
        }
    }
    
    handlePeerDisconnected(peerId) {
        this.closePeerConnection(peerId);
        this.remoteStreams.delete(peerId);
        
        // If the disconnected peer was the one we were displaying
        if (this.remoteVideo.srcObject === this.remoteStreams.get(peerId)) {
            this.remoteVideo.srcObject = null;
        }
    }
    
    closePeerConnection(peerId) {
        const pc = this.peers.get(peerId);
        if (pc) {
            pc.close();
            this.peers.delete(peerId);
        }
    }
    
    sendMessage() {
        const message = this.messageInput.value.trim();
        if (!message || !this.roomId) return;
        
        this.socket.send(JSON.stringify({
            type: 'message',
            message: message
        }));
        
        this.displayMessage('You', message, true);
        this.messageInput.value = '';
    }
    
    displayMessage(sender, message, isLocal) {
        const messageElement = document.createElement('div');
        messageElement.className = isLocal ? 'message local' : 'message remote';
        messageElement.textContent = `${sender}: ${message}`;
        this.messagesDiv.appendChild(messageElement);
        this.messagesDiv.scrollTop = this.messagesDiv.scrollHeight;
    }
}

// Initialize the client when the page loads
window.addEventListener('DOMContentLoaded', () => {
    new WebRTCClient();
});