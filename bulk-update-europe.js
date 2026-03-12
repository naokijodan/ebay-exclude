const {getFulfillmentPolicy, updateFulfillmentPolicy} = require("./dist/lib/ebay-api");
const pLimit = require("p-limit");
require("dotenv").config();

// テスト済みのポリシーは除外
const ALREADY_DONE = "302645784011";

(async () => {
  // Step 1: 全ポリシー取得してeco_usedをフィルタ
  console.log("=== eco_usedポリシー一覧取得 ===");
  const {getFulfillmentPolicies} = require("./dist/lib/ebay-api");
  const all = await getFulfillmentPolicies(undefined, "EBAY_US");

  const ecoUsed = all.filter(p =>
    p.name && p.name.includes("eco_used")
  );

  // テスト済みを除外
  const targets = ecoUsed.filter(p => p.fulfillmentPolicyId !== ALREADY_DONE);

  console.log("eco_used合計:", ecoUsed.length, "件");
  console.log("テスト済み除外:", 1, "件");
  console.log("今回の対象:", targets.length, "件");
  console.log("");

  // 前回追加6件（game_used等）も対象に含める
  const additionalIds = [
    "303579171011", // Egl_202512_game_used20
    "303579268011", // Egl_202512_game_used15
    "303579428011", // Egl_202512_game_used10
    "302941696011", // Egl_2511-2099-2131_xp_used_0330
    "308477073011", // xp_used_free
    "299800939011", // Egl_202510_game_used
  ];

  // 追加6件を取得（eco_usedに含まれていないもの）
  const additionalTargets = [];
  for (const id of additionalIds) {
    if (id === ALREADY_DONE) continue;
    const existing = ecoUsed.find(p => p.fulfillmentPolicyId === id);
    if (!existing) {
      try {
        const p = await getFulfillmentPolicy(undefined, id);
        // Europe除外があるか確認
        const hasEurope = p.shipToLocations.regionExcluded.some(r => r.regionName === "Europe");
        if (hasEurope) {
          additionalTargets.push({ fulfillmentPolicyId: id, name: p.name });
          console.log("追加対象:", p.name, "(", id, ")");
        }
      } catch (e) {
        console.log("スキップ:", id, e.message);
      }
    }
  }

  const allTargets = [...targets, ...additionalTargets];
  console.log("\n合計対象:", allTargets.length, "件");
  console.log("---\n");

  // Step 2: 並列5で一括更新
  const limit = pLimit(5);
  let successCount = 0;
  let failCount = 0;
  let skipCount = 0;

  const tasks = allTargets.map(t => limit(async () => {
    const id = t.fulfillmentPolicyId;
    try {
      const policy = await getFulfillmentPolicy(undefined, id);

      // Europe除外があるか確認
      const hasEurope = policy.shipToLocations.regionExcluded.some(r => r.regionName === "Europe");
      if (!hasEurope) {
        console.log("SKIP:", policy.name, "- Europe除外なし");
        skipCount++;
        return;
      }

      // 既にUS_IntlExpeditedSppedPAKがあるか確認
      const intlOption = policy.shippingOptions.find(o => o.optionType === "INTERNATIONAL");
      const hasExpedited = intlOption.shippingServices.some(s => s.shippingServiceCode === "US_IntlExpeditedSppedPAK");
      if (hasExpedited) {
        console.log("SKIP:", policy.name, "- 既にExpeditedあり");
        skipCount++;
        return;
      }

      // 1. Europe除外を削除
      policy.shipToLocations.regionExcluded = policy.shipToLocations.regionExcluded.filter(
        r => r.regionName !== "Europe"
      );

      // 2. BY, RU, TR, UA 個別除外追加
      const existingNames = policy.shipToLocations.regionExcluded.map(r => r.regionName);
      ["BY", "RU", "TR", "UA"].forEach(code => {
        if (!existingNames.includes(code)) {
          policy.shipToLocations.regionExcluded.push({ regionName: code });
        }
      });

      // 3. OtherInternational の ShipTo から Europe除外
      const otherIntl = intlOption.shippingServices.find(s => s.shippingServiceCode === "OtherInternational");
      if (otherIntl) {
        if (!otherIntl.shipToLocations.regionExcluded) {
          otherIntl.shipToLocations.regionExcluded = [];
        }
        otherIntl.shipToLocations.regionExcluded.push({ regionName: "Europe" });
      }

      // 4. US_IntlExpeditedSppedPAK $15 Europe専用追加
      intlOption.shippingServices.push({
        sortOrder: 2,
        shippingCarrierCode: "GENERIC",
        shippingServiceCode: "US_IntlExpeditedSppedPAK",
        shippingCost: { value: "15.0", currency: "USD" },
        additionalShippingCost: { value: "15.0", currency: "USD" },
        freeShipping: false,
        shipToLocations: {
          regionIncluded: [{ regionName: "Europe" }]
        },
        buyerResponsibleForShipping: false,
        buyerResponsibleForPickup: false
      });

      // 5. API更新
      await updateFulfillmentPolicy(undefined, id, policy);
      successCount++;
      console.log("OK:", policy.name);

    } catch (err) {
      failCount++;
      console.error("FAIL:", t.name || id, "-", err.message);
      if (err.response?.data) {
        console.error("  Detail:", JSON.stringify(err.response.data).slice(0, 200));
      }
    }
  }));

  await Promise.all(tasks);

  console.log("\n=== 結果 ===");
  console.log("成功:", successCount);
  console.log("スキップ:", skipCount);
  console.log("失敗:", failCount);
  console.log("合計:", successCount + skipCount + failCount);
})();
