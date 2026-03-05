import { regionMapping, countryToIso } from '../data/definitions';

export type RegionType = 'COUNTRY_REGION' | 'COUNTRY' | 'STATE_OR_PROVINCE' | 'PO_BOX';

// regionMappingのキーと値を両方含むSet
const regionNames = new Set<string>([
  ...Object.keys(regionMapping),
  ...Object.values(regionMapping),
]);

// 特殊地域
const domesticRegions = new Set<string>(['Alaska/Hawaii', 'APO/FPO', 'US Protectorates']);

// ISO国コードのSet（2文字大文字）
const isoCodes = new Set<string>(Object.values(countryToIso));

// 国名のSet
const countryNames = new Set<string>(Object.keys(countryToIso));

export function classifyRegionName(regionName: string): RegionType {
  if (regionNames.has(regionName)) return 'COUNTRY_REGION';
  if (domesticRegions.has(regionName)) return 'STATE_OR_PROVINCE';
  if (regionName === 'PO Box') return 'PO_BOX';
  if (/^[A-Z]{2}$/.test(regionName) && isoCodes.has(regionName)) return 'COUNTRY';
  if (/^[A-Z]{2}$/.test(regionName)) return 'COUNTRY'; // 2文字大文字はISOコードと推定
  if (countryNames.has(regionName)) return 'COUNTRY';
  return 'COUNTRY'; // デフォルトは国扱い
}

