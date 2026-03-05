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
    '全ポリシーの除外設定をExcelに出力する',
    'メインメニューに戻る',
  ]);

  if (next === 1) {
    const name = 'ebay-policies.xlsx';
    runCommand(`export-all -o "${name}"`);
    console.log(`\n${name} に保存しました！`);
    await ask.askEnter('? メインメニューに戻りますか？(Enter)');
  }
}

async function flowChangeExclusions(ask: ReturnType<typeof createAsk>) {
  const choice = await ask.askNumber('? Excelファイルはもう準備できていますか？', [
    'はい、編集済みのExcelがあります',
    'いいえ、まず現在の設定をExcelに出力する',
    'メインメニューに戻る',
  ]);

  if (choice === 2) {
    const name = 'ebay-policies.xlsx';
    runCommand(`export-all -o "${name}"`);
    console.log(`\n${name} に保存しました！`);
    await ask.askEnter('? メインメニューに戻りますか？(Enter)');
    return;
  }

  if (choice === 3) {
    return; // main menu
  }

  // choice === 1: Excelあり
  let xlsxPath = '';
  while (true) {
    const p = await ask.askText(`?\nExcelファイルのパスを入力してください\n  （ファイルをここにドラッグ＆ドロップもできます）\n`);
    const trimmed = p.trim();
    if (!trimmed) {
      console.log(chalk.red('ファイルパスを入力してください。'));
      continue;
    }
    if (!fileExists(trimmed)) {
      console.log(chalk.red(`ファイルが見つかりません: ${trimmed}`));
      continue;
    }
    xlsxPath = trimmed;
    break;
  }

  console.log('\n変更内容をプレビューしています...\n');
  runCommand(`import-all --dry-run "${xlsxPath}"`);

  const apply = await ask.askNumber('\n? この変更をeBayに適用しますか？', [
    'はい、適用する',
    'いいえ、やめる',
  ]);

  if (apply === 1) {
    console.log('\n適用中...\n');
    runCommand(`import-all "${xlsxPath}"`);
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
