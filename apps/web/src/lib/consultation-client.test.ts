import { afterEach, describe, expect, it, vi } from 'vitest';
import { consultationClient } from './consultation-client';

function stubFetch(body: unknown = {}, status = 200) {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function lastCall(fetchMock: ReturnType<typeof vi.fn>) {
  const [url, init] = fetchMock.mock.calls.at(-1) as [string, RequestInit];
  return {
    url,
    method: init.method ?? 'GET',
    body: init.body ? JSON.parse(String(init.body)) : undefined,
    auth: (init.headers as Record<string, string>).Authorization,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('consultationClient', () => {
  it('books with the documented payload and bearer token', async () => {
    const fetchMock = stubFetch({ id: 'c1' }, 201);
    await consultationClient.create(
      {
        advocate_profile_id: 'adv-1',
        practice_area: 'CONTRACT_LAW',
        topic: 'Vendor contract',
        description: 'Termination clause',
        mode: 'VIDEO',
      },
      'tok',
    );
    const call = lastCall(fetchMock);
    expect(call.url).toMatch(/\/api\/v1\/consultations$/);
    expect(call.method).toBe('POST');
    expect(call.auth).toBe('Bearer tok');
    expect(call.body).toMatchObject({ advocate_profile_id: 'adv-1', mode: 'VIDEO' });
  });

  it('filters the list by status only when one is given', async () => {
    const fetchMock = stubFetch({ items: [], total: 0, limit: 25, offset: 0 });
    await consultationClient.listMine('tok');
    expect(lastCall(fetchMock).url).toMatch(/\/api\/v1\/consultations$/);
    await consultationClient.listMine('tok', 'ACCEPTED');
    expect(lastCall(fetchMock).url).toMatch(/\/api\/v1\/consultations\?status=ACCEPTED$/);
  });

  it('starts checkout and forwards the gateway result for server-side verification', async () => {
    const fetchMock = stubFetch({});
    await consultationClient.createPaymentOrder('c1', 'tok');
    expect(lastCall(fetchMock)).toMatchObject({
      method: 'POST',
      auth: 'Bearer tok',
    });
    expect(lastCall(fetchMock).url).toMatch(/\/consultations\/c1\/payment\/order$/);

    await consultationClient.verifyPayment(
      'c1',
      { payment_id: 'p1', gateway_payment_id: 'pay_1', signature: 'sig' },
      'tok',
    );
    const verify = lastCall(fetchMock);
    expect(verify.url).toMatch(/\/consultations\/c1\/payment\/verify$/);
    expect(verify.body).toEqual({
      payment_id: 'p1',
      gateway_payment_id: 'pay_1',
      signature: 'sig',
    });
  });

  it('surfaces the API error envelope (e.g. payments not configured)', async () => {
    stubFetch(
      {
        error: {
          code: 'payments_not_configured',
          message: "Payments aren't configured yet.",
          request_id: 'r1',
        },
      },
      503,
    );
    await expect(consultationClient.createPaymentOrder('c1', 'tok')).rejects.toMatchObject({
      status: 503,
      code: 'payments_not_configured',
    });
  });
});
