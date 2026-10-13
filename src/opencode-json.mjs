/**
 * Adapted from opencode-delegate-mcp/src/backend.ts.
 * Copyright (c) 2026 mryesiller. MIT License.
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 *
 * GoFlow changes: bounded numeric conversion; expose JSONL error events;
 * reject event-level model/provider drift; do not retain tool arguments.
 */

const count = value => Number.isFinite(Number(value)) && Number(value) >= 0 ? Number(value) : 0;

export function parseOpencodeJsonl(stdout) {
  const parts = new Map();
  const order = [];
  const errors = [];
  const models = new Set();
  let sessionId;
  for (const line of String(stdout).split('\n')) {
    if (!line.trim()) continue;
    let event;
    try { event = JSON.parse(line); } catch { continue; }
    if (!event || typeof event !== 'object') continue;
    if (typeof event.sessionID === 'string' && !sessionId) sessionId = event.sessionID;
    if (event.type === 'error') {
      errors.push(typeof event.error?.data?.message === 'string' ? event.error.data.message
        : typeof event.error?.message === 'string' ? event.error.message : 'OpenCode error event');
    }
    const info = event.info ?? event.message;
    if (typeof info?.providerID === 'string' && typeof info?.modelID === 'string') {
      models.add(`${info.providerID}/${info.modelID}`);
    }
    const part = event.part;
    if (part && typeof part.id === 'string') {
      if (!parts.has(part.id)) order.push(part.id);
      parts.set(part.id, part);
    }
  }
  const text = [];
  const actions = [];
  const usage = { inputTokens: 0, outputTokens: 0, reasoningTokens: 0,
    cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 0, cost: 0 };
  for (const id of order) {
    const part = parts.get(id);
    if (part.type === 'text' && typeof part.text === 'string') text.push(part.text);
    if (part.type === 'tool') actions.push({ tool: typeof part.tool === 'string' ? part.tool : 'tool',
      status: typeof part.state?.status === 'string' ? part.state.status : undefined });
    if (part.type === 'step-finish') {
      const tokens = part.tokens ?? {};
      usage.inputTokens += count(tokens.input);
      usage.outputTokens += count(tokens.output);
      usage.reasoningTokens += count(tokens.reasoning);
      usage.cacheReadTokens += count(tokens.cache?.read);
      usage.cacheWriteTokens += count(tokens.cache?.write);
      usage.totalTokens += count(tokens.total);
      usage.cost += count(part.cost);
    }
  }
  return { text: text.join('\n').trim(), sessionId, usage, actions, errors, models: [...models] };
}
