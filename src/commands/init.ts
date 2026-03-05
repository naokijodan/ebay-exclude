import path from 'path';
import fs from 'fs';
import chalk from 'chalk';
import { generateTemplate } from '../lib/csv-handler';

export async function initCommand(outputPath?: string) {
  const target = path.resolve(process.cwd(), outputPath || 'exclusions.csv');
  if (fs.existsSync(target)) {
    console.log(chalk.yellow(`File already exists: ${target}`));
  }
  generateTemplate(target);
  console.log(chalk.green(`Template CSV generated at: ${target}`));
}

