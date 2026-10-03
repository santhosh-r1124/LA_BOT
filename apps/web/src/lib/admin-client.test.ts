import { afterEach, describe, expect, it, vi } from 'vitest';
import { adminClient } from './admin-client';
import { notificationClient } from './notification-client';

function stubFetch() {
  const fetchMock = vi.fn().mockImplementation(
    async () =>
      new Response(JSON.stringify({ items: [], total: 0, limit: 25, offset: 0 }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

const urlOf = (fetchMock: ReturnType<typeof vi.fn>) => String(fetchMock.mock.calls.at(-1)?.[0]);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('adminClient', () => {
  it('omits empty filters from the query string', async () => {
    const fetchMock = stubFetch();
    await adminClient.users('tok', { role: '', offset: 0 });
    expect(urlOf(fetchMock)).toMatch(/\/api\/v1\/admin\/users\?offset=0&limit=25$/);
    await adminClient.catalog('tok', { status: 'NEW', provider: undefined });
    expect(urlOf(fetchMock)).toMatch(/\/catalog\?status=NEW&limit=25$/);
  });

  it('sends each discovery provider as a repeated query parameter', async () => {
    const fetchMock = stubFetch();
    await adminClient.discover('tok', ['curated', 'hf_dataset']);
    expect(urlOf(fetchMock)).toMatch(/\/discover\?providers=curated&providers=hf_dataset$/);
  });

  it('sends a null amount for a full refund', async () => {
    const fetchMock = stubFetch();
    await adminClient.refund('tok', 'pay-1');
    const init = fetchMock.mock.calls.at(-1)?.[1] as RequestInit;
    expect(JSON.parse(String(init.body))).toEqual({ amount: null });
  });

  it('asks for unreviewed risk items unless told otherwise', async () => {
    const fetchMock = stubFetch();
    await adminClient.riskQueue('tok');
    expect(urlOf(fetchMock)).toMatch(/\/admin\/risk-review\?limit=25$/);
    await adminClient.riskQueue('tok', { reviewed: true });
    expect(urlOf(fetchMock)).toMatch(/reviewed=true/);
  });
});

describe('notificationClient', () => {
  it('reads the unread count and marks items read', async () => {
    const fetchMock = stubFetch();
    await notificationClient.unreadCount('tok');
    expect(urlOf(fetchMock)).toMatch(/\/api\/v1\/notifications\/unread-count$/);
    await notificationClient.markRead('n1', 'tok');
    expect(urlOf(fetchMock)).toMatch(/\/notifications\/n1\/read$/);
    expect((fetchMock.mock.calls.at(-1)?.[1] as RequestInit).method).toBe('POST');
  });
});
