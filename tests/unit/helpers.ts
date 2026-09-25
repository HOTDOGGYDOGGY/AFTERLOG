import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildDocument } from "../../src/importers/band/build";
import { parseBandHtml } from "../../src/importers/band/html";

export const FIXTURE_DIR = resolve(process.cwd(), "tests/fixtures/band") + "/";
export const syntheticHtml = () => readFileSync(FIXTURE_DIR + "post-synthetic.html", "utf8");

export function syntheticDoc(assetMap = new Map<string, string>()) {
  const parsed = parseBandHtml(syntheticHtml());
  const post = parsed.documents.find((d) => d.format === "band-post")!;
  return buildDocument(post, { projectId: "p", sourceId: "s", parserVersion: "t", assetMap });
}
