import fs from 'fs';
import path from 'path';
import { ExclusionRule } from '../types';
import { regionMapping, domesticOptions, otherOptions, isoToCountry } from '../data/definitions';

const HEADER = ['type', 'value', 'action', 'note'];

function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

function csvEscape(val: string): string {
  if (val.includes('"')) val = val.replace(/"/g, '""');
  if (val.includes(',') || val.includes('"') || /\s/.test(val)) return `"${val}"`;
  return val;
}

function validateRule(rule: ExclusionRule, lineNo?: number) {
  const where = lineNo ? ` (line ${lineNo})` : '';
  const typeOk = ['region', 'country', 'domestic', 'other'].includes(rule.type);
  if (!typeOk) throw new Error(`Invalid type '${rule.type}'${where}`);
  const actionOk = ['exclude', 'include'].includes(rule.action);
  if (!actionOk) throw new Error(`Invalid action '${rule.action}'${where}`);

  if (rule.type === 'region') {
    if (!(rule.value in regionMapping)) {
      throw new Error(`Unknown region '${rule.value}'${where}`);
    }
  }
  if (rule.type === 'country') {
    const iso = rule.value.toUpperCase();
    if (!(iso in isoToCountry)) {
      throw new Error(`Unknown ISO country code '${rule.value}'${where}`);
    }
  }
  if (rule.type === 'domestic') {
    if (!domesticOptions.includes(rule.value)) {
      throw new Error(`Unknown domestic option '${rule.value}'${where}`);
    }
  }
  if (rule.type === 'other') {
    if (!otherOptions.includes(rule.value)) {
      throw new Error(`Unknown other option '${rule.value}'${where}`);
    }
  }
}

export function parseCSV(filePath: string): ExclusionRule[] {
  const abs = path.resolve(filePath);
  if (!fs.existsSync(abs)) throw new Error(`CSV not found: ${abs}`);
  const content = fs.readFileSync(abs, 'utf8');
  const lines = content.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];
  const first = parseCsvLine(lines[0]);
  if (first.map((s) => s.toLowerCase()).join(',') !== HEADER.join(',')) {
    throw new Error(`Invalid header. Expected: ${HEADER.join(',')}`);
  }
  const rules: ExclusionRule[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = parseCsvLine(lines[i]);
    if (cols.length < 4) throw new Error(`Invalid row at line ${i + 1}`);
    const [type, value, action, note] = cols as [any, any, any, any];
    const rule: ExclusionRule = {
      type: type as ExclusionRule['type'],
      value: (type === 'country' ? String(value).toUpperCase() : String(value)).trim(),
      action: action as ExclusionRule['action'],
      note: String(note || ''),
    };
    validateRule(rule, i + 1);
    rules.push(rule);
  }
  return rules;
}

export function writeCSV(filePath: string, rules: ExclusionRule[]): void {
  const abs = path.resolve(filePath);
  const lines: string[] = [];
  lines.push(HEADER.join(','));
  for (const r of rules) {
    lines.push(
      [r.type, r.value, r.action, r.note]
        .map((v) => csvEscape(String(v ?? '')))
        .join(',')
    );
  }
  fs.writeFileSync(abs, lines.join('\n'));
}

export function generateTemplate(filePath: string): void {
  const rules: ExclusionRule[] = [];
  // All regions excluded by default
  Object.keys(regionMapping).forEach((region) => {
    rules.push({ type: 'region', value: region, action: 'exclude', note: `${region} 全域除外` });
  });
  // Domestic defaults
  for (const d of domesticOptions) {
    rules.push({ type: 'domestic', value: d, action: 'exclude', note: `${d} 除外` });
  }
  // Other defaults
  for (const o of otherOptions) {
    rules.push({ type: 'other', value: o, action: 'exclude', note: `${o} 除外` });
  }
  writeCSV(filePath, rules);
}

