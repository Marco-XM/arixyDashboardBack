// Generate a URL-safe slug. Supports Latin text; for Arabic/other scripts that
// reduce to empty, callers should fall back to a random suffix.
const slugify = (text = '') =>
  String(text)
    .toLowerCase()
    .trim()
    .replace(/['"]/g, '')
    .replace(/[^a-z0-9؀-ۿ]+/g, '-') // keep latin, digits and Arabic letters
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);

// Ensure a slug is unique within a collection by appending a counter.
// `Model` is a Mongoose model, `base` the desired slug, `excludeId` an optional
// document id to ignore (for updates).
const ensureUniqueSlug = async (Model, base, excludeId = null) => {
  let candidate = base || `item-${Date.now()}`;
  let n = 1;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const query = { slug: candidate };
    if (excludeId) query._id = { $ne: excludeId };
    const existing = await Model.findOne(query).select('_id').lean();
    if (!existing) return candidate;
    n += 1;
    candidate = `${base}-${n}`;
  }
};

module.exports = { slugify, ensureUniqueSlug };
