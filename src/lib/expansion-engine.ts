import { ExclusionRule, ResolvedExclusion } from '../types';
import { regionMapping, regionCountries, countryToIso, isoToCountry, domesticOptions, otherOptions } from '../data/definitions';

function uniq<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}

function getRegionIsoList(region: string): string[] {
  const names = regionCountries[region] || [];
  const isos = names
    .map((name) => countryToIso[name] || countryToIso[name.trim()])
    .filter((v): v is string => !!v)
    .map((iso) => iso.toUpperCase());
  return uniq(isos);
}

export function resolveExclusions(rules: ExclusionRule[]): ResolvedExclusion {
  const regionExcludes = new Set<string>();
  const countryExcludes = new Set<string>();
  const countryIncludes = new Set<string>();
  const domestic: string[] = [];
  const other: string[] = [];

  for (const r of rules) {
    if (r.type === 'region' && r.action === 'exclude') {
      if (regionMapping[r.value]) regionExcludes.add(r.value);
    }
    if (r.type === 'country') {
      const iso = r.value.toUpperCase();
      if (r.action === 'exclude') countryExcludes.add(iso);
      if (r.action === 'include') countryIncludes.add(iso);
    }
    if (r.type === 'domestic' && r.action === 'exclude') {
      if (domesticOptions.includes(r.value)) domestic.push(r.value);
    }
    if (r.type === 'other' && r.action === 'exclude') {
      if (otherOptions.includes(r.value)) other.push(r.value);
    }
  }

  // Expand regions to countries
  const expandedRegionCountries: Record<string, Set<string>> = {};
  const globallyExcluded = new Set<string>();
  for (const region of regionExcludes) {
    const isos = getRegionIsoList(region);
    const set = new Set<string>(isos);
    expandedRegionCountries[region] = set;
    for (const c of set) globallyExcluded.add(c);
  }

  // Apply country includes (remove from global excluded)
  for (const iso of countryIncludes) {
    globallyExcluded.delete(iso);
    for (const region of Object.keys(expandedRegionCountries)) {
      expandedRegionCountries[region].delete(iso);
    }
  }

  // Apply explicit country excludes
  for (const iso of countryExcludes) {
    globallyExcluded.add(iso);
  }

  // Optimization: For each region fully covered, use COUNTRY_REGION token
  const finalExcluded: Array<{ regionName: string; regionType: string }> = [];
  const coveredByRegion: Set<string> = new Set();

  for (const region of regionExcludes) {
    const allInRegion = new Set(getRegionIsoList(region));
    const excludedInRegion = expandedRegionCountries[region] || new Set<string>();
    const includesInRegion = new Set(
      Array.from(allInRegion).filter((iso) => countryIncludes.has(iso))
    );

    const isFullyExcluded = excludedInRegion.size === allInRegion.size;
    if (isFullyExcluded && includesInRegion.size === 0) {
      // compress to COUNTRY_REGION
      finalExcluded.push({ regionName: regionMapping[region], regionType: 'COUNTRY_REGION' });
      // mark countries as covered to avoid listing individually later
      for (const iso of allInRegion) coveredByRegion.add(iso);
    }
  }

  // For countries not covered by a COUNTRY_REGION token, list individually
  for (const iso of globallyExcluded) {
    if (!coveredByRegion.has(iso)) {
      finalExcluded.push({ regionName: iso, regionType: 'COUNTRY' });
    }
  }

  // Domestic and other
  for (const d of uniq(domestic)) {
    finalExcluded.push({ regionName: d, regionType: 'STATE_OR_PROVINCE' });
  }
  for (const o of uniq(other)) {
    finalExcluded.push({ regionName: o, regionType: 'PO_BOX' });
  }

  // Build summary
  const byRegion: Record<string, { total: number; excluded: number; included: number }> = {};
  const excludedIsoSet = new Set(
    finalExcluded
      .filter((x) => x.regionType === 'COUNTRY')
      .map((x) => x.regionName)
  );

  for (const [region, names] of Object.entries(regionCountries)) {
    const allIsos = new Set(
      names.map((n) => countryToIso[n]).filter((v): v is string => !!v)
    );
    const excluded = Array.from(allIsos).filter((iso) => excludedIsoSet.has(iso));
    const included = Array.from(allIsos).filter((iso) => !excludedIsoSet.has(iso));
    byRegion[region] = { total: allIsos.size, excluded: excluded.length, included: included.length };
  }

  const totalCountries = excludedIsoSet.size;

  return {
    regionExcluded: finalExcluded,
    summary: { totalCountries, byRegion, domestic: uniq(domestic), other: uniq(other) },
  };
}

