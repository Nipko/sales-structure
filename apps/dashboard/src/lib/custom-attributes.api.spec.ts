import { api } from './api';

const fetchMock = jest.fn();
const originalFetch = global.fetch;
const response = (data: unknown, status = 200) => ({ ok: status < 400, status, json: async () => data });

beforeEach(() => { fetchMock.mockReset(); global.fetch = fetchMock; });
afterAll(() => { global.fetch = originalFetch; });

it('sends the actual settings form fields as the service create DTO', async () => {
    fetchMock.mockResolvedValue(response({ success: true, data: { id: 'attribute-1' } }));
    await api.createCustomAttribute('tenant-1', {
        entity_type: 'contact', attribute_key: 'qa_preference', label: 'QA preference',
        data_type: 'text', is_required: false, options: null,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/crm\/custom-attributes\/tenant-1$/);
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ entityType: 'contact', attributeKey: 'qa_preference',
        attributeLabel: 'QA preference', attributeType: 'text', required: false, options: null });
});

it('adapts database definitions for settings and Inbox while retaining canonical fields', async () => {
    const row = { id: 'attribute-1', entity_type: 'contact', attribute_key: 'qa_preference',
        attribute_label: 'QA preference', attribute_type: 'list', required: true, options: ['A', 'B'] };
    fetchMock.mockResolvedValue(response({ success: true, data: [row] }));
    const res = await api.getCustomAttributes('tenant-1', 'contact');
    expect(res.data).toEqual([{ ...row, key: 'qa_preference', label: 'QA preference', data_type: 'list', is_required: true }]);
});

it('sends edits including false required and list options without dropping values', async () => {
    fetchMock.mockResolvedValue(response({ success: true, data: {} }));
    await api.updateCustomAttribute('tenant-1', 'attribute-1', { label: 'Changed', data_type: 'list',
        options: ['A', 'B'], is_required: false });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/crm\/custom-attributes\/tenant-1\/attribute-1$/);
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body)).toEqual({ attributeLabel: 'Changed', attributeType: 'list', options: ['A', 'B'], required: false });
});

it('keeps a failed definitions response failed instead of substituting an empty success', async () => {
    fetchMock.mockResolvedValue(response({ message: 'Unavailable' }, 503));
    expect(await api.getCustomAttributes('tenant-1')).toMatchObject({ success: false, httpStatus: 503, error: 'Unavailable' });
});

it('preserves canonical camelCase input and optional patch semantics', async () => {
    fetchMock.mockResolvedValue(response({ success: true, data: {} }));
    await api.updateCustomAttribute('tenant-1', 'attribute-1', { attributeLabel: 'Canonical', required: false });
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ attributeLabel: 'Canonical', required: false });
});
