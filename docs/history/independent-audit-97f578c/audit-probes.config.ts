import { defineConfig } from '@playwright/test';
import base from './playwright.config';

export default defineConfig({ ...base, testDir: './audit-probes', outputDir: './audit-probes-results', reporter: [['list'], ['json', { outputFile: 'audit-probes-results.json' }]] });
