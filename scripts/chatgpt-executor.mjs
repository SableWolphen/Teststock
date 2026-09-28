#!/usr/bin/env node
/**
 * ChatGPT (OpenAI) execution agent for Teststock — DIAGNOSTICS ONLY.
 *
 * RETIRED (2026-09-28): the full live execution cycle (headless API call with
 * the Robinhood Trading MCP server attached) was proven unreachable — OpenAI's
 * servers cannot authenticate to https://agent.robinhood.com/mcp/trading
 * (MCP tool-list rejected, HTTP 424). The standing architecture is:
 * Teststock/GitHub publishes intelligence (trigger board, dispatch, signals);
 * the ChatGPT app (scheduled tasks with the connected Robinhood integration)
 * is the sole broker-action layer. This script must never be used to place,
 * modify, or cancel broker orders.
 *
 * Output contract (stdout): a single JSON object compatible with
 * scripts/record-executor-result.py:
 *   success: {"is_error": false, "result": "<final text>", "model": ..., "usage": {...}}
 *   failure: {"is_error": true, "error": "<classification-friendly text>"} + non-zero exit
 *
 * Modes:
 *   node scripts/chatgpt-executor.mjs --probe      lightweight OpenAI auth probe
 *                                                    (no MCP, no broker tools)
 *   node scripts/chatgpt-executor.mjs --mcp-probe   read-only Robinhood MCP
 *                                                    connectivity diagnostic
 *   node scripts/chatgpt-executor.mjs               REFUSED — full live
 *                                                    execution is retired (see above)
 *
 * Env:
 *   OPENAI_API_KEY        required
 *   OPENAI_MODEL          optional (default "gpt-5")
 *   OPENAI_MCP_SERVER_URL optional (default: URL from .mcp.json, else Robinhood default)
 *   OPENAI_MAX_TOOL_CALLS optional (default 32, mirrors the old --max-turns 16)
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const API_URL = 'https://api.openai.com/v1/responses';
const DEFAULT_MCP_URL = 'https://agent.robinhood.com/mcp/trading';

const INSTRUCTION_FILES = [
  'scripts/chatgpt-executor-prompt.md',
  'scripts/chatgpt-trade-quality-rules.md',
  'scripts/chatgpt-stock-rotation-rules.md',
  'scripts/chatgpt-options-rules.md',
  'scripts/daytrader-profit-discipline.md',
];
const DATA_FILES = [
  'docs/data/execution-dispatch.json',
  'docs/data/trigger-board.json',
  'docs/data/intraday-edge.json',
  'docs/data/daytrader-intelligence.json',
  'docs/data/execution-watchlist.json',
  'docs/signal.json',
  'docs/data/adaptive-performance.json',
  'docs/data/option-candidates.json',
];

function readIfExists(rel) {
  try {
    return fs.readFileSync(path.join(ROOT, rel), 'utf8');
  } catch {
    return null;
  }
}

function mcpServerUrl() {
  if (process.env.OPENAI_MCP_SERVER_URL) return process.env.OPENAI_MCP_SERVER_URL;
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, '.mcp.json'), 'utf8'));
    const url = cfg?.mcpServers?.['robinhood-trading']?.url;
    if (typeof url === 'string' && url) return url;
  } catch { /* fall through to default */ }
  return DEFAULT_MCP_URL;
}

function extractText(response) {
  const chunks = [];
  for (const item of response.output || []) {
    if (item.type === 'message' && Array.isArray(item.content)) {
      for (const part of item.content) {
        if (part.type === 'output_text' && typeof part.text === 'string') chunks.push(part.text);
      }
    }
  }
  return chunks.join('\n').trim();
}

async function callResponses({ instructions, input, tools, maxOutputTokens, timeoutMs, maxToolCalls }) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    const err = new Error('authentication_error: OPENAI_API_KEY is not set (invalid api key)');
    err.code = 'AUTH';
    throw err;
  }
  const body = {
    model: process.env.OPENAI_MODEL || 'gpt-5',
    instructions,
    input,
    tools,
    tool_choice: 'auto',
    store: false,
  };
  if (maxOutputTokens) body.max_output_tokens = maxOutputTokens;
  if (maxToolCalls) body.max_tool_calls = maxToolCalls;
  let res;
  try {
    res = await fetch(API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (e) {
    const msg = String(e?.message || e);
    if (/timeout|timed out|abort/i.test(msg)) {
      const err = new Error(`connection error: OpenAI request timed out after ${timeoutMs}ms`);
      err.code = 'TIMEOUT';
      throw err;
    }
    const err = new Error(`connection error: ${msg}`);
    err.code = 'CONNECTION';
    throw err;
  }
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    if (res.status === 401) {
      const err = new Error(`authentication_error: OpenAI rejected the API key (invalid api key): ${text.slice(0, 200)}`);
      err.code = 'AUTH';
      throw err;
    }
    if (res.status === 429) {
      const err = new Error(`rate_limit: OpenAI rate or usage limit hit: ${text.slice(0, 200)}`);
      err.code = 'RATE';
      throw err;
    }
    const err = new Error(`OpenAI API error ${res.status}: ${text.slice(0, 300)}`);
    err.code = 'API';
    throw err;
  }
  return res.json();
}

function emitSuccess(payload) {
  process.stdout.write(JSON.stringify(payload) + '\n');
}

function emitFailure(message) {
  process.stdout.write(JSON.stringify({ is_error: true, error: message }) + '\n');
  process.stderr.write(message + '\n');
  process.exitCode = 1;
}

async function runProbe() {
  try {
    const response = await callResponses({
      instructions: 'You are a connectivity probe. Follow the user instruction literally.',
      input: 'Reply with READY only. Do not take any actions.',
      tools: [],
      // gpt-5 is a reasoning model: the token budget must cover hidden reasoning
      // plus the visible reply, or the response comes back "incomplete".
      maxOutputTokens: 512,
      timeoutMs: 60000,
    });
    const text = extractText(response);
    if (response.status && response.status !== 'completed') {
      throw new Error(`probe incomplete: status=${response.status}`);
    }
    emitSuccess({ is_error: false, result: text || 'READY', model: response.model, probe: true });
  } catch (e) {
    emitFailure(`probe failed: ${e.message}`);
  }
}

// runFull() (headless broker execution) removed 2026-09-28: retired, see header.

async function runMcpProbe() {
  try {
    const response = await callResponses({
      instructions: 'You are a read-only broker connectivity probe. Follow the user instruction literally and completely.',
      input: [
        'READ-ONLY BROKER CONNECTIVITY TEST. Money must not move.',
        '',
        'Use the robinhood-trading MCP tools to:',
        '1. Confirm the connection works (list available tools or fetch server info).',
        '2. Fetch the account summary: account value, buying power, cash.',
        '3. Fetch current positions and open orders.',
        '',
        'ABSOLUTE RULES: Do NOT place, modify, or cancel any orders. Do NOT transfer,',
        'deposit, or withdraw funds. Do NOT exercise options. Read-only calls only.',
        '',
        'Reply with a JSON object only, no other text:',
        '{"connected": true/false, "tools_seen": [...], "account": {...}, "positions": [...], "open_orders": [...], "error": "..."}',
        'If the MCP server rejects authentication or any call fails, set connected:false',
        'and describe the exact error in "error".',
      ].join('\n'),
      tools: [{
        type: 'mcp',
        server_label: 'robinhood-trading',
        server_url: mcpServerUrl(),
        // Read-only probe: no human present; the prompt above forbids any
        // state-changing call, and the result is audited in the workflow log.
        require_approval: 'never',
      }],
      maxOutputTokens: 2000,
      timeoutMs: 5 * 60 * 1000,
    });
    if (response.status && response.status !== 'completed') {
      throw new Error(`mcp probe incomplete: status=${response.status}`);
    }
    const text = extractText(response);
    const mcpCalls = [];
    for (const item of response.output || []) {
      if (item.type === 'mcp_call') mcpCalls.push({ name: item.name, server: item.server_label });
      if (item.type === 'mcp_list_tools') mcpCalls.push({ list_tools: true, server: item.server_label, count: (item.tools || []).length });
    }
    emitSuccess({ is_error: false, probe: 'mcp', result: text, mcp_calls: mcpCalls, model: response.model, usage: response.usage || null });
  } catch (e) {
    emitFailure(`mcp probe failed: ${e.message}`);
  }
}

const probe = process.argv.includes('--probe');
const mcpProbe = process.argv.includes('--mcp-probe');
if (mcpProbe) await runMcpProbe();
else if (probe) await runProbe();
else {
  // Full live execution is retired: the headless API path cannot authenticate
  // to the Robinhood MCP (proven 2026-09-28, MCP 424). Broker actions run in
  // the ChatGPT app via scheduled tasks reading the published dispatch.
  emitFailure('retired: headless broker execution is disabled; execution runs in the ChatGPT app (see docs/chatgpt-autopilot.txt)');
}
