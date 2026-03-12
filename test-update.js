const {getFulfillmentPolicy, updateFulfillmentPolicy} = require("./dist/lib/ebay-api");
require("dotenv").config();

const POLICY_ID = "302645784011";

(async () => {
  // Step 0: 現状取得
  console.log("=== Step 0: 現状取得 ===");
  const policy = await getFulfillmentPolicy(undefined, POLICY_ID);
  console.log("Name:", policy.name);
  console.log("Exclusions:", policy.shipToLocations.regionExcluded.map(r => r.regionName));
  console.log("International services:");
  const intlOption = policy.shippingOptions.find(o => o.optionType === "INTERNATIONAL");
  intlOption.shippingServices.forEach((s, i) => {
    console.log("  [" + i + "]", s.shippingServiceCode, "$" + s.shippingCost?.value, "->", JSON.stringify(s.shipToLocations?.regionIncluded));
  });

  // Step 1: Europe一括除外を削除
  console.log("\n=== Step 1: Europe除外を削除 ===");
  policy.shipToLocations.regionExcluded = policy.shipToLocations.regionExcluded.filter(
    r => r.regionName !== "Europe"
  );
  console.log("Europe除外を削除しました");

  // Step 2: BY, RU, TR, UA を個別除外に追加
  console.log("\n=== Step 2: BY, RU, TR, UA 個別除外追加 ===");
  const sanctionCountries = ["BY", "RU", "TR", "UA"];
  const existingNames = policy.shipToLocations.regionExcluded.map(r => r.regionName);
  sanctionCountries.forEach(code => {
    if (!existingNames.includes(code)) {
      policy.shipToLocations.regionExcluded.push({ regionName: code });
      console.log("  追加:", code);
    } else {
      console.log("  既存:", code);
    }
  });

  // Step 3: [1] OtherInternational の ShipTo から Europe を除外
  console.log("\n=== Step 3: OtherInternational から Europe除外 ===");
  const otherIntl = intlOption.shippingServices.find(s => s.shippingServiceCode === "OtherInternational");
  if (otherIntl) {
    if (!otherIntl.shipToLocations.regionExcluded) {
      otherIntl.shipToLocations.regionExcluded = [];
    }
    otherIntl.shipToLocations.regionExcluded.push({ regionName: "Europe" });
    console.log("OtherInternational の ShipTo から Europe を除外しました");
  }

  // Step 4: [2] US_IntlExpeditedSppedPAK $15 を Europe専用で追加
  console.log("\n=== Step 4: Europe専用クーリエ追加 ===");
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
  console.log("US_IntlExpeditedSppedPAK $15 → Europe のみ を追加しました");

  // 更新前の確認
  console.log("\n=== 更新前確認 ===");
  console.log("Exclusions:", policy.shipToLocations.regionExcluded.map(r => r.regionName));
  console.log("International services:");
  intlOption.shippingServices.forEach((s, i) => {
    console.log("  [" + i + "]", s.shippingServiceCode, "$" + s.shippingCost?.value);
    console.log("    included:", JSON.stringify(s.shipToLocations?.regionIncluded));
    console.log("    excluded:", JSON.stringify(s.shipToLocations?.regionExcluded));
  });

  // Step 5: API更新実行
  console.log("\n=== Step 5: API更新実行 ===");
  try {
    await updateFulfillmentPolicy(undefined, POLICY_ID, policy);
    console.log("SUCCESS: ポリシー更新成功");
  } catch (err) {
    console.error("ERROR:", err.message);
    if (err.response) {
      console.error("Response:", JSON.stringify(err.response.data, null, 2));
    }
  }

  // Step 6: 更新後の確認
  console.log("\n=== Step 6: 更新後確認 ===");
  const updated = await getFulfillmentPolicy(undefined, POLICY_ID);
  console.log("Name:", updated.name);
  console.log("Exclusions:", updated.shipToLocations.regionExcluded.map(r => r.regionName));
  const intlUpdated = updated.shippingOptions.find(o => o.optionType === "INTERNATIONAL");
  console.log("International services:");
  intlUpdated.shippingServices.forEach((s, i) => {
    console.log("  [" + i + "]", s.shippingServiceCode, "$" + s.shippingCost?.value);
    if (s.shipToLocations) {
      console.log("    included:", JSON.stringify(s.shipToLocations.regionIncluded));
      console.log("    excluded:", JSON.stringify(s.shipToLocations.regionExcluded));
    }
  });
})();
