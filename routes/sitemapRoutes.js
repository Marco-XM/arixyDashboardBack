const express = require('express');
const Blog = require('../models/Blog');
const Card = require('../models/Card');

const router = express.Router();

const SITE = 'https://arixytech.com';

// Public pages of the website. Portal/admin routes are intentionally excluded.
const STATIC_PAGES = [
  { path: '/', priority: '1.0', changefreq: 'weekly' },
  { path: '/blog', priority: '0.8', changefreq: 'weekly' },
  { path: '/amir', priority: '0.5', changefreq: 'monthly' },
  { path: '/marco', priority: '0.5', changefreq: 'monthly' },
];

const escapeXml = (s) =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

const toIsoDate = (d) => {
  const date = d ? new Date(d) : null;
  return date && !Number.isNaN(date.getTime()) ? date.toISOString().split('T')[0] : null;
};

const urlXml = ({ loc, lastmod, changefreq, priority }) => {
  let xml = `  <url>\n    <loc>${escapeXml(loc)}</loc>\n`;
  if (lastmod) xml += `    <lastmod>${lastmod}</lastmod>\n`;
  if (changefreq) xml += `    <changefreq>${changefreq}</changefreq>\n`;
  if (priority) xml += `    <priority>${priority}</priority>\n`;
  xml += '  </url>';
  return xml;
};

// GET /sitemap.xml — always-fresh sitemap built from live CMS content.
// The website proxies https://arixy.tech/sitemap.xml here, so blogs and
// projects created in the dashboard are indexed without a redeploy.
router.get('/sitemap.xml', async (req, res) => {
  try {
    const [cards, blogs] = await Promise.all([
      Card.find({}, 'slug updatedAt').sort({ updatedAt: -1 }).lean(),
      Blog.find({ published: true, slug: { $exists: true, $ne: '' } }, 'slug updatedAt')
        .sort({ updatedAt: -1 })
        .lean(),
    ]);

    const newestCard = cards.find((c) => c.updatedAt);
    const newestBlog = blogs.find((b) => b.updatedAt);

    const urls = [
      // Home/blog listing inherit the newest content date so crawlers revisit.
      ...STATIC_PAGES.map((p) => ({
        loc: `${SITE}${p.path}`,
        lastmod: toIsoDate(
          p.path === '/blog' ? newestBlog && newestBlog.updatedAt
            : p.path === '/' ? newestCard && newestCard.updatedAt
              : null
        ),
        changefreq: p.changefreq,
        priority: p.priority,
      })),
      ...cards
        .filter((c) => c.slug || c._id)
        .map((c) => ({
          loc: `${SITE}/project/${encodeURIComponent(c.slug || String(c._id))}`,
          lastmod: toIsoDate(c.updatedAt),
          changefreq: 'monthly',
          priority: '0.7',
        })),
      ...blogs.map((b) => ({
        loc: `${SITE}/blog/${encodeURIComponent(b.slug)}`,
        lastmod: toIsoDate(b.updatedAt),
        changefreq: 'monthly',
        priority: '0.7',
      })),
    ];

    const xml =
      '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' +
      urls.map(urlXml).join('\n') +
      '\n</urlset>\n';

    res.set('Content-Type', 'application/xml; charset=utf-8');
    // Cache on the CDN for an hour; serve stale while revalidating so the
    // sitemap stays fast even right after new content is published.
    res.set('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
    res.send(xml);
  } catch (err) {
    console.error('Error generating sitemap:', err);
    res.status(500).send('Error generating sitemap');
  }
});

module.exports = router;
