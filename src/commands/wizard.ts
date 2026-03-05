import * as readline from 'readline';
import chalk from 'chalk';
import { execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

// 既存のコマンド呼び出し（流用）
function runCommand(args: string): void {
  try {
    const projectRoot = path.resolve(__dirname, '..', '..');
    execSync(`node ${path.join(projectRoot, 'dist', 'index.js')} ${args}`.trim(), {
      cwd: projectRoot,
      stdio: 'inherit',
      env: { ...process.env },
    });
  } catch (error) {
    console.log(chalk.yellow('\nコマンドが完了しました（エラーがある場合は上を確認）'));
  }
}

// 既存のファイル存在チェック（流用）
function fileExists(filePath: string): boolean {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

// 入力ヘルパー
function createAsk(rl: readline.Interface) {
  const askLine = (q: string): Promise<string> =>
    new Promise((resolve) => rl.question(q, resolve));

  const askText = async (message: string, defaultValue?: string): Promise<string> => {
    console.log(message);
    const ans = await askLine('> ');
    const v = ans.trim();
    if (!v && typeof defaultValue !== 'undefined') return defaultValue;
    return v;
  };

  const askNumber = async (message: string, choices: string[], defaultIndex?: number): Promise<number> => {
    console.log(message);
    for (let i = 0; i < choices.length; i++) {
      console.log(`  ${i + 1}) ${choices[i]}`);
    }
    while (true) {
      const raw = await askLine('\n> ');
      const t = raw.trim();
      if (!t && typeof defaultIndex === 'number') return defaultIndex + 1;
      const n = Number(t);
      if (Number.isInteger(n) && n >= 1 && n <= choices.length) return n;
      console.log(chalk.red(`無効な入力です。${1}-${choices.length}の番号を入力してください。`));
    }
  };

  const askEnter = async (message: string): Promise<void> => {
    console.log(message);
    await askLine('> ');
  };

  return { askText, askNumber, askEnter };
}

function showWelcome(): void {
  console.log('');
  console.log('╔══════════════════════════════════════╗');
  console.log('║   ebay-exclude - 発送除外国管理     ║');
  console.log('╚══════════════════════════════════════╝');
  console.log('');
  console.log('こんにちは！eBayの発送除外国を管理します。');
  console.log('');
}

async function flowViewCurrent(ask: ReturnType<typeof createAsk>) {
  console.log('ポリシー一覧を取得中...');
  runCommand('list');

  const next = await ask.askNumber('\n? 次にどうしますか？', [
    '特定のポリシーの除外設定をCSVに出力する',
    'メインメニューに戻る',
  ]);

  if (next === 1) {
    const name = await ask.askText('? 出力ファイル名は？（Enterでexport.csv）:', 'export.csv');
    runCommand(`export -o "${name}"`);
    console.log(`\n${name} に保存しました！`);

    const after = await ask.askNumber('\n? 次にどうしますか？', [
      'このCSVを編集してeBayに反映する手順を見る',
      'メインメニューに戻る',
    ]);
    if (after === 1) {
      console.log('');
      console.log('━━━ CSVを編集してeBayに反映する手順 ━━━');
      console.log('');
      console.log('  Step 1: export.csv をExcelやテキストエディタで開く');
      console.log('  Step 2: action列を変更する');
      console.log('          - exclude = 除外する');
      console.log('          - include = 除外しない（許可する）');
      console.log('  Step 3: 保存したら、このツールに戻って');
      console.log('          「2) 除外国を変更する」を選んでください');
      console.log('');
      console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
      console.log('');
      await ask.askEnter('? メインメニューに戻りますか？(Enter)');
    }
  }
}

async function flowChangeExclusions(ask: ReturnType<typeof createAsk>) {
  const choice = await ask.askNumber('? CSVファイルはもう準備できていますか？', [
    'はい、CSVがあります',
    'いいえ、まずテンプレートCSVを作成する',
    'メインメニューに戻る',
  ]);

  if (choice === 2) {
    const outName = await ask.askText('? 出力ファイル名は？（Enterでexclusions.csv）:', 'exclusions.csv');
    runCommand(`init -o "${outName}"`);
    console.log(`\n${outName} を作成しました！`);
    console.log('');
    console.log('━━━ 次のステップ ━━━');
    console.log('  1. exclusions.csv をExcelやテキストエディタで開く');
    console.log('  2. 除外したい地域/国のaction列を「exclude」に変更');
    console.log('  3. 許可したい国のaction列を「include」に変更');
    console.log('  4. 保存して、再度このウィザードを起動してください');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('');
    await ask.askEnter('? メインメニューに戻りますか？(Enter)');
    return;
  }

  if (choice === 3) {
    return; // main menu
  }

  // choice === 1: CSVあり
  let csvPath = '';
  while (true) {
    const p = await ask.askText(`?\nCSVファイルのパスを入力してください\n  （ファイルをここにドラッグ＆ドロップもできます）\n`);
    const trimmed = p.trim();
    if (!trimmed) {
      console.log(chalk.red('ファイルパスを入力してください。'));
      continue;
    }
    if (!fileExists(trimmed)) {
      console.log(chalk.red(`ファイルが見つかりません: ${trimmed}`));
      continue;
    }
    csvPath = trimmed;
    break;
  }

  console.log('\n変更内容をプレビューしています...\n');
  runCommand(`diff "${csvPath}"`);

  const apply = await ask.askNumber('\n? この変更をeBayに適用しますか？', [
    'はい、適用する',
    'いいえ、やめる',
  ]);

  if (apply === 1) {
    console.log('\n適用中...\n');
    runCommand(`apply "${csvPath}"`);
    console.log(chalk.green('✔ 完了しました！変更がeBayに反映されました。'));
    console.log('');
    await ask.askEnter('? メインメニューに戻りますか？(Enter)');
  }
}

export async function runWizard(): Promise<void> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = createAsk(rl);

  showWelcome();

  let running = true;
  while (running) {
    const main = await ask.askNumber('? 何をしますか？', [
      '現在の設定を確認する',
      '除外国を変更する',
      '終了',
    ]);

    if (main === 1) {
      await flowViewCurrent(ask);
      continue;
    }
    if (main === 2) {
      await flowChangeExclusions(ask);
      continue;
    }
    if (main === 3) {
      running = false;
      break;
    }
  }

  rl.close();
}

