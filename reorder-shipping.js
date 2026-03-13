const { getFulfillmentPolicy, updateFulfillmentPolicy } = require("./dist/lib/ebay-api");
require("dotenv").config();

(async () => {
  const DEFAULT_POLICY_ID = "302645784011";
  const policyId = process.argv[2] || DEFAULT_POLICY_ID;

  try {
    // 1) ポリシー取得
    const policy = await getFulfillmentPolicy(undefined, policyId);

    // 2) INTERNATIONALオプション取得
    const intlOption = policy.shippingOptions?.find(o => o.optionType === "INTERNATIONAL");
    if (!intlOption) {
      console.error("エラー: INTERNATIONALオプションが見つかりません。ポリシーID:", policyId);
      process.exit(1);
    }

    const services = Array.isArray(intlOption.shippingServices) ? intlOption.shippingServices : [];
    const before = services.map(s => s.shippingServiceCode);
    console.log("変更前:", before.join(" -> "));

    // 3) US_IntlExpeditedSppedPAK の位置確認
    const targetCode = "US_IntlExpeditedSppedPAK";
    const idx = services.findIndex(s => s.shippingServiceCode === targetCode);
    if (idx === -1) {
      console.log("スキップ:", targetCode, "が見つかりませんでした。");
      process.exit(0);
    }
    if (idx === 0) {
      console.log("変更不要: 既に先頭です。");
      process.exit(0);
    }

    // 4) 先頭に移動（他の相対順序は維持）
    const [svc] = services.splice(idx, 1);
    services.unshift(svc);

    const after = services.map(s => s.shippingServiceCode);
    console.log("変更後:", after.join(" -> "));

    // 5) 更新PUT
    await updateFulfillmentPolicy(undefined, policyId, policy);
    console.log("更新完了:", policy.name, "(", policyId, ")");
  } catch (err) {
    console.error("エラー:", err.message);
    if (err.response?.data) {
      try {
        console.error("詳細:", JSON.stringify(err.response.data).slice(0, 500));
      } catch (_) {
        // noop
      }
    }
    process.exit(1);
  }
})();

