# Overview

## Purpose

SugarStitch is a local-first Node/TypeScript scraper for sewing pattern websites. It is designed to support three main workflows:

- scrape one known pattern page
- scrape many known pattern pages from a list
- start from a listing page, discover child links, and scrape the discovered pattern pages

The project deliberately supports both a command-line interface and a simple browser UI so the same scraping engine can be used by technical and non-technical users.

## Core Architecture

The project is split into three main layers:

1. Shared scraping engine
   File: [`src/scraper.ts`](/home/sizzlebop/PINKPIXEL/PROJECTS/CURRENT/sugarstitch/src/scraper.ts)

2. CLI wrapper
   File: [`src/index.ts`](/home/sizzlebop/PINKPIXEL/PROJECTS/CURRENT/sugarstitch/src/index.ts)

3. Local browser UI
   File: [`src/server.ts`](/home/sizzlebop/PINKPIXEL/PROJECTS/CURRENT/sugarstitch/src/server.ts)

The scraper layer owns all real scraping behavior. The CLI and UI are both thin wrappers around that shared logic.

## File Map

- [`src/scraper.ts`](/home/sizzlebop/PINKPIXEL/PROJECTS/CURRENT/sugarstitch/src/scraper.ts)
  Shared types, selector presets, saved profile loading, preview logic, discovery crawl logic, page scraping, downloads, and JSON append behavior.

- [`src/index.ts`](/home/sizzlebop/PINKPIXEL/PROJECTS/CURRENT/sugarstitch/src/index.ts)
  CLI argument parsing, URL source handling, output path resolution, and handoff into the shared scraper.

- [`src/server.ts`](/home/sizzlebop/PINKPIXEL/PROJECTS/CURRENT/sugarstitch/src/server.ts)
  Small Node HTTP server that renders the HTML UI, handles form posts, runs preview/scrape requests, and returns summary/result pages.

- [`sugarstitch.profiles.json`](/home/sizzlebop/PINKPIXEL/PROJECTS/CURRENT/sugarstitch/sugarstitch.profiles.json)
  Starter saved profile config file. This is not required, but the UI and CLI know how to load profiles from it by default.

- [`scripts/add-shebang.js`](/home/sizzlebop/PINKPIXEL/PROJECTS/CURRENT/sugarstitch/scripts/add-shebang.js)
  Adds a Node shebang to the built CLI entrypoint after TypeScript compilation.

- [`package.json`](/home/sizzlebop/PINKPIXEL/PROJECTS/CURRENT/sugarstitch/package.json)
  Package metadata, scripts, executable `bin` entry, and dependency definitions.

## Shared Scraper Responsibilities

The shared scraper currently handles these responsibilities:

- selector preset definitions
- selector override merging
- saved site profile loading
- run strategy resolution
- URL normalization and deduplication
- preview extraction
- bounded discovery crawl
- image and PDF download handling
- output JSON loading and append behavior
- duplicate `sourceUrl` prevention

This is the main place to extend behavior. If a feature changes how scraping works, it should usually start here.

## Selector System

The selector system has three layers:

1. Built-in preset
   Examples: `generic`, `wordpress`, `woocommerce`

2. Optional saved profile
   Loaded from a JSON config file and typically used for site-specific tuning

3. Optional one-off overrides
   Per-run selector overrides that replace only the fields provided

Resolution order:

- choose preset
- optionally load saved profile
- merge profile overrides
- merge one-off overrides last

That means one-off overrides always win over profile values, and profile values win over the base preset.

## Preview Flow

Preview mode exists to answer one question:

“Before I download anything, what does SugarStitch think this page contains?”

The preview flow:

1. resolves preset/profile/override strategy
2. fetches the page HTML
3. runs selector extraction
4. returns title, description, materials, instructions, image URLs, and PDF URLs
5. does not write JSON
6. does not download assets

This is the safest way to validate selectors on a new site.

## Discovery Crawl Flow

Discovery crawl mode exists for index pages or archive pages where the actual patterns live deeper in the site.

The crawl flow:

1. start from one or more seed URLs
2. fetch the page HTML
3. collect link targets from `a[href]`
4. resolve them to absolute URLs
5. optionally restrict to the same domain
6. optionally filter by URL or link text pattern
7. stop at the configured depth and max-URL limits
8. pass the discovered URLs into the normal scrape flow

Important:

- crawl mode is intentionally bounded
- it is not meant to be a general-purpose spider
- it is designed to help discover likely pattern pages from listing pages

## Output Model

Each successful page becomes a `PatternData` object with:

- `title`
- `description`
- `materials`
- `instructions`
- `sourceUrl`
- `localImages`
- `localPdfs`

Output behavior:

- JSON is appended to an output file
- duplicate `sourceUrl` entries are skipped before re-scraping
- downloaded images go into `images/<sanitized-title>/`
- downloaded PDFs go into `pdfs/<sanitized-title>/`
- all of that lives under the selected output directory

## UI Notes

The UI is intentionally server-rendered and simple.

Key design choices:

- no frontend framework
- HTML assembled on the server
- synchronous form-submit flow
- loading overlay to make long-running requests feel alive
- result pages returned after preview or scrape completion

Why it is structured this way:

- easy to maintain
- easy to inspect
- minimal dependencies
- keeps most logic in the shared scraper instead of duplicated client code

## Known Constraints

- selector quality is site-dependent
- some sites render important content with JavaScript after load
- browser security means the UI uses an output-directory path field rather than a native folder picker
- the crawler is deliberately shallow and filtered, not exhaustive
- HTTPS certificate issues on some environments can affect preview or scrape runs against certain sites

## Good Next Improvements

If development continues, these are strong candidates:

- richer site-specific profile library
- selector test diagnostics showing which selector matched which field
- live streaming logs in the UI instead of request/response-only updates
- a desktop wrapper if native folder selection becomes important
- export options beyond JSON
- better site-specific crawl heuristics for pattern archive pages

## Development Workflow

### Build

```bash
npm run build
```

### Run CLI

```bash
npm run scrape -- --url "https://example.com/pattern"
```

### Run UI

```bash
npm run ui
```

### Common Places To Edit

If scraping quality is the issue:
- edit [`src/scraper.ts`](/home/sizzlebop/PINKPIXEL/PROJECTS/CURRENT/sugarstitch/src/scraper.ts)

If CLI behavior is the issue:
- edit [`src/index.ts`](/home/sizzlebop/PINKPIXEL/PROJECTS/CURRENT/sugarstitch/src/index.ts)

If UX or local browser workflow is the issue:
- edit [`src/server.ts`](/home/sizzlebop/PINKPIXEL/PROJECTS/CURRENT/sugarstitch/src/server.ts)

If site-specific defaults are the issue:
- edit [`sugarstitch.profiles.json`](/home/sizzlebop/PINKPIXEL/PROJECTS/CURRENT/sugarstitch/sugarstitch.profiles.json)
