import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiRequestError } from './api-client';
import { parseSseFrames, streamMessage } from './chat-client';

/** A Response whose body arrives in the given chunks (split mid-frame on purpose). */
function sseResponse(chunks: string[], status = 200): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(encoder.encode(c));
      controller.close();
    },
  });
  return new Response(body, { status, headers: { 'Content-Type': 'text/event-stream' } });
}

const frame = (event: string, data: unknown) =>
  `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

afterEach(() => {
  vi.restoreAllMocks();
});

describe('parseSseFrames', () => {
  it('returns complete frames and keeps the partial remainder', () => {
    const { frames, rest } = parseSseFrames('event: delta\ndata: {"text":"a"}\n\nevent: del');
    expect(frames).toEqual([{ event: 'delta', data: '{"text":"a"}' }]);
    expect(rest).toBe('event: del');
  });
});

describe('streamMessage', () => {
  it('reports start + deltas and resolves with the done payload', async () => {
    const done = { conversation_id: 'c1', disclaimer: 'd' };
    const all =
      frame('start', { conversation_id: 'c1', sources: [] }) +
      frame('delta', { text: 'Hel' }) +
      frame('delta', { text: 'lo' }) +
      frame('done', done);
    // Split at awkward boundaries to exercise buffering.
    const chunks = [all.slice(0, 17), all.slice(17, 60), all.slice(60)];
    const fetchMock = vi.fn().mockResolvedValue(sseResponse(chunks));
    vi.stubGlobal('fetch', fetchMock);

    const deltas: string[] = [];
    const onStart = vi.fn();
    const result = await streamMessage('hi', null, 'tok', {
      onStart,
      onDelta: (t) => deltas.push(t),
    });

    expect(result).toEqual(done);
    expect(deltas.join('')).toBe('Hello');
    expect(onStart).toHaveBeenCalledWith({ conversation_id: 'c1', sources: [] });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toContain('/api/v1/chat/messages/stream');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tok');
  });

  it('passes answer_mode, sources and advocates through the start event', async () => {
    const start = {
      conversation_id: 'c1',
      legal_category: 'EMPLOYMENT_LAW',
      jurisdiction_scope: 'CENTRAL',
      risk_level: 'HIGH',
      is_out_of_scope: false,
      answer_mode: 'sources_only',
      sources: [{ document_id: 'd1', document_title: 'T', section: null, article: null, source_url: 'https://x.example' }],
      recommended_advocates: [{ id: 'a1' }],
    };
    const done = { conversation_id: 'c1', disclaimer: 'd', answer_mode: 'sources_only' };
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          sseResponse([frame('start', start), frame('delta', { text: 'one' }), frame('delta', { text: 'two' }), frame('done', done)]),
        ),
    );
    const onStart = vi.fn();
    const deltas: string[] = [];
    const result = await streamMessage('q', null, null, { onStart, onDelta: (t) => deltas.push(t) });
    expect(onStart).toHaveBeenCalledWith(start);
    expect(onStart.mock.calls[0]?.[0].answer_mode).toBe('sources_only');
    expect(deltas).toEqual(['one', 'two']);
    expect(result.answer_mode).toBe('sources_only');
  });

  it('treats a garbled frame as an interrupted stream, not a crash', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(sseResponse(['event: delta\ndata: {not json\n\n'])),
    );
    await expect(streamMessage('hi', null, null)).rejects.toMatchObject({
      code: 'stream_interrupted',
    });
  });

  it('turns an in-stream error event into ApiRequestError', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          sseResponse([
            frame('start', { conversation_id: 'c1' }),
            frame('error', { code: 'llm_rate_limited', message: 'Limit reached' }),
          ]),
        ),
    );
    await expect(streamMessage('hi', null, null)).rejects.toMatchObject({
      code: 'llm_rate_limited',
      message: 'Limit reached',
    });
  });

  it('parses the JSON error envelope for non-2xx responses', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: { code: 'llm_not_configured', message: 'Not configured', request_id: 'r' },
          }),
          { status: 503, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    );
    const err = await streamMessage('hi', null, null).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiRequestError);
    expect(err).toMatchObject({ status: 503, code: 'llm_not_configured' });
  });

  it('rejects when the stream ends without a done event', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(sseResponse([frame('delta', { text: 'x' })])));
    await expect(streamMessage('hi', null, null)).rejects.toMatchObject({
      code: 'stream_interrupted',
    });
  });

  it('maps network failures to network_error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(streamMessage('hi', null, null)).rejects.toMatchObject({ code: 'network_error' });
  });
});
