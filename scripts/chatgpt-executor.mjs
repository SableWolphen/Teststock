#!/usr/bin/env node
/**
 * ChatGPT (OpenAI) live execution agent for Teststock.
 *
 * Replaces the Claude CLI harness (`claude -p --mcp-config .mcp.json`). It reads
 * the same prompt/rulebook files, feeds the same live data-file snapshot, and
 * calls the OpenAI Responses API with the Robinhood Trading MCP server attached
 * as a tool. The API executes MCP tool calls server-side and returns the final
 * result, mirroring the old `--max-turns 16` agentic loop.
 *
 * Output contract (stdout): a single JSON object compatible with
 * scripts/record-executor-result.py:
 *   success: {"is_error": false, "result": "<final text>", "model": ..., "usage": {...}}
 *   failure: {"is_error": true, "error": "<classification-friendly text>"} + non-zero exit
 *
 * Modes:
 *   node scripts/chatgpt-executor.mjs           full live execution cycle
 *   node scripts/chatgpt-executor.mjs --probe   lightweight auth probe (no MCP,
 *                                               no broker tools) for startup verification
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

async function runFull() {
  try {
    const missing = [];
    const instructions = INSTRUCTION_FILES.map((f) => {
      const content = readIfExists(f);
      if (content == null) { missing.push(f); return `<!-- MISSING: ${f} -->`; }
      return content;
    }).join('\n\n');

    const snapshot = DATA_FILES.map((f) => {
      const content = readIfExists(f);
      if (content == null) return `--- ${f} ---\nMISSING: file not present in this checkout`;
      return `--- ${f} ---\n${content}`;
    }).join('\n\n');

    const input =
      'Live data snapshot. These are read-only copies of the repository files named in ' +
      'the execution contract ("Read first"). Treat MISSING markers as missing files ' +
      'under the fail-closed rule; never invent their contents.\n\n' + snapshot;

    const maxToolCalls = Number(process.env.OPENAI_MAX_TOOL_CALLS || 32);
    const response = await callResponses({
      instructions,
      input,
      tools: [{
        type: 'mcp',
        server_label: 'robinhood-trading',
        server_url: mcpServerUrl(),
        // Headless scheduled execution: no human is present to approve tool calls.
        // Every broker action remains constrained by the execution contract above.
        require_approval: 'never',
      }],
      maxToolCalls,
      timeoutMs: 8 * 60 * 1000,
    });
    if (response.status && response.status !== 'completed') {
      const reason = response.incomplete_details?.reason || response.status;
      throw new Error(`executor run incomplete: ${reason}`);
    }
    const text = extractText(response);
    emitSuccess({
      is_error: false,
      result: text,
      model: response.model,
      usage: response.usage || null,
    });
    if (missing.length) {
      process.stderr.write(`warning: missing prompt files: ${missing.join(', ')}\n`);
    }
  } catch (e) {
    emitFailure(`executor failed: ${e.message}`);
  }
}

const probe = process.argv.includes('--probe');
await (probe ? runProbe() : runFull());
