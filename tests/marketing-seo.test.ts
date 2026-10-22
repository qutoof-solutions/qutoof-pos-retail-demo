import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import robots from "../app/robots";
import sitemap from "../app/sitemap";
import { getMarketingMetadata, getMarketingSiteUrl, getMarketingStructuredData } from "../lib/marketing-seo";

test("the +25 activities badge opens the on-page sector explorer", () => {
  const source = readFileSync("components/landing/landing-page.tsx", "utf8");
  assert.match(source, /isMoreLink/);
  assert.match(source, /setSectorsOpen\(true\)/);
  assert.match(source, /role="dialog"/);
  assert.doesNotMatch(source, /href="\/solutions#industry-panel"/);
});

test("marketing metadata has canonical, Open Graph and Twitter previews", () => {
  for (const route of ["home", "solutions", "pricing"] as const) {
    const metadata = getMarketingMetadata(route, "en");
    assert.equal(metadata.alternates?.canonical, `${getMarketingSiteUrl()}${route === "home" ? "/" : `/${route}`}`);
    assert.ok(metadata.description);
    assert.ok(metadata.keywords && metadata.keywords.length >= 3 && metadata.keywords.length <= 8);
    const openGraph = metadata.openGraph as Record<string, unknown>;
    const twitter = metadata.twitter as Record<string, unknown>;
    assert.equal(openGraph.type, "website");
    assert.equal(openGraph.url, metadata.alternates?.canonical);
    assert.match(JSON.stringify(openGraph.images), /qutoof-business-social-v2\.png/);
    assert.match(JSON.stringify(openGraph.images), /Qutoof Business logo and brand name/);
    assert.equal(twitter.card, "summary_large_image");
    assert.match(JSON.stringify(twitter.images), /qutoof-business-social-v2\.png/);
    assert.match(JSON.stringify(twitter.images), /Qutoof Business logo and brand name/);
  }
});

test("structured data describes the software and route-specific content", () => {
  const solutions = getMarketingStructuredData("solutions", "en") as { "@graph": Array<Record<string, unknown>> };
  const home = getMarketingStructuredData("home", "ar") as { "@graph": Array<Record<string, unknown>> };
  assert.ok(solutions["@graph"].some((item) => item["@type"] === "SoftwareApplication"));
  assert.ok(solutions["@graph"].some((item) => item["@type"] === "ItemList"));
  assert.ok(home["@graph"].some((item) => item["@type"] === "FAQPage"));
});

test("robots and sitemap expose only the intended public SEO surface", () => {
  const robotsDocument = robots();
  const sitemapDocument = sitemap();
  assert.equal(robotsDocument.sitemap, `${getMarketingSiteUrl()}/sitemap.xml`);
  assert.equal(sitemapDocument.length, 3);
  assert.deepEqual(sitemapDocument.map((entry) => entry.url), [
    `${getMarketingSiteUrl()}/`,
    `${getMarketingSiteUrl()}/solutions`,
    `${getMarketingSiteUrl()}/pricing`,
  ]);
  assert.match(JSON.stringify(robotsDocument.rules), /dashboard/);
});
