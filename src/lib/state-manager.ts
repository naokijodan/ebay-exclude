import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { ExclusionRule } from '../types';

export interface StateData {
  lastApplied: string | null;
  policies: Record<
    string,
    {
      hash: string;
      appliedAt: string;
      success: boolean;
    }
  >;
  resumeFrom?: string;
}

const STATE_FILE = path.resolve(process.cwd(), '.ebay-exclude-state.json');

export function loadState(): StateData {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const raw = fs.readFileSync(STATE_FILE, 'utf8');
      const parsed = JSON.parse(raw) as StateData;
      return parsed;
    }
  } catch {
    // ignore
  }
  return { lastApplied: null, policies: {} } as StateData;
}

export function saveState(state: StateData) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

function stableRules(rules: ExclusionRule[]): any[] {
  return rules
    .map((r) => ({ ...r }))
    .sort((a, b) => `${a.type}:${a.value}:${a.action}`.localeCompare(`${b.type}:${b.value}:${b.action}`));
}

export function computeRulesHash(rules: ExclusionRule[]): string {
  const input = JSON.stringify(stableRules(rules));
  return crypto.createHash('sha256').update(input).digest('hex');
}

export function recordPolicyState(
  state: StateData,
  policyId: string,
  hash: string,
  success: boolean
) {
  state.policies[policyId] = {
    hash,
    appliedAt: new Date().toISOString(),
    success,
  };
  state.lastApplied = new Date().toISOString();
}

