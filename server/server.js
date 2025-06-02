import express from 'express';
import { createServer } from 'http';
import { config } from './config.js';
import { setupSignalingServer } from './signaling.js';
import path from 'path';
import { fileURLToPath } from 'url';
import cors from 'cors';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

// Middleware
app.use(cors());
app.use(express.static(path.join(__dirname, '../public')));

// Create HTTP server
const server = createServer(app);

// Setup WebSocket signaling
setupSignalingServer(server);

// Start server
server.listen(config.PORT, () => {
    console.log(`Server running on http://localhost:${config.PORT}`);
});