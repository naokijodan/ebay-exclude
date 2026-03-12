require('dotenv').config();
const { getFulfillmentPolicies, getFulfillmentPolicy, updateFulfillmentPolicy } = require('../dist/lib/ebay-api');
const { getAccessToken } = require('../dist/lib/auth');

const COUNTRIES_TO_ADD = ['IE', 'AZ', 'AM', 'GR', 'HR', 'GE', 'CZ', 'NO', 'HU', 'BG'];

async function main() {
  const token = await getAccessToken();
  const policies = await getFulfillmentPolicies(token, 'EBAY_US');
  const ecoPolicies = policies.filter(p => p.name && p.name.toLowerCase().includes('eco'));
  console.log('ecoポリシー数:', ecoPolicies.length);

  let updated = 0, skipped = 0, failed = 0;

  for (const p of ecoPolicies) {
    const full = await getFulfillmentPolicy(token, p.fulfillmentPolicyId);
    const currentExcluded = full.shipToLocations?.regionExcluded || [];
    const currentNames = new Set(currentExcluded.map(r => r.regionName));

    const toAdd = COUNTRIES_TO_ADD.filter(c => {
      return !currentNames.has(c);
    });

    if (toAdd.length === 0) {
      skipped++;
      continue;
    }

    const newExcluded = [...currentExcluded, ...toAdd.map(c => ({ regionName: c }))];

    try {
      await updateFulfillmentPolicy(token, p.fulfillmentPolicyId, {
        ...full,
        shipToLocations: { ...full.shipToLocations, regionExcluded: newExcluded }
      });
      updated++;
      process.stdout.write('.');
    } catch (err) {
      if (err.message && err.message.includes('same as in the system')) {
        skipped++;
        process.stdout.write('s');
      } else {
        failed++;
        process.stdout.write('x');
        console.error('\nエラー:', p.name, err.message?.substring(0, 100));
      }
    }
  }

  console.log('');
  console.log('完了:', updated, '件更新、', skipped, '件スキップ、', failed, '件エラー');
}

main().catch(e => console.error(e));
