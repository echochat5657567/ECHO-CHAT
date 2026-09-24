SSML CHAT v5

LOCAL SETUP
1. Install Node.js 18+.
2. Open a terminal in this SSML_CHAT folder.
3. Run: npm install
4. Run: npm start
5. Open: http://localhost:3000

Do not double-click index.html. The account/chat server must be running.

FILES
- data/Gifs/gifs.js = custom GIF library
- data/Profile.js = profile badge/gallery settings
- assets/background.jpg = website background
- assets/background-noise.mp3 = background music
- assets/notification.mp3 = notification sound

FEATURES
- Username/password accounts
- Click any avatar or username to open a large profile
- Own profile has EDIT PROFILE; other profiles do not
- STAFF! badge for staff
- Custom GIF picker and GIF reactions
- Image/video/GIF uploads
- Glowing per-letter hover text
- Send animation
- Persistent volume/music/notification settings
- Desktop notifications
- Ctrl+P staff panel
- Server-side mute/ban checks
- Automatic history cleanup with a bot notice

Local data is stored in server-data/db.json and server-data/uploads.
