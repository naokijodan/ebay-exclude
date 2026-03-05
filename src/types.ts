export type RuleType = 'region' | 'country' | 'domestic' | 'other';
export type RuleAction = 'exclude' | 'include';

export interface ExclusionRule {
  type: RuleType;
  value: string;
  action: RuleAction;
  note: string;
}

export interface FulfillmentPolicy {
  fulfillmentPolicyId: string;
  name: string;
  marketplaceId: string;
  categoryTypes: Array<{ name: string; default: boolean }>;
  handlingTime: { value: number; unit: string };
  shipToLocations: {
    regionIncluded?: Array<{ regionName: string; regionType: string }>;
    regionExcluded?: Array<{ regionName: string; regionType: string }>;
  };
  shippingOptions: any[];
  [key: string]: any;
}

export interface ResolvedExclusion {
  regionExcluded: Array<{ regionName: string; regionType: string }>;
  summary: {
    totalCountries: number;
    byRegion: Record<string, { total: number; excluded: number; included: number }>;
    domestic: string[];
    other: string[];
  };
}

