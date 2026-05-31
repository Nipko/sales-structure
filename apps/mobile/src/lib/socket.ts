import { io, Socket } from 'socket.io-client';
import { SOCKET_URL } from './config';
import { tokens } from './api';

let socket: Socket | null = null;

/** Connect to the /inbox namespace with the current JWT (mirrors the dashboard). */
export async function connectSocket(): Promise<Socket> {
    if (socket?.connected) return socket;
    const { access } = await tokens.get();
    socket = io(`${SOCKET_URL}/inbox`, {
        auth: { token: access },
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionDelay: 1500,
    });
    return socket;
}

export function getSocket(): Socket | null {
    return socket;
}

export function disconnectSocket() {
    socket?.disconnect();
    socket = null;
}
