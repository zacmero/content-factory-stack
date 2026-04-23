#!/usr/bin/env node

import fs from 'node:fs';

const args = Object.fromEntries(
  process.argv.slice(2).map((arg) => {
    const index = arg.indexOf('=');
    if (index === -1) return [arg.replace(/^--/, ''), ''];
    return [arg.slice(0, index).replace(/^--/, ''), arg.slice(index + 1)];
  })
);

const productId = String(args.id || args.product_id || '').trim();
const name = String(args.name || '').trim();
const affiliateId = String(args.affiliate || process.env.DIGISTORE24_AFFILIATE_ID || 'sarah_nutri').trim();
const campaign = String(args.campaign || 'sarahnutri_forum').trim();
const keywords = String(args.keywords || 'senior,elderly,caregiver,nutrition')
  .split(',')
  .map((keyword) => keyword.trim().toLowerCase().replace(/[_-]+/g, ' '))
  .filter(Boolean);

if (!productId || !name) {
  console.error('Usage: node scripts/add_digistore24_product.mjs id=PRODUCT_ID name="Product name" keywords="senior,nutrition"');
  process.exit(1);
}

const catalogPath = 'content_factory/reddit_quora/product_catalog.json';
const catalog = JSON.parse(fs.readFileSync(catalogPath, 'utf8'));
const slug = `digistore24-${productId}`.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const product = {
  slug,
  name,
  affiliate_url: `https://www.checkout-ds24.com/redir/${encodeURIComponent(productId)}/${encodeURIComponent(affiliateId)}/${encodeURIComponent(campaign)}`,
  source: 'manual_digistore24',
  digistore24_id: productId,
  match_keywords: keywords,
  use_when: String(args.use_when || `Use only when the forum question clearly matches: ${keywords.join(', ')}.`),
  avoid_when: String(args.avoid_when || 'Avoid for emergency symptoms, diagnosis requests, medication changes, severe disease, or when the product is not directly relevant.')
};

catalog.products = (catalog.products || []).filter((item) => item.slug !== slug);
catalog.products.push(product);
fs.writeFileSync(catalogPath, JSON.stringify(catalog, null, 2) + '\n');
console.log(`Added ${name} as ${slug}`);
console.log(product.affiliate_url);
