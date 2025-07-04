const cloudinary = require('cloudinary').v2;
const multer = require('multer');
const { CloudinaryStorage } = require('multer-storage-cloudinary');
const Event = require('../models/Event');
require('dotenv').config();

cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET
});

const storage = new CloudinaryStorage({
    cloudinary: cloudinary,
    params: {
        folder: 'events',
        format: async (req, file) => 'webp',
        public_id: (req, file) => Date.now().toString() + '-' + file.originalname
    }
});

const upload = multer({ storage: storage });

const uploadImage = (req, res) => {
    upload.single('image')(req, res, async (err) => {
        if (err) {
            return res.status(500).send({ error: 'Failed to upload image' });
        }

        try {
            const cloudinaryUrl = req.file.path;

            const publicId = req.file.filename;

            const newEvent = new Event({
                imageUrl: cloudinaryUrl,
                publicId: publicId
            });

            await newEvent.save();
            res.status(201).send(newEvent);
        } catch (error) {
            res.status(500).send({ error: 'Failed to save event metadata' });
        }
    });
};

const getEvents = async (req, res) => {
    try {
        const events = await Event.find({});
        res.send(events);
    } catch (error) {
        res.status(500).send({ error: 'Failed to fetch events' });
    }
};

const extractPublicIdFromUrl = (url) => {
    const parts = url.split('/');
    let filename = parts.pop();
    filename = filename.substring(0, filename.lastIndexOf('.'));
    return `events/${filename}`;
};



const deleteEvent = async (req, res) => {
    try {
        const event = await Event.findById(req.params.id);
        if (!event) {
            return res.status(404).send({ error: 'Event not found' });
        }

        const imageUrls = Array.isArray(event.imageUrls) ? event.imageUrls : [event.imageUrl];

        const deletePromises = imageUrls.map(url => {
            const publicId = extractPublicIdFromUrl(url);
            console.log(`Deleting image with public ID: ${publicId}`);

            return cloudinary.uploader.destroy(publicId)
                .then(result => {
                    console.log(`Deleted image result: ${JSON.stringify(result)}`);
                    return result;
                })
                .catch(err => {
                    console.error(`Error deleting image with public ID: ${publicId}`, err);
                    throw err;
                });
        });

        await Promise.all(deletePromises);

        await event.deleteOne();

        res.status(200).send({ message: 'Event and images deleted successfully' });
    } catch (error) {
        console.error('Error deleting event:', error);
        res.status(500).send({ error: 'Failed to delete event' });
    }
};





// ✅ Get event count
const getEventCount = async (req, res) => {
    try {
        const count = await Event.countDocuments();
        res.send({ count });
    } catch (error) {
        res.status(500).send({ error: 'Failed to fetch event count' });
    }
};

module.exports = {
    uploadImage,
    getEvents,
    deleteEvent,
    getEventCount
};
