import axios from 'axios';
import * as cheerio from 'cheerio';
import * as fs from 'fs/promises';
import { createWriteStream } from 'fs';
import * as path from 'path';
import { pipeline } from 'stream/promises';

export interface PatternData {
  title: string;
  description: string;
  materials: string[];
  instructions: string[];
  sourceUrl: string;
  localImages: string[];
  localPdfs: string[];
}

export interface ScrapeRunOptions {
  urls: string[];
  outputPath: string;
  workingDirectory?: string;
  logger?: (message: string) => void;
  preset?: SelectorPresetId;
  selectorOverrides?: SelectorOverrides;
  profileId?: string;
  profilesPath?: string;
  crawl?: CrawlOptions;
}

export interface ScrapeRunResult {
  scrapedCount: number;
  skippedCount: number;
  failedCount: number;
  outputPath: string;
  outputDirectory: string;
  patterns: PatternData[];
  preset: SelectorPresetId;
  selectorOverrides?: SelectorOverrides;
  profileId?: string;
  profileLabel?: string;
  discoveredUrlCount?: number;
}

export interface CrawlOptions {
  enabled?: boolean;
  maxDepth?: number;
  sameDomainOnly?: boolean;
  linkPattern?: string;
  maxDiscoveredUrls?: number;
  language?: string;
  paginate?: boolean;
  maxPaginationPages?: number;
}

export interface SelectorOverrides {
  titleSelector?: string;
  descriptionSelector?: string;
  materialsSelector?: string;
  instructionsSelector?: string;
  imageSelector?: string;
}

export interface SiteProfile {
  id: string;
  label: string;
  description?: string;
  preset?: SelectorPresetId;
  selectorOverrides?: SelectorOverrides;
}

interface SiteProfileFile {
  profiles?: SiteProfile[];
}

interface SelectorPreset {
  id: SelectorPresetId;
  label: string;
  description: string;
  titleSelectors: string[];
  descriptionSelectors: string[];
  materialsSelectors: string[];
  instructionsSelectors: string[];
  imageSelectors: string[];
}

interface ResolvedSelectors {
  titleSelectors: string[];
  descriptionSelectors: string[];
  materialsSelectors: string[];
  instructionsSelectors: string[];
  imageSelectors: string[];
}

interface ResolvedStrategy {
  presetId: SelectorPresetId;
  preset: SelectorPreset;
  selectorOverrides?: SelectorOverrides;
  profileId?: string;
  profileLabel?: string;
}

export interface PreviewOptions {
  url: string;
  preset?: SelectorPresetId;
  selectorOverrides?: SelectorOverrides;
  profileId?: string;
  profilesPath?: string;
}

export interface PreviewResult {
  title: string;
  description: string;
  materials: string[];
  instructions: string[];
  imageUrls: string[];
  pdfUrls: string[];
  preset: SelectorPresetId;
  presetLabel: string;
  selectorOverrides?: SelectorOverrides;
  profileId?: string;
  profileLabel?: string;
}

export interface SelectorHealthSummary {
  missingDescriptionCount: number;
  missingMaterialsCount: number;
  missingInstructionsCount: number;
  missingImagesCount: number;
}

export type SelectorPresetId = 'generic' | 'wordpress' | 'woocommerce';

const REQUEST_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
};
const REQUEST_TIMEOUT_MS = 15000;
const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp', '.avif']);
const DEFAULT_DELAY_MS = 2000;
const DEFAULT_CRAWL_MAX_DEPTH = 2;
const DEFAULT_CRAWL_MAX_URLS = 100;
const DEFAULT_CRAWL_MAX_PAGINATION_PAGES = 20;
export const DEFAULT_PROFILES_FILE = 'sugarstitch.profiles.json';

const SELECTOR_PRESETS: Record<SelectorPresetId, SelectorPreset> = {
  generic: {
    id: 'generic',
    label: 'Generic / Custom',
    description: 'A broad default for custom sites and general article-style pattern pages.',
    titleSelectors: ['h1'],
    descriptionSelectors: ['.entry-content p', '.post-content p', '.article-body p', 'main p'],
    materialsSelectors: ['.materials-list li', '.pattern-materials li', '.supply-list li'],
    instructionsSelectors: ['.instructions-step', '.instruction-step', '.pattern-steps li', 'ol li'],
    imageSelectors: ['.entry-content img', '.post-content img', '.article-body img', 'main img']
  },
  wordpress: {
    id: 'wordpress',
    label: 'WordPress Article',
    description: 'Best for blog-style posts using common WordPress article wrappers.',
    titleSelectors: ['h1.entry-title', 'article h1', 'h1'],
    descriptionSelectors: ['.entry-content p', '.wp-block-post-content p', '.post-content p'],
    materialsSelectors: ['.entry-content ul li', '.wp-block-post-content ul li', '.materials-list li'],
    instructionsSelectors: ['.entry-content ol li', '.wp-block-post-content ol li', '.instructions-step'],
    imageSelectors: ['.entry-content img', '.wp-block-post-content img', '.post-content img']
  },
  woocommerce: {
    id: 'woocommerce',
    label: 'WooCommerce Product',
    description: 'Best for WooCommerce product pages with product galleries and description areas.',
    titleSelectors: ['.product_title', '.entry-summary h1', 'h1.product_title', 'h1'],
    descriptionSelectors: [
      '.woocommerce-product-details__short-description p',
      '.woocommerce-Tabs-panel--description p',
      '.entry-summary p'
    ],
    materialsSelectors: [
      '.woocommerce-Tabs-panel--description ul li',
      '.woocommerce-Tabs-panel ul li',
      '.product_meta + div ul li'
    ],
    instructionsSelectors: [
      '.woocommerce-Tabs-panel--description ol li',
      '.woocommerce-Tabs-panel ol li',
      '.instruction-step'
    ],
    imageSelectors: ['.woocommerce-product-gallery img', '.images img', '.woocommerce-product-gallery__image img']
  }
};

function defaultLogger(message: string): void {
  console.log(message);
}

export function sanitizeFilename(name: string): string {
  const sanitized = name
    .replace(/[^a-z0-9]/gi, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toLowerCase();

  return sanitized || 'untitled_pattern';
}

export function normalizeUrl(input: string): string | null {
  try {
    const url = new URL(input.trim());
    return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

export function dedupeStrings(items: string[]): string[] {
  return [...new Set(items)];
}

export function getSelectorPresets(): SelectorPreset[] {
  return Object.values(SELECTOR_PRESETS);
}

export function isSelectorPresetId(value: string): value is SelectorPresetId {
  return value in SELECTOR_PRESETS;
}

export function getSelectorPreset(presetId: SelectorPresetId = 'generic'): SelectorPreset {
  return SELECTOR_PRESETS[presetId];
}

export async function loadSiteProfiles(profilesPath: string = path.resolve(process.cwd(), DEFAULT_PROFILES_FILE)): Promise<SiteProfile[]> {
  try {
    const fileContent = await fs.readFile(profilesPath, 'utf-8');
    const parsed = JSON.parse(fileContent) as SiteProfileFile;

    if (!Array.isArray(parsed.profiles)) {
      throw new Error('Profiles file must contain a "profiles" array.');
    }

    return parsed.profiles.map(profile => {
      if (!profile?.id || !profile?.label) {
        throw new Error('Each profile must include both "id" and "label".');
      }

      if (profile.preset && !isSelectorPresetId(profile.preset)) {
        throw new Error(`Profile "${profile.id}" references unknown preset "${profile.preset}".`);
      }

      return {
        id: profile.id,
        label: profile.label,
        description: profile.description,
        preset: profile.preset ?? 'generic',
        selectorOverrides: sanitizeSelectorOverrides(profile.selectorOverrides)
      };
    });
  } catch (error: any) {
    if (error?.code === 'ENOENT') {
      return [];
    }

    if (error instanceof SyntaxError) {
      throw new Error(`Profiles file contains invalid JSON: ${error.message}`);
    }

    throw error;
  }
}

export function sanitizeSelectorOverrides(overrides?: SelectorOverrides): SelectorOverrides | undefined {
  if (!overrides) return undefined;

  const cleaned: SelectorOverrides = {};

  for (const [key, value] of Object.entries(overrides)) {
    const trimmed = value?.trim();
    if (trimmed) {
      cleaned[key as keyof SelectorOverrides] = trimmed;
    }
  }

  return Object.keys(cleaned).length > 0 ? cleaned : undefined;
}

function resolveSelectors(preset: SelectorPreset, overrides?: SelectorOverrides): ResolvedSelectors {
  const cleanedOverrides = sanitizeSelectorOverrides(overrides);

  return {
    titleSelectors: cleanedOverrides?.titleSelector ? [cleanedOverrides.titleSelector, ...preset.titleSelectors] : preset.titleSelectors,
    descriptionSelectors: cleanedOverrides?.descriptionSelector ? [cleanedOverrides.descriptionSelector, ...preset.descriptionSelectors] : preset.descriptionSelectors,
    materialsSelectors: cleanedOverrides?.materialsSelector ? [cleanedOverrides.materialsSelector, ...preset.materialsSelectors] : preset.materialsSelectors,
    instructionsSelectors: cleanedOverrides?.instructionsSelector ? [cleanedOverrides.instructionsSelector, ...preset.instructionsSelectors] : preset.instructionsSelectors,
    imageSelectors: cleanedOverrides?.imageSelector ? [cleanedOverrides.imageSelector, ...preset.imageSelectors] : preset.imageSelectors
  };
}

async function resolveStrategy(options: {
  preset?: SelectorPresetId;
  selectorOverrides?: SelectorOverrides;
  profileId?: string;
  profilesPath?: string;
}): Promise<ResolvedStrategy> {
  const profilesPath = options.profilesPath ?? path.resolve(process.cwd(), DEFAULT_PROFILES_FILE);
  const availableProfiles = await loadSiteProfiles(profilesPath);

  if (options.profileId) {
    const profile = availableProfiles.find(item => item.id === options.profileId);

    if (!profile) {
      throw new Error(`Unknown profile "${options.profileId}" in ${profilesPath}.`);
    }

    const profilePresetId = profile.preset ?? 'generic';

    return {
      presetId: profilePresetId,
      preset: getSelectorPreset(profilePresetId),
      selectorOverrides: sanitizeSelectorOverrides({
        ...profile.selectorOverrides,
        ...options.selectorOverrides
      }),
      profileId: profile.id,
      profileLabel: profile.label
    };
  }

  const presetId = options.preset ?? 'generic';

  return {
    presetId,
    preset: getSelectorPreset(presetId),
    selectorOverrides: sanitizeSelectorOverrides(options.selectorOverrides)
  };
}

export async function loadExistingData(outputPath: string): Promise<PatternData[]> {
  try {
    const fileContent = await fs.readFile(outputPath, 'utf-8');
    const parsed = JSON.parse(fileContent);

    if (!Array.isArray(parsed)) {
      throw new Error('Output file must contain a JSON array.');
    }

    return parsed as PatternData[];
  } catch (error: any) {
    if (error?.code === 'ENOENT') {
      return [];
    }

    if (error instanceof SyntaxError) {
      throw new Error(`Output file contains invalid JSON: ${error.message}`);
    }

    throw error;
  }
}

function getImageExtension(fileUrl: string): string {
  try {
    const pathname = new URL(fileUrl).pathname;
    const ext = path.extname(pathname).toLowerCase();
    return IMAGE_EXTENSIONS.has(ext) ? ext : '.jpg';
  } catch {
    return '.jpg';
  }
}

async function downloadFile(url: string, dest: string, logger: (message: string) => void): Promise<boolean> {
  try {
    const response = await axios.get(url, {
      responseType: 'stream',
      headers: REQUEST_HEADERS,
      timeout: REQUEST_TIMEOUT_MS
    });
    await pipeline(response.data, createWriteStream(dest));
    return true;
  } catch (error: any) {
    logger(`\n❌ Shit, couldn't download file ${url}: ${error.message}`);
    return false;
  }
}

async function fetchHtml(url: string): Promise<string> {
  const { data } = await axios.get(url, {
    headers: REQUEST_HEADERS,
    timeout: REQUEST_TIMEOUT_MS
  });

  return data;
}

function shouldSkipHref(href: string): boolean {
  const normalized = href.trim().toLowerCase();

  return (
    normalized.length === 0 ||
    normalized.startsWith('#') ||
    normalized.startsWith('mailto:') ||
    normalized.startsWith('tel:') ||
    normalized.startsWith('javascript:')
  );
}

function normalizeLanguageValue(value?: string): string | undefined {
  const normalized = value?.trim().toLowerCase();
  return normalized ? normalized : undefined;
}

function detectLanguageFromUrl(url: URL): string | undefined {
  const langParam = url.searchParams.get('lang')?.trim().toLowerCase();
  if (langParam) return langParam;

  const pathname = url.pathname.toLowerCase();
  if (pathname.includes('french')) return 'french';
  if (pathname.includes('portuguese')) return 'portuguese';
  if (pathname.includes('english')) return 'english';

  return undefined;
}

function matchesLanguage(url: URL, language?: string): boolean {
  const normalizedLanguage = normalizeLanguageValue(language);
  if (!normalizedLanguage) return true;

  const detectedLanguage = detectLanguageFromUrl(url);
  if (!detectedLanguage) return true;

  return detectedLanguage === normalizedLanguage;
}

function looksLikeHtmlPage(url: URL): boolean {
  const pathname = url.pathname.toLowerCase();

  if (pathname.endsWith('.pdf')) return false;

  const ext = path.extname(pathname);
  return ext === '' || ['.html', '.htm', '.php', '.asp', '.aspx'].includes(ext);
}

function detectMaxPaginationPages($: cheerio.CheerioAPI): number | undefined {
  const dataPages = $('.jet-listing-grid__items[data-pages]').first().attr('data-pages');
  const parsedDataPages = dataPages ? Number.parseInt(dataPages, 10) : Number.NaN;
  if (Number.isFinite(parsedDataPages) && parsedDataPages > 1) {
    return parsedDataPages;
  }

  let maxPage = 1;
  $('a[href*="/page/"]').each((_, el) => {
    const href = $(el).attr('href');
    if (!href) return;
    const match = href.match(/\/page\/(\d+)\//i);
    if (!match) return;
    const page = Number.parseInt(match[1], 10);
    if (Number.isFinite(page)) {
      maxPage = Math.max(maxPage, page);
    }
  });

  return maxPage > 1 ? maxPage : undefined;
}

function buildPaginatedUrl(seedUrl: string, pageNumber: number): string {
  const parsed = new URL(seedUrl);
  const segments = parsed.pathname.replace(/\/+$/, '').split('/').filter(Boolean);

  if (segments[segments.length - 2] === 'page') {
    segments[segments.length - 1] = String(pageNumber);
  } else {
    segments.push('page', String(pageNumber));
  }

  parsed.pathname = `/${segments.join('/')}/`;
  return parsed.href;
}

async function expandPaginatedSeedUrls(startUrls: string[], logger: (message: string) => void, crawl?: CrawlOptions): Promise<string[]> {
  if (!crawl?.enabled || !crawl.paginate) {
    return startUrls;
  }

  const maxPaginationPages = Math.max(1, crawl.maxPaginationPages ?? DEFAULT_CRAWL_MAX_PAGINATION_PAGES);
  const expanded = new Set<string>(startUrls);

  for (const startUrl of startUrls) {
    let html: string;
    try {
      html = await fetchHtml(startUrl);
    } catch (error: any) {
      logger(`⚠️ Couldn't inspect pagination for ${startUrl}: ${error.message}`);
      continue;
    }

    const $ = cheerio.load(html);
    const detectedMaxPages = detectMaxPaginationPages($);
    if (!detectedMaxPages || detectedMaxPages <= 1) {
      continue;
    }

    const pageLimit = Math.min(detectedMaxPages, maxPaginationPages);
    logger(`📚 Pagination detected. Adding listing pages 2 through ${pageLimit} for ${startUrl}`);

    for (let page = 2; page <= pageLimit; page++) {
      expanded.add(buildPaginatedUrl(startUrl, page));
    }
  }

  return [...expanded];
}

async function discoverUrls(startUrls: string[], logger: (message: string) => void, crawl?: CrawlOptions): Promise<string[]> {
  if (!crawl?.enabled) {
    return startUrls;
  }

  const maxDepth = Math.max(0, crawl.maxDepth ?? DEFAULT_CRAWL_MAX_DEPTH);
  const sameDomainOnly = crawl.sameDomainOnly ?? true;
  const maxDiscoveredUrls = Math.max(1, crawl.maxDiscoveredUrls ?? DEFAULT_CRAWL_MAX_URLS);
  const language = normalizeLanguageValue(crawl.language);
  const linkPattern = crawl.linkPattern?.trim();
  const patternRegex = linkPattern ? new RegExp(linkPattern, 'i') : null;
  const queue: Array<{ url: string; depth: number; rootHost: string }> = [];
  const visited = new Set<string>();
  const discovered = new Set<string>();
  const seedUrls = await expandPaginatedSeedUrls(startUrls, logger, crawl);

  for (const startUrl of seedUrls) {
    const parsed = new URL(startUrl);
    if (!matchesLanguage(parsed, language)) continue;
    queue.push({ url: startUrl, depth: 0, rootHost: parsed.host });
    discovered.add(startUrl);
  }

  logger(`\n🕸️ Crawl mode is on. Exploring up to ${maxDepth} link level(s) deep...`);

  while (queue.length > 0 && discovered.size < maxDiscoveredUrls) {
    const current = queue.shift()!;
    if (visited.has(current.url)) continue;
    visited.add(current.url);

    logger(`🔎 Discovering links at depth ${current.depth}: ${current.url}`);

    let html: string;
    try {
      html = await fetchHtml(current.url);
    } catch (error: any) {
      logger(`⚠️ Couldn't crawl ${current.url}: ${error.message}`);
      continue;
    }

    const $ = cheerio.load(html);
    $('a').each((_, el) => {
      if (discovered.size >= maxDiscoveredUrls) return;

      const href = $(el).attr('href');
      if (!href || shouldSkipHref(href)) return;

      try {
        const absolute = new URL(href, current.url);
        if (!['http:', 'https:'].includes(absolute.protocol)) return;
        if (sameDomainOnly && absolute.host !== current.rootHost) return;
        if (!matchesLanguage(absolute, language)) return;
        if (!looksLikeHtmlPage(absolute)) return;
        const normalized = absolute.href;
        const matchesPattern = !patternRegex || patternRegex.test(normalized) || patternRegex.test($(el).text().trim());
        if (!matchesPattern) return;
        if (discovered.has(normalized)) return;

        discovered.add(normalized);

        if (current.depth < maxDepth) {
          queue.push({ url: normalized, depth: current.depth + 1, rootHost: current.rootHost });
        }
      } catch {}
    });

    if (queue.length > 0) {
      await sleep(500);
    }
  }

  logger(`✨ Discovery finished. Found ${discovered.size} page URL(s) to scrape.`);
  return [...discovered];
}

function firstTextMatch($: cheerio.CheerioAPI, selectors: string[], fallback: string): string {
  for (const selector of selectors) {
    const text = $(selector).first().text().trim();
    if (text) return text;
  }

  return fallback;
}

function collectTextMatches($: cheerio.CheerioAPI, selectors: string[]): string[] {
  for (const selector of selectors) {
    const values: string[] = [];

    $(selector).each((_, el) => {
      const value = $(el).text().trim();
      if (value) values.push(value);
    });

    if (values.length > 0) {
      return dedupeStrings(values);
    }
  }

  return [];
}

function collectAssetUrls($: cheerio.CheerioAPI, selectors: string[], pageUrl: string): string[] {
  for (const selector of selectors) {
    const urls: string[] = [];

    $(selector).each((_, el) => {
      const src = $(el).attr('src');
      if (!src) return;

      try {
        const absoluteUrl = new URL(src, pageUrl).href;
        if (!absoluteUrl.includes('logo') && !absoluteUrl.includes('icon')) {
          urls.push(absoluteUrl);
        }
      } catch {}
    });

    if (urls.length > 0) {
      return dedupeStrings(urls);
    }
  }

  return [];
}

async function extractPatternPreview(
  url: string,
  logger: (message: string) => void,
  strategy: ResolvedStrategy
): Promise<PreviewResult> {
  logger(`\n💖 Purring along... Fetching data from: ${url}`);
  logger(`🪡 Using selector preset: ${strategy.preset.label}`);
  if (strategy.profileLabel) {
    logger(`🧁 Loaded site profile: ${strategy.profileLabel}`);
  }
  if (strategy.selectorOverrides) {
    logger('🧷 Advanced selector overrides are active for this run.');
  }

  const { data } = await axios.get(url, {
    headers: REQUEST_HEADERS,
    timeout: REQUEST_TIMEOUT_MS
  });

  const $ = cheerio.load(data);
  const selectors = resolveSelectors(strategy.preset, strategy.selectorOverrides);
  const title = firstTextMatch($, selectors.titleSelectors, 'Untitled Pattern');
  const description = firstTextMatch($, selectors.descriptionSelectors, 'No description found.');
  const materials = collectTextMatches($, selectors.materialsSelectors);
  const instructions = collectTextMatches($, selectors.instructionsSelectors);
  const imageUrls = collectAssetUrls($, selectors.imageSelectors, url);

  const pdfUrls: string[] = [];
  $('a').each((_, el) => {
    const href = $(el).attr('href');
    if (!href || !href.toLowerCase().includes('.pdf')) return;

    try {
      const absoluteUrl = new URL(href, url).href;
      pdfUrls.push(absoluteUrl);
    } catch {}
  });

  return {
    title,
    description,
    materials,
    instructions,
    imageUrls,
    pdfUrls: dedupeStrings(pdfUrls),
    preset: strategy.presetId,
    presetLabel: strategy.preset.label,
    selectorOverrides: strategy.selectorOverrides,
    profileId: strategy.profileId,
    profileLabel: strategy.profileLabel
  };
}

async function scrapePattern(
  url: string,
  workingDirectory: string,
  logger: (message: string) => void,
  strategy: ResolvedStrategy
): Promise<PatternData | null> {
  try {
    const preview = await extractPatternPreview(url, logger, strategy);
    const uniqueImageUrls = dedupeStrings(preview.imageUrls);
    const uniquePdfUrls = dedupeStrings(preview.pdfUrls);
    const safeTitle = sanitizeFilename(preview.title);
    const localImages: string[] = [];
    const localPdfs: string[] = [];

    if (uniqueImageUrls.length > 0) {
      const imageDir = path.resolve(workingDirectory, 'images', safeTitle);
      await fs.mkdir(imageDir, { recursive: true });
      logger(`✨ Found ${uniqueImageUrls.length} images! Downloading to ./images/${safeTitle}/...`);

      for (let i = 0; i < uniqueImageUrls.length; i++) {
        const imgUrl = uniqueImageUrls[i];
        const ext = getImageExtension(imgUrl);
        const filename = `image_${i + 1}${ext}`;
        const destPath = path.resolve(imageDir, filename);

        if (await downloadFile(imgUrl, destPath, logger)) {
          localImages.push(`images/${safeTitle}/${filename}`);
        }
      }
    }

    if (uniquePdfUrls.length > 0) {
      const pdfDir = path.resolve(workingDirectory, 'pdfs', safeTitle);
      await fs.mkdir(pdfDir, { recursive: true });
      logger(`📄 Holy shit, found ${uniquePdfUrls.length} PDFs! Downloading to ./pdfs/${safeTitle}/...`);

      for (let i = 0; i < uniquePdfUrls.length; i++) {
        const pdfUrl = uniquePdfUrls[i];
        let filename = path.basename(new URL(pdfUrl).pathname);
        if (!filename.toLowerCase().endsWith('.pdf')) filename = `pattern_${i + 1}.pdf`;

        const destPath = path.resolve(pdfDir, filename);

        if (await downloadFile(pdfUrl, destPath, logger)) {
          localPdfs.push(`pdfs/${safeTitle}/${filename}`);
        }
      }
    }

    return {
      title: preview.title,
      description: preview.description,
      materials: preview.materials,
      instructions: preview.instructions,
      sourceUrl: url,
      localImages,
      localPdfs
    };
  } catch (error: any) {
    logger(`\n❌ Ah shit, something broke while fetching the URL: ${error.message}`);
    return null;
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

export async function previewPattern(options: PreviewOptions, logger: (message: string) => void = defaultLogger): Promise<PreviewResult> {
  const normalizedUrl = normalizeUrl(options.url);

  if (!normalizedUrl) {
    throw new Error(`That doesn't look like a valid URL: ${options.url}`);
  }

  const strategy = await resolveStrategy({
    preset: options.preset,
    selectorOverrides: options.selectorOverrides,
    profileId: options.profileId,
    profilesPath: options.profilesPath
  });

  return extractPatternPreview(normalizedUrl, logger, strategy);
}

export async function scrapeUrls(options: ScrapeRunOptions): Promise<ScrapeRunResult> {
  const logger = options.logger ?? defaultLogger;
  const workingDirectory = options.workingDirectory ?? process.cwd();
  const strategy = await resolveStrategy({
    preset: options.preset,
    selectorOverrides: options.selectorOverrides,
    profileId: options.profileId,
    profilesPath: options.profilesPath
  });
  const startingUrls = dedupeStrings(
    options.urls
      .map(normalizeUrl)
      .filter((url): url is string => Boolean(url))
  );

  if (startingUrls.length === 0) {
    throw new Error('No valid http(s) URLs were provided.');
  }

  const normalizedUrls = await discoverUrls(startingUrls, logger, options.crawl);

  const existingData = await loadExistingData(options.outputPath);
  const knownSourceUrls = new Set(existingData.map(item => item.sourceUrl));
  const newPatterns: PatternData[] = [];
  let skippedCount = 0;
  let failedCount = 0;

  for (let i = 0; i < normalizedUrls.length; i++) {
    const currentUrl = normalizedUrls[i];
    logger(`\n======================================================`);
    logger(`🧵 Scraping pattern ${i + 1} of ${normalizedUrls.length}`);
    logger(`======================================================`);

    if (knownSourceUrls.has(currentUrl)) {
      skippedCount += 1;
      logger(`⚠️ Already scraped ${currentUrl}. Skipping before download to save time.`);
      continue;
    }

    const data = await scrapePattern(currentUrl, workingDirectory, logger, strategy);

    if (!data) {
      failedCount += 1;
    } else if (!knownSourceUrls.has(data.sourceUrl)) {
      existingData.push(data);
      newPatterns.push(data);
      knownSourceUrls.add(data.sourceUrl);
      await fs.writeFile(options.outputPath, JSON.stringify(existingData, null, 2), 'utf-8');
      logger(`✨ Badass! Appended data to ${path.basename(options.outputPath)} 🧁`);
    } else {
      skippedCount += 1;
      logger(`⚠️ Looks like we already have the data for "${data.title}". Skipping JSON append to keep it clean.`);
    }

    if (i < normalizedUrls.length - 1) {
      logger(`\n⏳ Taking a quick 2-second breather so we don't get blocked...`);
      await sleep(DEFAULT_DELAY_MS);
    }
  }

  logger(`\n🎉 All done! Your data is ready to roll. You crushed it.`);

  return {
    scrapedCount: newPatterns.length,
    skippedCount,
    failedCount,
    outputPath: options.outputPath,
    outputDirectory: workingDirectory,
    patterns: newPatterns,
    preset: strategy.presetId,
    selectorOverrides: strategy.selectorOverrides,
    profileId: strategy.profileId,
    profileLabel: strategy.profileLabel,
    discoveredUrlCount: normalizedUrls.length
  };
}
