const Blog = require('../models/Blog');
const { slugify, ensureUniqueSlug } = require('../utils/slugify');

// Normalize tags from JSON string / comma string / array.
const parseTags = (value) => {
  if (value === undefined || value === null || value === '') return undefined;
  if (Array.isArray(value)) return value.filter((v) => String(v).trim() !== '');
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed.startsWith('[')) {
      try {
        const arr = JSON.parse(trimmed);
        return Array.isArray(arr) ? arr.filter((v) => String(v).trim() !== '') : undefined;
      } catch (e) { /* fall through */ }
    }
    return trimmed.split(',').map((s) => s.trim()).filter(Boolean);
  }
  return undefined;
};

// GET /api/blogs  (admin: all; public: ?published=true)
const getBlogs = async (req, res) => {
  try {
    const filter = {};
    if (req.query.published === 'true') filter.published = true;
    if (req.query.tag) filter.tags = req.query.tag;
    const blogs = await Blog.find(filter).sort({ createdAt: -1 });
    res.json(blogs);
  } catch (err) {
    console.error('Error fetching blogs:', err);
    res.status(500).json({ message: 'Error fetching blogs' });
  }
};

const getBlogsCount = async (req, res) => {
  try {
    const count = await Blog.countDocuments();
    res.json({ count });
  } catch (err) {
    res.status(500).json({ message: 'Error fetching blog count' });
  }
};

const getBlogBySlug = async (req, res) => {
  try {
    const blog = await Blog.findOne({ slug: req.params.slug });
    if (!blog) return res.status(404).json({ message: 'Post not found' });
    res.json(blog);
  } catch (err) {
    console.error('Error fetching blog by slug:', err);
    res.status(500).json({ message: 'Error fetching post' });
  }
};

const getBlogById = async (req, res) => {
  try {
    const blog = await Blog.findById(req.params.id);
    if (!blog) return res.status(404).json({ message: 'Post not found' });
    res.json(blog);
  } catch (err) {
    res.status(500).json({ message: 'Error fetching post' });
  }
};

const createBlog = async (req, res) => {
  try {
    const b = req.body;
    if (!b.title) return res.status(400).json({ message: 'Title is required' });

    const baseSlug = slugify(b.slug || b.title) || `post-${Date.now()}`;
    const uniqueSlug = await ensureUniqueSlug(Blog, baseSlug);

    const blog = new Blog({
      title: b.title,
      title_ar: b.title_ar,
      slug: uniqueSlug,
      excerpt: b.excerpt,
      excerpt_ar: b.excerpt_ar,
      body: b.body,
      body_ar: b.body_ar,
      coverImage: req.file?.path || b.coverImage,
      tags: parseTags(b.tags),
      author: b.author,
      published: b.published === 'true' || b.published === true,
      seoTitle: b.seoTitle,
      seoTitle_ar: b.seoTitle_ar,
      seoDescription: b.seoDescription,
      seoDescription_ar: b.seoDescription_ar,
    });
    await blog.save();
    res.status(201).json(blog);
  } catch (err) {
    console.error('Error creating blog:', err);
    res.status(500).json({ message: 'Error creating post', error: err.message });
  }
};

const updateBlog = async (req, res) => {
  try {
    const blog = await Blog.findById(req.params.id);
    if (!blog) return res.status(404).json({ message: 'Post not found' });

    const b = req.body;
    ['title', 'title_ar', 'excerpt', 'excerpt_ar', 'body', 'body_ar', 'author',
      'seoTitle', 'seoTitle_ar', 'seoDescription', 'seoDescription_ar'].forEach((f) => {
      if (b[f] !== undefined) blog[f] = b[f];
    });

    if (b.published !== undefined) blog.published = b.published === 'true' || b.published === true;
    const tags = parseTags(b.tags);
    if (tags !== undefined) blog.tags = tags;
    if (req.file) blog.coverImage = req.file.path;
    else if (b.coverImage !== undefined) blog.coverImage = b.coverImage;

    if (b.slug) blog.slug = await ensureUniqueSlug(Blog, slugify(b.slug), blog._id);

    await blog.save();
    res.json(blog);
  } catch (err) {
    console.error('Error updating blog:', err);
    res.status(500).json({ message: 'Error updating post', error: err.message });
  }
};

const deleteBlog = async (req, res) => {
  try {
    const blog = await Blog.findByIdAndDelete(req.params.id);
    if (!blog) return res.status(404).json({ message: 'Post not found' });
    res.json({ message: 'Post deleted successfully' });
  } catch (err) {
    res.status(500).json({ message: 'Error deleting post' });
  }
};

module.exports = {
  getBlogs,
  getBlogsCount,
  getBlogBySlug,
  getBlogById,
  createBlog,
  updateBlog,
  deleteBlog,
};
