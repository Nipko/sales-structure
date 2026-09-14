const mockSockets: any[] = [];
jest.mock('socket.io-client', () => ({ io: jest.fn((_url, options) => {
    const listeners = new Map<string, Set<(...args: any[]) => any>>();
    const socket: any = {
        options, connected: false, disconnected: true, id: 'connection-0',
        on: jest.fn((name, fn) => { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name)!.add(fn); return socket; }),
        emit: jest.fn(), connect: jest.fn(), disconnect: jest.fn(),
        trigger: async (name: string, ...args: any[]) => {
            if (name === 'connect') { socket.connected = true; socket.disconnected = false; socket.id += '-next'; }
            if (name === 'disconnect') { socket.connected = false; socket.disconnected = true; }
            await Promise.all([...(listeners.get(name) || [])].map((fn) => fn(...args)));
        },
    };
    mockSockets.push(socket);
    return socket;
}) }));
jest.mock('../api', () => ({ tokens: { get: jest.fn(), getUser: jest.fn() }, refreshAccessToken: jest.fn() }));
jest.mock('../config', () => ({ SOCKET_URL: 'https://socket.test' }));
jest.mock('../log', () => ({ log: jest.fn() }));
import { tokens, refreshAccessToken } from '../api';
import { disconnectSocket, getAgentSocket, getInboxSocket, onAgentReady } from '../socket';

const tick = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };
describe('mobile realtime connection lifecycle', () => {
    beforeEach(() => {
        jest.useFakeTimers();
        disconnectSocket();
        jest.clearAllMocks();
        mockSockets.length = 0;
        (tokens.get as jest.Mock).mockResolvedValue({ access: 'token-1' });
        (tokens.getUser as jest.Mock).mockResolvedValue({ id: 'agent-1', tenantId: 'tenant-1' });
        (refreshAccessToken as jest.Mock).mockResolvedValue('token-2');
    });
    afterEach(() => { disconnectSocket(); jest.useRealTimers(); });

    it('confirms agent join before restoring presence, on every connection', async () => {
        const agent = getAgentSocket() as any;
        const ready = jest.fn();
        const stop = onAgentReady(ready);
        await agent.trigger('connect');
        expect(agent.emit).toHaveBeenCalledWith('agent:join', { agentId: 'agent-1', tenantId: 'tenant-1' });
        expect(ready).not.toHaveBeenCalled();
        await agent.trigger('inbox:update', []);
        expect(ready).toHaveBeenCalledTimes(1);
        await agent.trigger('inbox:update', []);
        expect(ready).toHaveBeenCalledTimes(1);
        await agent.trigger('disconnect', 'transport close');
        await agent.trigger('connect');
        expect(agent.emit).toHaveBeenCalledTimes(2);
        expect(ready).toHaveBeenCalledTimes(1);
        await agent.trigger('inbox:update', []);
        expect(ready).toHaveBeenCalledTimes(2);
        stop();
        const alreadyReady = jest.fn();
        onAgentReady(alreadyReady)();
        expect(alreadyReady).toHaveBeenCalledTimes(1);
    });

    it('reads the rotated token for each handshake and withholds a token read completing after logout', async () => {
        const socket = getInboxSocket() as any;
        const auth = jest.fn();
        socket.options.auth(auth); await tick();
        expect(auth).toHaveBeenLastCalledWith({ token: 'token-1' });
        (tokens.get as jest.Mock).mockResolvedValue({ access: 'token-2' });
        socket.options.auth(auth); await tick();
        expect(auth).toHaveBeenLastCalledWith({ token: 'token-2' });
        let resolveToken!: (value: any) => void;
        (tokens.get as jest.Mock).mockImplementation(() => new Promise((resolve) => { resolveToken = resolve; }));
        socket.options.auth(auth);
        disconnectSocket();
        resolveToken({ access: 'old-account-token' }); await tick();
        expect(auth).toHaveBeenLastCalledWith({});
    });

    it('waits for one shared refresh before reconnecting server-disconnected namespaces', async () => {
        let finishRefresh!: () => void;
        (refreshAccessToken as jest.Mock).mockImplementation(() => new Promise<void>((resolve) => { finishRefresh = resolve; }));
        const inbox = getInboxSocket() as any;
        const agent = getAgentSocket() as any;
        await inbox.trigger('disconnect', 'io server disconnect');
        await agent.trigger('disconnect', 'io server disconnect');
        expect(refreshAccessToken).toHaveBeenCalledTimes(1);
        jest.advanceTimersByTime(5000);
        expect(inbox.connect).not.toHaveBeenCalled();
        finishRefresh(); await tick();
        jest.advanceTimersByTime(1500);
        expect(inbox.connect).toHaveBeenCalledTimes(1);
        expect(agent.connect).toHaveBeenCalledTimes(1);
    });

    it('does not reconnect either an old socket or the next account when logout interrupts refresh', async () => {
        let finishRefresh!: () => void;
        (refreshAccessToken as jest.Mock).mockImplementation(() => new Promise<void>((resolve) => { finishRefresh = resolve; }));
        const old = getAgentSocket() as any;
        const oldReady = jest.fn(); onAgentReady(oldReady);
        await old.trigger('disconnect', 'io server disconnect');
        disconnectSocket();
        const next = getAgentSocket() as any;
        finishRefresh(); await tick(); jest.advanceTimersByTime(5000);
        expect(old.connect).not.toHaveBeenCalled();
        expect(next.connect).not.toHaveBeenCalled();
        await next.trigger('connect'); await next.trigger('inbox:update', []);
        expect(oldReady).not.toHaveBeenCalled();
    });

    it('ignores an old pending user lookup instead of joining it on a new session socket', async () => {
        let finishUser!: (value: any) => void;
        (tokens.getUser as jest.Mock).mockImplementation(() => new Promise((resolve) => { finishUser = resolve; }));
        const old = getAgentSocket() as any;
        const joining = old.trigger('connect');
        disconnectSocket();
        const next = getAgentSocket() as any;
        finishUser({ id: 'old-agent', tenantId: 'old-tenant' }); await joining;
        expect(old.emit).not.toHaveBeenCalled();
        expect(next.emit).not.toHaveBeenCalled();
    });
});
