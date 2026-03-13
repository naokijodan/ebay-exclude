require("dotenv").config();
const pLimit = require("p-limit");
const {
  getFulfillmentPolicies,
  getFulfillmentPolicy,
  updateFulfillmentPolicy,
} = require("./dist/lib/ebay-api");

// 仕様: eco_used / game_used の INTERNATIONAL.shippingServices の順序を一括変更し、
//       US_IntlExpeditedSppedPAK を先頭に移動する。

// テスト済みのポリシーは除外
const ALREADY_DONE = "302645784011";

(async () => {
  try {
    console.log("=== eco_used / game_used ポリシー一覧取得 ===");
    const all = await getFulfillmentPolicies(undefined, "EBAY_US");

    // name に "eco_used" または "game_used" を含むもの
    const targetsAll = all.filter(
      (p) => p?.name && (p.name.includes("eco_used") || p.name.includes("game_used"))
    );

    // テスト済み除外
    const targets = targetsAll.filter((p) => p.fulfillmentPolicyId !== ALREADY_DONE);

    console.log("対象(フィルタ前):", targetsAll.length, "件");
    console.log("テスト済み除外:", 1, "件");
    console.log("今回の対象:", targets.length, "件");
    console.log("\n--- 実行開始 (並列5) ---\n");

    const limit = pLimit(5);
    let successCount = 0;
    let skipCount = 0;
    let failCount = 0;

    const tasks = targets.map((t) =>
      limit(async () => {
        const id = t.fulfillmentPolicyId;
        try {
          // フル取得
          const policy = await getFulfillmentPolicy(undefined, id);

          // INTERNATIONALオプション
          const intlOption = policy?.shippingOptions?.find(
            (o) => o.optionType === "INTERNATIONAL"
          );
          if (!intlOption) {
            console.log("SKIP:", policy?.name || id, "- INTERNATIONALなし");
            skipCount++;
            return;
          }

          const services = Array.isArray(intlOption.shippingServices)
            ? intlOption.shippingServices
            : [];
          if (services.length === 0) {
            console.log("SKIP:", policy?.name || id, "- shippingServices空");
            skipCount++;
            return;
          }

          const targetCode = "US_IntlExpeditedSppedPAK";
          const idx = services.findIndex(
            (s) => s?.shippingServiceCode === targetCode
          );
          if (idx === -1) {
            console.log("SKIP:", policy?.name || id, "-", targetCode, "未設定");
            skipCount++;
            return;
          }
          if (idx === 0) {
            console.log("SKIP:", policy?.name || id, "- 既に先頭");
            skipCount++;
            return;
          }

          // 先頭に移動（相対順序は維持）
          const [svc] = services.splice(idx, 1);
          services.unshift(svc);

          // PUT 更新
          await updateFulfillmentPolicy(undefined, id, policy);
          successCount++;
          console.log("OK:", policy?.name || id);
        } catch (err) {
          failCount++;
          const name = t?.name || id;
          const msg = err?.message || String(err);
          console.error("FAIL:", name, "-", msg);
          try {
            if (err?.response?.data) {
              console.error(
                "  Detail:",
                JSON.stringify(err.response.data).slice(0, 300)
              );
            }
          } catch (_) {
            // ignore json stringify errors
          }
        }
      })
    );

    await Promise.all(tasks);

    console.log("\n=== 結果 ===");
    console.log("成功:", successCount);
    console.log("スキップ:", skipCount);
    console.log("失敗:", failCount);
    console.log("合計:", successCount + skipCount + failCount);
  } catch (e) {
    console.error("初期化エラー:", e?.message || e);
    process.exit(1);
  }
})();

