import express from 'express';
import { initializeApp } from 'firebase/app';
import { 
  getAuth, 
  createUserWithEmailAndPassword, 
  signInWithEmailAndPassword,
  onAuthStateChanged
} from 'firebase/auth';
import { get, push, remove, getDatabase, ref, set, update } from 'firebase/database';
import session from 'express-session';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import { existsSync, mkdirSync, writeFile } from 'fs';
import ejs from 'ejs';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { s3Client, BUCKET_NAME } from './config/s3.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const port = process.env.PORT || 3000;

// Set up EJS
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(path.join(__dirname, 'public/uploads')));

const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY || "AIzaSyAXSrvXlriajK-IMacwN4z9xY3mtkW5KPs",
  authDomain: process.env.FIREBASE_AUTH_DOMAIN || "wisteria-7dc52.firebaseapp.com",
  databaseURL: process.env.FIREBASE_DATABASE_URL || "https://wisteria-7dc52-default-rtdb.asia-southeast1.firebasedatabase.app",
  projectId: process.env.FIREBASE_PROJECT_ID || "wisteria-7dc52",
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET || "wisteria-7dc52.appspot.com",
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID || "67244581472",
  appId: process.env.FIREBASE_APP_ID || "1:67244581472:web:2faa9ec7bfa4979539d905"
};

const firebaseApp = initializeApp(firebaseConfig);
const auth = getAuth(firebaseApp);
const db = getDatabase(firebaseApp);
const postsRef = ref(db, 'posts');

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({
  secret: 'your-session-secret',
  resave: false,
  saveUninitialized: false
}));

// Configure multer for memory storage
const upload = multer({
    storage: multer.memoryStorage(),
    fileFilter: (req, file, cb) => {
        if (file.mimetype.startsWith('image/') || file.mimetype.startsWith('video/')) {
            cb(null, true);
        } else {
            cb(new Error('Only images and videos are allowed!'), false);
        }
    },
    limits: {
        fileSize: 10 * 1024 * 1024 // 10MB limit
    }
});

// Middleware to check if user is authenticated
const requireAuth = (req, res, next) => {
  if (req.session.user) {
    next();
  } else {
    res.redirect('/login');
  }
};

// Login routes
app.get('/login', (req, res) => {
  res.render('login.ejs', { error: null });
});

app.post('/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const userCredential = await signInWithEmailAndPassword(auth, email, password);
    req.session.user = { email: userCredential.user.email, uid: userCredential.user.uid };
    res.redirect('/');
  } catch (error) {
    res.render('login.ejs', { error: 'Invalid email or password' });
  }
});

// Register routes
app.get('/register', (req, res) => {
  res.render('register.ejs', { error: null });
});

app.post('/register', async (req, res) => {
  const { email, password, username } = req.body;
  try {
    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    const user = userCredential.user;
    
    // Store user data in database
    const userRef = ref(db, `users/${user.uid}`);
    await set(userRef, {
      email: email,
      username: username,
      createdAt: Date.now()
    });
    
    req.session.user = { 
      email: user.email, 
      uid: user.uid,
      username: username 
    };
    res.redirect('/');
  } catch (error) {
    res.render('register.ejs', { error: 'Failed to create account. Email might be in use.' });
  }
});

// Logout route
app.get('/logout', (req, res) => {
  req.session.destroy();
  res.redirect('/login');
});

// Protected home route
app.get('/', requireAuth, async (req, res) => {
  const snapshot = await get(postsRef);
  let posts = [];
  if (snapshot.exists()) {
    const data = snapshot.val();
    if (data) {
      posts = await Promise.all(Object.entries(data).map(async ([id, post]) => {
        // Get author's username
        const authorRef = ref(db, `users/${post.authorId}`);
        const authorSnapshot = await get(authorRef);
        const authorData = authorSnapshot.exists() ? authorSnapshot.val() : null;

        // Handle both old and new post formats
        const postData = {
          id,
          content: post.content,
          authorEmail: post.authorEmail,
          authorId: post.authorId,
          authorUsername: authorData?.username || post.authorEmail.split('@')[0],
          timestamp: post.timestamp,
          mediaUrl: post.mediaUrl,
          mediaType: post.mediaType
        };

        // Fetch comments if they exist
        const commentsSnapshot = await get(ref(db, `comments/${id}`));
        const comments = commentsSnapshot.exists() ? commentsSnapshot.val() : {};
        
        return {
          ...postData,
          comments: Object.entries(comments || {}).map(([commentId, comment]) => ({
            id: commentId,
            ...comment,
            replies: Object.entries(comment.replies || {}).map(([replyId, reply]) => ({
              id: replyId,
              ...reply
            }))
          }))
        };
      }));
      posts.reverse();
    }
  }
  res.render('home_page.ejs', { posts, user: req.session.user });
});

// Create a new post
app.post('/submit-post', requireAuth, upload.single('media'), async (req, res) => {
    try {
        const content = req.body.content;
        let mediaUrl = null;
        let mediaType = null;

        if (req.file) {
            try {
                // Generate unique filename
                const fileName = `${Date.now()}-${Math.round(Math.random() * 1E9)}${path.extname(req.file.originalname)}`;
                
                // Upload to S3
                const command = new PutObjectCommand({
                    Bucket: 'wisteria-bucket',
                    Key: `uploads/${fileName}`,
                    Body: req.file.buffer,
                    ContentType: req.file.mimetype
                });

                await s3Client.send(command);

                // Generate the public URL
                mediaUrl = `https://wisteria-bucket.s3.ap-northeast-1.amazonaws.com/uploads/${fileName}`;
                mediaType = req.file.mimetype;

                console.log('File uploaded successfully:', {
                    fileName,
                    mediaUrl,
                    mediaType
                });
            } catch (error) {
                console.error('Error uploading file:', error);
                throw new Error('Failed to upload file to S3');
            }
        }

        const post = {
            content,
            mediaUrl,
            mediaType,
            authorEmail: req.session.user.email,
            authorId: req.session.user.uid,
            timestamp: Date.now(),
            comments: []
        };

        const newPostRef = push(postsRef);
        await set(newPostRef, post);

        res.redirect('/');
    } catch (error) {
        console.error('Error creating post:', error);
        res.status(500).render('error', { 
            message: 'Error creating post',
            error: error.message,
            details: error.stack
        });
    }
});

// Add a comment to a post
app.post('/posts/:postId/comments', requireAuth, async (req, res) => {
  const { postId } = req.params;
  const { content } = req.body;
  
  if (content && content.trim() !== '') {
    const commentsRef = ref(db, `comments/${postId}`);
    const newCommentRef = push(commentsRef);
    await set(newCommentRef, {
      content: content.trim(),
      authorId: req.session.user.uid,
      authorEmail: req.session.user.email,
      timestamp: Date.now(),
      replies: {}
    });
  }
  res.redirect('/');
});

// Add a reply to a comment
app.post('/posts/:postId/comments/:commentId/replies', requireAuth, async (req, res) => {
  const { postId, commentId } = req.params;
  const { content } = req.body;
  
  if (content && content.trim() !== '') {
    const repliesRef = ref(db, `comments/${postId}/${commentId}/replies`);
    const newReplyRef = push(repliesRef);
    await set(newReplyRef, {
      content: content.trim(),
      authorId: req.session.user.uid,
      authorEmail: req.session.user.email,
      timestamp: Date.now()
    });
  }
  res.redirect('/');
});

// Profile route
app.get('/profile/:userId', requireAuth, async (req, res) => {
    try {
        const targetUserId = req.params.userId || req.session.user.uid;
        const isOwnProfile = targetUserId === req.session.user.uid;
        
        // Get user data
        const userRef = ref(db, `users/${targetUserId}`);
        const userSnapshot = await get(userRef);
        if (!userSnapshot.exists()) {
            return res.status(404).send('User not found');
        }
        const userData = userSnapshot.val();
        
        // Get user's posts
        const snapshot = await get(postsRef);
        let userPosts = [];
        
        if (snapshot.exists()) {
            const data = snapshot.val();
            if (data) {
                userPosts = Object.entries(data)
                    .filter(([_, post]) => post.authorId === targetUserId)
                    .map(([id, post]) => ({
                        id,
                        ...post
                    }))
                    .reverse();
            }
        }
        
        res.render('profile.ejs', { 
            user: req.session.user,
            profileUser: { ...userData, uid: targetUserId },
            userPosts,
            isOwnProfile
        });
    } catch (error) {
        console.error('Error fetching user profile:', error);
        res.status(500).send('Error loading profile');
    }
});

// Add a separate route for viewing own profile
app.get('/profile', requireAuth, async (req, res) => {
    res.redirect(`/profile/${req.session.user.uid}`);
});

// Update username route
app.post('/update-username', requireAuth, async (req, res) => {
    try {
        const { username } = req.body;
        const userRef = ref(db, `users/${req.session.user.uid}`);
        await update(userRef, { username });
        req.session.user.username = username;
        res.redirect('/profile');
    } catch (error) {
        console.error('Error updating username:', error);
        res.status(500).send('Error updating username');
    }
});

// Edit post route
app.post('/edit-post', requireAuth, async (req, res) => {
    try {
        const { postId, content } = req.body;
        const postRef = ref(db, `posts/${postId}`);
        const postSnapshot = await get(postRef);
        
        if (!postSnapshot.exists()) {
            return res.status(404).send('Post not found');
        }
        
        const post = postSnapshot.val();
        if (post.authorId !== req.session.user.uid) {
            return res.status(403).send('Not authorized');
        }
        
        await set(postRef, {
            ...post,
            content: content.trim(),
            lastEdited: Date.now()
        });
        
        res.redirect('/profile');
    } catch (error) {
        console.error('Error editing post:', error);
        res.status(500).send('Error editing post');
    }
});

// Delete post route
app.delete('/delete-post/:postId', requireAuth, async (req, res) => {
    try {
        const { postId } = req.params;
        const postRef = ref(db, `posts/${postId}`);
        const postSnapshot = await get(postRef);
        
        if (!postSnapshot.exists()) {
            return res.status(404).send('Post not found');
        }
        
        const post = postSnapshot.val();
        if (post.authorId !== req.session.user.uid) {
            return res.status(403).send('Not authorized');
        }
        
        // Delete post media if exists
        if (post.mediaUrl) {
            const mediaPath = path.join(__dirname, 'public', post.mediaUrl);
            try {
                await fs.unlink(mediaPath);
            } catch (error) {
                console.error('Error deleting media file:', error);
            }
        }
        
        // Delete post and its comments
        await remove(postRef);
        await remove(ref(db, `comments/${postId}`));
        
        res.status(200).send('Post deleted successfully');
    } catch (error) {
        console.error('Error deleting post:', error);
        res.status(500).send('Error deleting post');
    }
});

// Single post view route
app.get('/post/:postId', requireAuth, async (req, res) => {
    try {
        const { postId } = req.params;
        const postRef = ref(db, `posts/${postId}`);
        const postSnapshot = await get(postRef);
        
        if (!postSnapshot.exists()) {
            return res.status(404).send('Post not found');
        }
        
        const post = postSnapshot.val();
        
        // Get author's username
        const authorRef = ref(db, `users/${post.authorId}`);
        const authorSnapshot = await get(authorRef);
        const authorData = authorSnapshot.exists() ? authorSnapshot.val() : null;
        
        // Get comments
        const commentsSnapshot = await get(ref(db, `comments/${postId}`));
        const comments = commentsSnapshot.exists() ? commentsSnapshot.val() : {};
        
        const postWithComments = {
            id: postId,
            ...post,
            authorUsername: authorData?.username,
            comments: Object.entries(comments || {}).map(([commentId, comment]) => ({
                id: commentId,
                ...comment,
                replies: Object.entries(comment.replies || {}).map(([replyId, reply]) => ({
                    id: replyId,
                    ...reply
                }))
            }))
        };
        
        res.render('post.ejs', { 
            post: postWithComments,
            user: req.session.user
        });
    } catch (error) {
        console.error('Error fetching post:', error);
        res.status(500).send('Error loading post');
    }
});

// Only start the server if we're not in a serverless environment
if (process.env.NODE_ENV !== 'production') {
    app.listen(port, () => {
        console.log(`Server is running at http://localhost:${port}`);
    });
}

// Export the Express API
export default app;