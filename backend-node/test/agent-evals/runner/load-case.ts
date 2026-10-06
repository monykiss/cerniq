/**
 * Fixture loader — reads golden cases and optional LLM scripts from disk.
 */

import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import type { GoldenCase, EvalBaseline } from './fixture-types';
import type { LLMScript } from './mock-llm-bridge';

const CASES_DIR = join(__dirname, '..', 'cases');
const BASELINES_DIR = join(__dirname, '..', 'baselines');

export function loadCase(agentDir: string, caseFile: string): GoldenCase {
  const path = join(CASES_DIR, agentDir, caseFile);
  return JSON.parse(readFileSync(path, 'utf-8')) as GoldenCase;
}

export function loadAllCases(agentDir: string): GoldenCase[] {
  const dir = join(CASES_DIR, agentDir);
  if (!existsSync(dir)) return [];

  return readdirSync(dir)
    .filter((f) => f.endsWith('.json'))
    .sort()
    .map((f) => loadCase(agentDir, f));
}

export function loadScript(agentDir: string, caseId: string): LLMScript | null {
  const scriptPath = join(CASES_DIR, agentDir, `${caseId}.script.ts`);
  if (!existsSync(scriptPath)) return null;

  // Dynamic require — the script file exports a default LLMScript.

  const mod = require(scriptPath);
  return (mod.default ?? mod) as LLMScript;
}

export function loadBaseline(agentId: string): EvalBaseline | null {
  const normId = agentId.toLowerCase().replace(/_/g, '_');
  const path = join(BASELINES_DIR, `${normId}.json`);
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, 'utf-8')) as EvalBaseline;
}

export function listAgentDirs(): string[] {
  if (!existsSync(CASES_DIR)) return [];
  return readdirSync(CASES_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
}
