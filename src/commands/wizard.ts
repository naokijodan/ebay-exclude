import * as readline from 'readline';
import chalk from 'chalk';
import { execSync } from 'child_process';
import * as path from 'path';
import * as fs from 'fs';

// メインメニュー表示
function showMenu(): void {
  console.log('');
  console.log(chalk.cyan('========================================'));
  console.log(chalk.cyan.bold('  ebay-exclude 操作メニュー'));
  console.log(chalk.cyan('========================================'));
  console.log('');
  console.log('  1. ポリシー一覧を表示');
  console.log('  2. 現在の除外設定をCSVに出力');
  console.log('  3. CSVの変更をプレビュー（diff）');
  console.log('  4. CSVをeBayに適用');
  console.log('  5. テンプレートCSVを作成');
  console.log('');
  console.log('  q. 終了');
  console.log(chalk.cyan('----------------------------------------'));
}

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

function fileExists(filePath: string): boolean {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

async function handleList(): Promise<void> {
  runCommand('list');
}

async function handleExport(ask: (q: string) => Promise<string>): Promise<void> {
  const name = await ask('出力ファイル名を入力（デフォルト: export.csv）: ');
  const out = name.trim() || 'export.csv';
  runCommand(`export -o "${out}"`);
  console.log(chalk.green(`\nCSVを保存しました: ${out}`));
}

async function handleDiff(ask: (q: string) => Promise<string>): Promise<void> {
  const csvPath = await ask('CSVファイルのパスを入力: ');
  const trimmed = csvPath.trim();
  if (!trimmed) {
    console.log(chalk.red('ファイルパスが空です'));
    return;
  }
  if (!fileExists(trimmed)) {
    console.log(chalk.red(`ファイルが見つかりません: ${trimmed}`));
    return;
  }
  runCommand(`diff "${trimmed}"`);
}

async function handleApply(ask: (q: string) => Promise<string>): Promise<void> {
  const csvPath = await ask('CSVファイルのパスを入力: ');
  const trimmed = csvPath.trim();
  if (!trimmed) {
    console.log(chalk.red('ファイルパスが空です'));
    return;
  }
  if (!fileExists(trimmed)) {
    console.log(chalk.red(`ファイルが見つかりません: ${trimmed}`));
    return;
  }

  console.log(chalk.cyan('\nドライランで確認中...\n'));
  runCommand(`apply --dry-run "${trimmed}"`);

  const confirm = await ask('\n本当にeBayに適用しますか？ (y/N): ');
  if (confirm.trim().toLowerCase() === 'y') {
    console.log(chalk.cyan('\n適用中...\n'));
    runCommand(`apply "${trimmed}"`);
    console.log(chalk.green('\n適用が完了しました'));
  } else {
    console.log(chalk.yellow('キャンセルしました'));
  }
}

async function handleInit(ask: (q: string) => Promise<string>): Promise<void> {
  const name = await ask('出力ファイル名を入力（デフォルト: exclusions.csv）: ');
  const out = name.trim() || 'exclusions.csv';
  runCommand(`init -o "${out}"`);
}

export async function runWizard(): Promise<void> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const ask = (question: string): Promise<string> =>
    new Promise((resolve) => rl.question(question, resolve));

  console.log(chalk.green.bold('\nebay-exclude ウィザードを起動しました'));
  console.log(chalk.gray('eBay発送除外国を簡単に管理できます\n'));

  let running = true;
  while (running) {
    showMenu();
    const choice = await ask('番号を入力: ');

    switch (choice.trim()) {
      case '1':
        await handleList();
        break;
      case '2':
        await handleExport(ask);
        break;
      case '3':
        await handleDiff(ask);
        break;
      case '4':
        await handleApply(ask);
        break;
      case '5':
        await handleInit(ask);
        break;
      case 'q':
      case 'Q':
        running = false;
        break;
      default:
        console.log(chalk.red('無効な番号です。1-5またはqを入力してください。'));
    }
  }

  console.log(chalk.green('\nお疲れさまでした！'));
  rl.close();
}

