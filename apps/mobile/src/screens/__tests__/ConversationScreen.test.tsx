import React from 'react';
import { Alert } from 'react-native';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { ConversationScreen } from '../ConversationScreen';
import { api } from '../../lib/api';
import { enqueue, setOutboxConversationAccess } from '../../lib/outbox';

function mockSocket() {
    const listeners = new Map<string, Set<(payload?: any) => void>>();
    return {
        connected: true, emit: jest.fn(),
        on: (name: string, fn: any) => { if (!listeners.has(name)) listeners.set(name, new Set()); listeners.get(name)!.add(fn); },
        off: (name: string, fn: any) => listeners.get(name)?.delete(fn),
        trigger: (name: string, payload?: any) => listeners.get(name)?.forEach((fn) => fn(payload)),
        clear: () => listeners.clear(),
    };
}
const mockInbox = mockSocket(), mockAgent = mockSocket();
const mockReadyListeners = new Set<() => void>();
const mockCancelRecording = jest.fn();
jest.mock('../../lib/socket', () => ({
    getInboxSocket: () => mockInbox, getAgentSocket: () => mockAgent,
    onAgentReady: (fn: () => void) => { mockReadyListeners.add(fn); return () => mockReadyListeners.delete(fn); },
}));
jest.mock('../../lib/api', () => ({
    requireApiSuccess: jest.requireActual('../../lib/api').requireApiSuccess,
    api: { getConversation: jest.fn(), getCannedResponses: jest.fn(), getMacros: jest.fn(), sendMessage: jest.fn(), uploadMedia: jest.fn(), sendMediaMessage: jest.fn() },
}));
jest.mock('../../lib/outbox', () => ({
    enqueue: jest.fn(() => true), pendingFor: jest.fn(() => []), retry: jest.fn(),
    subscribeOutbox: jest.fn(() => () => {}), setOutboxConversationAccess: jest.fn(),
}));
jest.mock('../../contexts/AuthContext', () => ({ useAuth: () => ({ tenantId: 'tenant', user: { id: 'me', role: 'tenant_agent' } }) }));
jest.mock('@react-navigation/native', () => ({ useRoute: () => ({ params: { conversationId: 'thread' } }), useNavigation: () => ({ goBack: jest.fn() }) }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('expo-image-picker', () => ({
    requestMediaLibraryPermissionsAsync: jest.fn(async () => ({ granted: true })),
    launchImageLibraryAsync: jest.fn(async () => ({ canceled: false, assets: [{ uri: 'file:///image.jpg', fileName: 'image.jpg', mimeType: 'image/jpeg' }] })),
}));
jest.mock('react-native-safe-area-context', () => ({ useSafeAreaInsets: () => ({ top: 0, right: 0, bottom: 0, left: 0 }) }));
jest.mock('../../components/Toast', () => ({ useToast: () => ({ success: jest.fn(), error: jest.fn(), info: jest.fn() }) }));
jest.mock('../../components/AppModal', () => ({ Modal: ({ visible, children }: any) => visible ? children : null }));
jest.mock('../../components/AudioPlayer', () => ({ AudioPlayer: () => null }));
jest.mock('../../lib/useKeyboardSpace', () => ({ useKeyboardSpace: () => 0 }));
jest.mock('../../lib/useAudioRecorder', () => ({ useAudioRecorder: () => ({ state: 'idle', durationMs: 0, cancelRecording: mockCancelRecording }), fmtDuration: () => '' }));
jest.mock('../../lib/haptics', () => ({ haptic: { success: jest.fn(), warning: jest.fn() } }));
jest.mock('../../i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));

const conversation = (content = 'Private transcript') => ({ success: true, data: {
    id: 'thread', status: 'with_human', assignedAgentId: 'me',
    messages: [{ id: 'message', sender: 'inbound', content, timestamp: '2026-09-14T10:00:00Z' }],
    notes: [{ id: 'note', content: 'Private note' }], hasMore: false,
} });
const refresh = async () => { await act(async () => { mockAgent.trigger('inbox:refresh'); }); };

describe('open mobile conversation stays authorized and current', () => {
    beforeEach(() => {
        jest.clearAllMocks(); mockInbox.clear(); mockAgent.clear(); mockReadyListeners.clear();
        (api.getConversation as jest.Mock).mockResolvedValue(conversation());
        (api.getCannedResponses as jest.Mock).mockResolvedValue({ success: true, data: [] });
        (api.getMacros as jest.Mock).mockResolvedValue({ success: true, data: [] });
    });

    it('refreshes the open thread on inbox invalidation and its conversation update, ignoring another thread', async () => {
        const view = render(<ConversationScreen />);
        await view.findByText('Private transcript');
        const count = (api.getConversation as jest.Mock).mock.calls.length;
        await act(async () => { mockInbox.trigger('conversationUpdated', { id: 'another-thread' }); });
        expect(api.getConversation).toHaveBeenCalledTimes(count);
        (api.getConversation as jest.Mock).mockResolvedValue(conversation('Assignment changed'));
        await refresh(); await view.findByText('Assignment changed');
        (api.getConversation as jest.Mock).mockResolvedValue(conversation('Resolved remotely'));
        await act(async () => { mockInbox.trigger('conversationUpdated', { id: 'thread' }); });
        await view.findByText('Resolved remotely');
    });

    it('preserves the transcript and composer on a transient network failure', async () => {
        const view = render(<ConversationScreen />);
        await view.findByText('Private transcript');
        (setOutboxConversationAccess as jest.Mock).mockClear();
        (api.getConversation as jest.Mock).mockResolvedValue({ success: false, error: 'network_error' });
        await refresh(); await view.findByText('common.loadError');
        expect(view.getByText('Private transcript')).toBeTruthy();
        expect(view.getByPlaceholderText('conv.composer')).toBeTruthy();
        expect(setOutboxConversationAccess).not.toHaveBeenCalledWith('thread', false);
    });

    it.each([403, 404])('removes transcript, private notes and sending controls after explicit HTTP %s', async (httpStatus) => {
        const view = render(<ConversationScreen />);
        await view.findByText('Private transcript');
        fireEvent.changeText(view.getByPlaceholderText('conv.composer'), 'Private draft');
        (api.getConversation as jest.Mock).mockResolvedValue({ success: false, httpStatus, error: 'unavailable' });
        await refresh(); await view.findByText('conv.accessUnavailable');
        expect(view.queryByText('Private transcript')).toBeNull();
        expect(view.queryByText('Private note')).toBeNull();
        expect(view.queryByPlaceholderText('conv.composer')).toBeNull();
        expect(view.queryByLabelText('conv.send')).toBeNull();
        expect(setOutboxConversationAccess).toHaveBeenCalledWith('thread', false);
        expect(api.sendMessage).not.toHaveBeenCalled();
        // Access can be rechecked explicitly; an old draft is never restored.
        (api.getConversation as jest.Mock).mockResolvedValue(conversation('Access restored'));
        fireEvent.press(view.getByLabelText('common.retry'));
        await view.findByText('Access restored');
        expect(view.getByPlaceholderText('conv.composer').props.value).toBe('');
    });

    it('does not restore private data from a slow response after a newer refresh denied access', async () => {
        const view = render(<ConversationScreen />);
        await view.findByText('Private transcript');
        let finish!: (value: any) => void;
        (api.getConversation as jest.Mock).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
        await refresh();
        (api.getConversation as jest.Mock).mockResolvedValue({ success: false, httpStatus: 403, error: 'forbidden' });
        await refresh(); await view.findByText('conv.accessUnavailable');
        await act(async () => { finish(conversation('Late private response')); });
        expect(view.queryByText('Late private response')).toBeNull();
        expect(view.getByText('conv.accessUnavailable')).toBeTruthy();
    });

    it('opens presence after confirmed agent join and restores it after reconnect', async () => {
        const view = render(<ConversationScreen />);
        await view.findByText('Private transcript');
        expect(mockAgent.emit).not.toHaveBeenCalledWith('conversation:open', expect.anything());
        await act(async () => { mockReadyListeners.forEach((fn) => fn()); });
        expect(mockAgent.emit).toHaveBeenCalledWith('conversation:open', { conversationId: 'thread' });
        expect(mockAgent.emit).toHaveBeenCalledWith('conversation:viewing_start', { conversationId: 'thread' });
        mockAgent.emit.mockClear();
        await act(async () => { mockAgent.trigger('disconnect'); mockReadyListeners.forEach((fn) => fn()); });
        expect(mockAgent.emit).toHaveBeenCalledWith('conversation:open', { conversationId: 'thread' });
        view.unmount();
        expect(mockAgent.emit).toHaveBeenCalledWith('conversation:viewing_stop', { conversationId: 'thread' });
        expect(mockReadyListeners.size).toBe(0);
    });

    it('retains the original send key when a network failure hands the message to the outbox', async () => {
        const view = render(<ConversationScreen />);
        await view.findByText('Private transcript');
        (api.sendMessage as jest.Mock).mockResolvedValue({ success: false, error: 'network_error' });
        fireEvent.changeText(view.getByPlaceholderText('conv.composer'), 'One reply');
        fireEvent.press(view.getByLabelText('conv.send'));
        await waitFor(() => expect(enqueue).toHaveBeenCalled());
        const key = (api.sendMessage as jest.Mock).mock.calls[0][3];
        expect(key).toMatch(/^tmp-/);
        expect(enqueue).toHaveBeenCalledWith({ id: key, tenantId: 'tenant', conversationId: 'thread', body: 'One reply', agentId: 'me' });
    });

    it('restores a denied write as a draft when the read-access recheck encounters a server failure', async () => {
        const view = render(<ConversationScreen />);
        await view.findByText('Private transcript');
        (api.sendMessage as jest.Mock).mockResolvedValue({ success: false, httpStatus: 403, error: 'not_claimed' });
        (api.getConversation as jest.Mock).mockResolvedValue({ success: false, httpStatus: 503, error: 'unavailable' });
        fireEvent.changeText(view.getByPlaceholderText('conv.composer'), 'Rejected reply');
        fireEvent.press(view.getByLabelText('conv.send'));
        await view.findByText('common.loadError');
        expect(view.getByPlaceholderText('conv.composer').props.value).toBe('Rejected reply');
        expect(view.queryByText('Rejected reply')).toBeNull();
        expect(enqueue).not.toHaveBeenCalled();
    });

    it('does not send an uploaded attachment if access was revoked while it uploaded', async () => {
        const view = render(<ConversationScreen />);
        await view.findByText('Private transcript');
        let finishUpload!: (value: any) => void;
        (api.uploadMedia as jest.Mock).mockImplementation(() => new Promise((resolve) => { finishUpload = resolve; }));
        const alert = jest.spyOn(Alert, 'alert');
        fireEvent.press(view.getByLabelText('conv.attach'));
        let attaching!: Promise<void>;
        await act(async () => { attaching = (alert.mock.calls[0][2]![1].onPress as any)(); });
        await waitFor(() => expect(api.uploadMedia).toHaveBeenCalled());
        (api.getConversation as jest.Mock).mockResolvedValue({ success: false, httpStatus: 403, error: 'forbidden' });
        await refresh(); await view.findByText('conv.accessUnavailable');
        await act(async () => { finishUpload({ success: true, data: { url: '/uploaded.jpg' } }); await attaching; });
        expect(api.sendMediaMessage).not.toHaveBeenCalled();
        alert.mockRestore();
    });
});
