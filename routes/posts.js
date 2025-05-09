import express from 'express';
import upload from '../utils/mediaUpload.js';

const router = express.Router();

// ... existing code ...

router.post('/submit-post', upload.single('media'), async (req, res) => {
    try {
        const { content } = req.body;
        const mediaUrl = req.file ? `/uploads/${req.file.filename}` : null;
        const mediaType = req.file ? req.file.mimetype : null;

        const post = {
            content,
            mediaUrl,
            mediaType,
            authorEmail: req.user.email,
            timestamp: new Date(),
            comments: []
        };

        // Save post to your database
        // ... your database logic here ...

        res.redirect('/');
    } catch (error) {
        console.error('Error creating post:', error);
        res.status(500).send('Error creating post');
    }
});

// ... rest of your routes ...

export default router; 