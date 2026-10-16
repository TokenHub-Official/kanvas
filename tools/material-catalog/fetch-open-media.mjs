#!/usr/bin/env node

import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(import.meta.dirname, "../..");
const requestedOutput = process.argv
  .find((argument) => argument.startsWith("--output="))
  ?.slice("--output=".length);
const outputRoot = resolve(
  repositoryRoot,
  requestedOutput ?? ".tmp/material-catalog/v1",
);
const requestedLimit = Number(
  process.argv
    .find((argument) => argument.startsWith("--limit="))
    ?.slice("--limit=".length) ?? "30",
);
const shouldResume = process.argv.includes("--resume");

if (
  !outputRoot.startsWith(
    `${resolve(repositoryRoot, ".tmp/material-catalog")}/`,
  ) ||
  !Number.isSafeInteger(requestedLimit) ||
  requestedLimit < 1 ||
  requestedLimit > 50
) {
  throw new Error(
    "Output must stay under .tmp/material-catalog and limit must be 1-50.",
  );
}

const categories = Object.freeze([
  {
    id: "background-texture",
    label: "背景与纹理",
    commonsCategory: "Featured pictures of texture photography",
  },
  {
    id: "nature-plant",
    label: "自然与植物",
    commonsCategory: "Featured pictures of plants",
  },
  {
    id: "architecture-space",
    label: "建筑与空间",
    commonsCategory: "Featured pictures of architecture",
  },
  {
    id: "food-drink",
    label: "食物与饮品",
    commonsCategory: "Featured pictures of food",
  },
  {
    id: "objects-still-life",
    label: "物品与静物",
    commonsCategory: "Featured pictures of objects",
  },
  {
    id: "animals-wildlife",
    label: "动物与野生生物",
    commonsCategory: "Featured pictures of animals",
  },
  {
    id: "travel-landscape",
    label: "旅行与风景",
    commonsCategory: "Featured pictures of landscapes",
  },
  {
    id: "art-vintage",
    label: "艺术与复古",
    source: "museum",
  },
]);

const userAgent =
  "Kanvas-Material-Catalog/0.1 (local development; https://github.com/)";
const curationTitleExclusions = Object.freeze({
  "food-drink": [
    /cypress cones/iu,
    /pig heads/iu,
    /fruits of the arctium lappa/iu,
    /seed pods?/iu,
  ],
  "animals-wildlife": [/drainage ditch/iu],
});

function wait(milliseconds) {
  return new Promise((resolveWait) => {
    setTimeout(resolveWait, milliseconds);
  });
}

function cleanText(value, fallback) {
  if (typeof value !== "string") {
    return fallback;
  }
  const normalized = value.replace(/\s+/gu, " ").trim();
  return normalized.length > 0 ? normalized : fallback;
}

function cleanHtml(value, fallback) {
  if (typeof value !== "string") {
    return fallback;
  }
  return cleanText(
    value
      .replace(/<[^>]+>/gu, " ")
      .replace(/&nbsp;/gu, " ")
      .replace(/&amp;/gu, "&")
      .replace(/&quot;/gu, '"')
      .replace(/&#39;|&apos;/gu, "'"),
    fallback,
  );
}

function safeSlug(value) {
  return (
    value
      .normalize("NFKD")
      .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
      .replace(/^-+|-+$/gu, "")
      .toLowerCase()
      .slice(0, 54) || "untitled"
  );
}

function digest(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function fetchJson(url) {
  const response = await fetch(url, {
    headers: {
      accept: "application/json",
      "user-agent": userAgent,
    },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) {
    throw new Error(`Request failed (${String(response.status)}): ${url}`);
  }
  return response.json();
}

function metadataValue(metadata, key) {
  const value = metadata?.[key]?.value;
  return typeof value === "string" ? value : undefined;
}

function normalizeCommonsLicense(licenseName) {
  const normalized = licenseName.toLowerCase();
  if (normalized.startsWith("cc0")) {
    return "cc0";
  }
  if (normalized.startsWith("cc by-sa")) {
    return `cc-by-sa-${normalized.match(/\d+(?:\.\d+)?/u)?.[0] ?? "unknown"}`;
  }
  if (normalized.startsWith("cc by")) {
    return `cc-by-${normalized.match(/\d+(?:\.\d+)?/u)?.[0] ?? "unknown"}`;
  }
  return "public-domain";
}

async function queryCommonsCategoryTree(rootCategory) {
  const queue = [{ title: rootCategory, depth: 0 }];
  const visited = new Set();
  const files = [];
  while (queue.length > 0 && files.length < 160 && visited.size < 40) {
    const current = queue.shift();
    if (!current || visited.has(current.title)) {
      continue;
    }
    visited.add(current.title);
    const parameters = new URLSearchParams({
      action: "query",
      list: "categorymembers",
      cmtitle: `Category:${current.title}`,
      cmtype: "file|subcat",
      cmlimit: "200",
      format: "json",
      origin: "*",
    });
    const response = await fetchJson(
      `https://commons.wikimedia.org/w/api.php?${parameters.toString()}`,
    );
    const members = Array.isArray(response.query?.categorymembers)
      ? response.query.categorymembers
      : [];
    for (const member of members) {
      if (member.ns === 6) {
        files.push(member);
      } else if (
        member.ns === 14 &&
        current.depth < 3 &&
        typeof member.title === "string"
      ) {
        queue.push({
          title: member.title.replace(/^Category:/u, ""),
          depth: current.depth + 1,
        });
      }
    }
    await wait(150);
  }
  return files.slice(0, 160);
}

async function queryWikimediaFeatured(category) {
  const files = await queryCommonsCategoryTree(category.commonsCategory);
  const candidates = [];
  for (let offset = 0; offset < files.length; offset += 20) {
    const batch = files.slice(offset, offset + 20);
    const parameters = new URLSearchParams({
      action: "query",
      prop: "imageinfo",
      titles: batch.map((file) => file.title).join("|"),
      iiprop: "url|size|mime|extmetadata",
      iiurlwidth: "1600",
      format: "json",
      origin: "*",
    });
    const response = await fetchJson(
      `https://commons.wikimedia.org/w/api.php?${parameters.toString()}`,
    );
    const pages = Object.values(response.query?.pages ?? {});
    for (const page of pages) {
      const imageInfo = page.imageinfo?.[0];
      const metadata = imageInfo?.extmetadata;
      const licenseName = cleanHtml(
        metadataValue(metadata, "LicenseShortName"),
        "",
      );
      const width = Number(imageInfo?.width);
      const height = Number(imageInfo?.height);
      if (
        !imageInfo ||
        !/^(?:CC0|CC BY(?:-SA)?|Public domain|PDM)/iu.test(licenseName) ||
        !["image/jpeg", "image/png", "image/webp"].includes(imageInfo.mime) ||
        !Number.isFinite(width) ||
        !Number.isFinite(height) ||
        Math.min(width, height) < 800 ||
        width / height < 0.4 ||
        width / height > 2.8
      ) {
        continue;
      }
      const pageTitle = cleanText(
        page.title?.replace(/^File:/u, "").replace(/\.[^.]+$/u, ""),
        "Untitled",
      );
      const title = cleanHtml(
        metadataValue(metadata, "ImageDescription"),
        pageTitle,
      );
      const creator = cleanHtml(
        metadataValue(metadata, "Artist"),
        "Unknown creator",
      );
      const licenseUrl = cleanText(
        metadataValue(metadata, "LicenseUrl"),
        licenseName.toLowerCase().startsWith("cc0")
          ? "https://creativecommons.org/publicdomain/zero/1.0/"
          : "https://commons.wikimedia.org/wiki/Commons:Reusing_content_outside_Wikimedia",
      );
      const normalizedLicense = normalizeCommonsLicense(licenseName);
      candidates.push({
        id: `commons-${String(page.pageid)}`,
        provider: "Wikimedia Commons",
        source: "wikimedia-commons-featured-pictures",
        sourceId: String(page.pageid),
        title,
        creator,
        license: normalizedLicense,
        licenseVersion: licenseName.match(/\d+(?:\.\d+)?/u)?.[0] ?? undefined,
        licenseUrl,
        sourceUrl: imageInfo.descriptionurl,
        downloadUrls: [imageInfo.thumburl, imageInfo.url].filter(
          (url) => typeof url === "string" && url.length > 0,
        ),
        originalWidth: width,
        originalHeight: height,
        attribution: `${title} — ${creator}; Wikimedia Commons; ${licenseName}`,
        searchQuery: category.commonsCategory,
        sortKey: digest(Buffer.from(page.title)).slice(0, 12),
      });
    }
    await wait(150);
  }
  return candidates.sort((first, second) =>
    first.sortKey.localeCompare(second.sortKey),
  );
}

async function queryArtInstitute() {
  const searches = [
    "Japanese print",
    "poster design",
    "botanical illustration",
  ];
  const candidates = [];
  for (let queryIndex = 0; queryIndex < searches.length; queryIndex += 1) {
    const query = searches[queryIndex];
    const parameters = new URLSearchParams({
      q: query,
      limit: "20",
      fields:
        "id,title,image_id,artist_display,date_display,is_public_domain,thumbnail",
    });
    parameters.set("query[term][is_public_domain]", "true");
    const response = await fetchJson(
      `https://api.artic.edu/api/v1/artworks/search?${parameters.toString()}`,
    );
    const baseUrl = cleanText(
      response.config?.iiif_url,
      "https://www.artic.edu/iiif/2",
    );
    const results = Array.isArray(response.data) ? response.data : [];
    for (let resultIndex = 0; resultIndex < results.length; resultIndex += 1) {
      const result = results[resultIndex];
      if (
        result.is_public_domain !== true ||
        typeof result.image_id !== "string"
      ) {
        continue;
      }
      const title = cleanText(result.title, "Untitled artwork");
      candidates.push({
        id: `aic-${String(result.id)}`,
        provider: "Art Institute of Chicago",
        source: "artic",
        sourceId: String(result.id),
        title,
        creator: cleanText(result.artist_display, "Unknown artist"),
        license: "cc0",
        licenseVersion: "1.0",
        licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
        sourceUrl: `https://www.artic.edu/artworks/${String(result.id)}`,
        downloadUrls: [`${baseUrl}/${result.image_id}/full/843,/0/default.jpg`],
        attribution: `${title} — ${cleanText(
          result.artist_display,
          "Unknown artist",
        )}; Art Institute of Chicago`,
        searchQuery: query,
        rank: queryIndex * 100 + resultIndex,
      });
    }
    await wait(1_000);
  }
  return candidates;
}

async function queryMetMuseum() {
  const searches = ["Japanese print", "vintage textile", "decorative arts"];
  const candidates = [];
  for (let queryIndex = 0; queryIndex < searches.length; queryIndex += 1) {
    const query = searches[queryIndex];
    const search = await fetchJson(
      `https://collectionapi.metmuseum.org/public/collection/v1/search?hasImages=true&isPublicDomain=true&q=${encodeURIComponent(query)}`,
    );
    const objectIds = Array.isArray(search.objectIDs)
      ? search.objectIDs.slice(0, 12)
      : [];
    for (
      let resultIndex = 0;
      resultIndex < objectIds.length;
      resultIndex += 1
    ) {
      const objectId = objectIds[resultIndex];
      const result = await fetchJson(
        `https://collectionapi.metmuseum.org/public/collection/v1/objects/${String(objectId)}`,
      );
      if (
        result.isPublicDomain !== true ||
        typeof result.primaryImageSmall !== "string" ||
        result.primaryImageSmall.length === 0
      ) {
        continue;
      }
      const title = cleanText(result.title, "Untitled artwork");
      candidates.push({
        id: `met-${String(result.objectID)}`,
        provider: "The Metropolitan Museum of Art",
        source: "met",
        sourceId: String(result.objectID),
        title,
        creator: cleanText(
          result.artistDisplayName,
          cleanText(result.culture, "Unknown artist"),
        ),
        license: "cc0",
        licenseVersion: "1.0",
        licenseUrl: "https://creativecommons.org/publicdomain/zero/1.0/",
        sourceUrl: result.objectURL,
        downloadUrls: [result.primaryImage, result.primaryImageSmall].filter(
          (url) => typeof url === "string" && url.length > 0,
        ),
        attribution: `${title} — ${cleanText(
          result.artistDisplayName,
          cleanText(result.culture, "Unknown artist"),
        )}; The Metropolitan Museum of Art`,
        searchQuery: query,
        rank: queryIndex * 100 + resultIndex,
      });
      await wait(120);
    }
    await wait(300);
  }
  return candidates;
}

async function queryMuseumCandidates() {
  const artInstitute = await queryArtInstitute();
  const metMuseum = await queryMetMuseum();
  const interleaved = [];
  const maximum = Math.max(artInstitute.length, metMuseum.length);
  for (let index = 0; index < maximum; index += 1) {
    if (artInstitute[index]) {
      interleaved.push(artInstitute[index]);
    }
    if (metMuseum[index]) {
      interleaved.push(metMuseum[index]);
    }
  }
  return interleaved;
}

async function downloadBytes(url) {
  const response = await fetch(url, {
    headers: {
      accept: "image/*",
      "user-agent": userAgent,
    },
    redirect: "follow",
    signal: AbortSignal.timeout(45_000),
  });
  if (!response.ok) {
    throw new Error(`Download failed (${String(response.status)}).`);
  }
  const declaredLength = Number(response.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > 24 * 1024 * 1024) {
    throw new Error("Source image exceeds 24 MB.");
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length < 1_024 || bytes.length > 24 * 1024 * 1024) {
    throw new Error("Source image byte size is outside the catalog boundary.");
  }
  return bytes;
}

async function normalizeImage(sourcePath, outputPath) {
  await execFileAsync(
    "magick",
    [
      sourcePath,
      "-auto-orient",
      "-resize",
      "1600x1600>",
      "-background",
      "white",
      "-alpha",
      "remove",
      "-alpha",
      "off",
      "-strip",
      "-colorspace",
      "sRGB",
      "-quality",
      "88",
      outputPath,
    ],
    {
      maxBuffer: 1024 * 1024,
    },
  );
  const { stdout } = await execFileAsync("magick", [
    "identify",
    "-format",
    "%w %h",
    outputPath,
  ]);
  const [width, height] = stdout.trim().split(/\s+/u).map(Number);
  if (
    !Number.isSafeInteger(width) ||
    !Number.isSafeInteger(height) ||
    Math.min(width, height) < 400 ||
    Math.max(width, height) > 1_600
  ) {
    throw new Error("Normalized image dimensions are invalid.");
  }
  return { width, height };
}

async function materializeCandidate(
  category,
  candidate,
  index,
  categoryDirectory,
) {
  const shortId = candidate.sourceId.replace(/[^A-Za-z0-9]/gu, "").slice(0, 10);
  const filename = `${String(index + 1).padStart(3, "0")}-${safeSlug(
    candidate.title,
  )}-${shortId}.jpg`;
  const finalPath = join(categoryDirectory, filename);
  const temporaryPath = `${finalPath}.source`;
  let lastError;
  for (const url of candidate.downloadUrls) {
    try {
      const bytes = await downloadBytes(url);
      await writeFile(temporaryPath, bytes, { flag: "wx" });
      const dimensions = await normalizeImage(temporaryPath, finalPath);
      await rm(temporaryPath, { force: true });
      const normalizedBytes = await readFile(finalPath);
      return {
        ...candidate,
        categoryId: category.id,
        categoryLabel: category.label,
        filename,
        relativePath: relative(outputRoot, finalPath),
        mediaType: "image/jpeg",
        width: dimensions.width,
        height: dimensions.height,
        byteSize: normalizedBytes.length,
        sha256: digest(normalizedBytes),
      };
    } catch (error) {
      lastError = error;
      await rm(temporaryPath, { force: true });
      await rm(finalPath, { force: true });
    }
  }
  throw lastError ?? new Error("Candidate has no usable image URL.");
}

function uniqueCandidates(candidates) {
  const seenIds = new Set();
  const seenUrls = new Set();
  const creatorCounts = new Map();
  return candidates.filter((candidate) => {
    const url = candidate.downloadUrls[0];
    const creatorKey =
      `${candidate.provider}:${candidate.creator}`.toLowerCase();
    const creatorCount = creatorCounts.get(creatorKey) ?? 0;
    if (
      seenIds.has(candidate.id) ||
      (url && seenUrls.has(url)) ||
      (candidate.creator !== "Unknown creator" && creatorCount >= 4)
    ) {
      return false;
    }
    seenIds.add(candidate.id);
    if (url) {
      seenUrls.add(url);
    }
    creatorCounts.set(creatorKey, creatorCount + 1);
    return true;
  });
}

function isExcludedByCuration(categoryId, title) {
  return (
    curationTitleExclusions[categoryId]?.some((pattern) =>
      pattern.test(title),
    ) ?? false
  );
}

async function createContactSheet(categoryDirectory, items) {
  const contactSheet = join(categoryDirectory, "contact-sheet.jpg");
  const paths = items.map((item) => join(categoryDirectory, item.filename));
  await execFileAsync(
    "montage",
    [
      ...paths,
      "-thumbnail",
      "220x150>",
      "-tile",
      "5x",
      "-geometry",
      "220x180+10+20",
      "-background",
      "#f1f0fa",
      "-fill",
      "#151515",
      "-pointsize",
      "12",
      "-set",
      "label",
      "%t",
      contactSheet,
    ],
    {
      maxBuffer: 1024 * 1024,
    },
  );
  return relative(outputRoot, contactSheet);
}

async function materializeCategory(category) {
  const categoryDirectory = join(outputRoot, "categories", category.id);
  await mkdir(categoryDirectory, { recursive: true });
  const queried =
    category.source === "museum"
      ? await queryMuseumCandidates()
      : await queryWikimediaFeatured(category);
  const candidates = uniqueCandidates(queried).filter(
    (candidate) => !isExcludedByCuration(category.id, candidate.title),
  );
  const items = [];
  const rejected = [];
  for (const candidate of candidates) {
    if (items.length >= requestedLimit) {
      break;
    }
    try {
      const item = await materializeCandidate(
        category,
        candidate,
        items.length,
        categoryDirectory,
      );
      items.push(item);
      process.stdout.write(
        `${category.label}: ${String(items.length)}/${String(
          requestedLimit,
        )} ${item.filename}\n`,
      );
    } catch (error) {
      rejected.push({
        id: candidate.id,
        title: candidate.title,
        reason: error instanceof Error ? error.message : String(error),
      });
    }
  }
  const minimumCategoryItems = Math.min(requestedLimit, 15);
  if (items.length < minimumCategoryItems) {
    throw new Error(
      `${category.label} only produced ${String(items.length)} usable items; ${String(minimumCategoryItems)} are required.`,
    );
  }
  const contactSheet = await createContactSheet(categoryDirectory, items);
  const categoryManifest = {
    schemaVersion: 1,
    id: category.id,
    label: category.label,
    itemCount: items.length,
    contactSheet,
    items,
  };
  await writeFile(
    join(categoryDirectory, "manifest.json"),
    `${JSON.stringify(categoryManifest, null, 2)}\n`,
  );
  return { categoryManifest, rejected };
}

async function curateCategoryResults(categoryResults) {
  const seenHashes = new Set();
  const curatedResults = [];
  for (const category of categoryResults) {
    const keptItems = [];
    for (const item of category.items) {
      if (
        seenHashes.has(item.sha256) ||
        isExcludedByCuration(category.id, item.title)
      ) {
        await rm(join(outputRoot, item.relativePath), { force: true });
        continue;
      }
      seenHashes.add(item.sha256);
      keptItems.push(item);
    }
    if (keptItems.length === category.items.length) {
      curatedResults.push(category);
      continue;
    }
    const categoryDirectory = join(outputRoot, "categories", category.id);
    const contactSheet = await createContactSheet(categoryDirectory, keptItems);
    const curated = {
      ...category,
      itemCount: keptItems.length,
      contactSheet,
      items: keptItems,
    };
    await writeFile(
      join(categoryDirectory, "manifest.json"),
      `${JSON.stringify(curated, null, 2)}\n`,
    );
    curatedResults.push(curated);
  }
  return curatedResults;
}

async function main() {
  if (!shouldResume) {
    await rm(outputRoot, { recursive: true, force: true });
  }
  await mkdir(outputRoot, { recursive: true });
  const categoryResults = [];
  const rejected = [];
  for (const category of categories) {
    let result;
    if (shouldResume) {
      try {
        const existing = JSON.parse(
          await readFile(
            join(outputRoot, "categories", category.id, "manifest.json"),
            "utf8",
          ),
        );
        if (
          existing.id !== category.id ||
          !Array.isArray(existing.items) ||
          existing.items.length < Math.min(requestedLimit, 15)
        ) {
          throw new Error("Existing category manifest is incomplete.");
        }
        result = { categoryManifest: existing, rejected: [] };
      } catch {
        result = await materializeCategory(category);
      }
    } else {
      result = await materializeCategory(category);
    }
    categoryResults.push(result.categoryManifest);
    rejected.push(
      ...result.rejected.map((item) => ({
        categoryId: category.id,
        ...item,
      })),
    );
  }
  const curatedCategoryResults = await curateCategoryResults(categoryResults);
  const items = curatedCategoryResults.flatMap((category) => category.items);
  const minimumCatalogItems =
    requestedLimit >= 25 ? 190 : requestedLimit * categories.length;
  if (items.length < minimumCatalogItems) {
    throw new Error(
      `Catalog only produced ${String(items.length)} usable items; ${String(minimumCatalogItems)} are required.`,
    );
  }
  const manifest = {
    schemaVersion: 1,
    catalogId: "kanvas-open-media-starter",
    version: "v1",
    generatedAt: new Date().toISOString(),
    licensePolicy: {
      included: ["cc0", "public-domain", "cc-by", "cc-by-sa"],
      note: "Copyright status is recorded from the source API. CC BY requires attribution; CC BY-SA also requires share-alike. Trademark, privacy, publicity and endorsement rights are not granted by these copyright licenses.",
    },
    itemCount: items.length,
    categories: curatedCategoryResults.map((category) => ({
      id: category.id,
      label: category.label,
      itemCount: category.itemCount,
      contactSheet: category.contactSheet,
      manifestPath: `categories/${category.id}/manifest.json`,
    })),
    items,
  };
  const manifestTemporary = join(outputRoot, "manifest.json.tmp");
  await writeFile(manifestTemporary, `${JSON.stringify(manifest, null, 2)}\n`);
  await rename(manifestTemporary, join(outputRoot, "manifest.json"));
  await writeFile(
    join(outputRoot, "rejected.json"),
    `${JSON.stringify(rejected, null, 2)}\n`,
  );
  const checksums = items
    .map((item) => `${item.sha256}  ${item.relativePath}`)
    .join("\n");
  await writeFile(join(outputRoot, "checksums.sha256"), `${checksums}\n`);
  await writeFile(
    join(outputRoot, "README.md"),
    [
      "# Kanvas Open Media Starter Catalog",
      "",
      `- Catalog: \`kanvas-open-media-starter\``,
      `- Version: \`v1\``,
      `- Items: ${String(items.length)}`,
      `- Categories: ${String(curatedCategoryResults.length)}`,
      "- Included license signals: CC0, Public Domain, CC BY and CC BY-SA",
      "",
      "Files are normalized JPEG previews for local product development.",
      "The root manifest preserves source, creator, license URL, source URL,",
      "dimensions, byte size and SHA-256 for every item.",
      "",
      "Attribution must accompany CC BY files. Adaptations of CC BY-SA files",
      "must be shared under the applicable compatible license.",
      "",
      "Do not treat this catalog as a warranty of trademark, privacy, publicity,",
      "property or endorsement rights. Review those rights for production use.",
      "",
      "The repository currently has no shared catalog object-key contract, so",
      "this local catalog has not been uploaded to S3.",
      "",
    ].join("\n"),
  );
  process.stdout.write(
    `Completed ${String(items.length)} items in ${relative(
      repositoryRoot,
      outputRoot,
    )}.\n`,
  );
}

await main();
