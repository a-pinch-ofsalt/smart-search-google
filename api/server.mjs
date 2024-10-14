import express from 'express';
import fetch from 'node-fetch';
import { OAuth2Client } from 'google-auth-library';
import dotenv from 'dotenv';
import admin from 'firebase-admin';

dotenv.config();

const app = express();
app.use(express.json());

// Parse Firebase credentials from environment variable
const firebaseConfig = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);

// Initialize Firebase Admin SDK
admin.initializeApp({
  credential: admin.credential.cert(firebaseConfig),
  databaseURL: "https://your-firebase-project-id.firebaseio.com"  // Replace with your Firebase project URL
});

const db = admin.firestore();

const oAuth2Client = new OAuth2Client(
  process.env.CLIENT_ID,
  process.env.CLIENT_SECRET,
  process.env.REDIRECT_URI || 'https://smart-search-google.vercel.app/oauth2callback'
);

// Store tokens in Firestore
async function storeTokensInFirestore(tokens) {
  const tokensRef = db.collection('tokens').doc('userTokens');
  await tokensRef.set(tokens);
}

// Retrieve tokens from Firestore
async function getTokensFromFirestore() {
  const tokensRef = db.collection('tokens').doc('userTokens');
  const doc = await tokensRef.get();
  if (!doc.exists) {
    console.log('No token data found in Firestore!');
    return null;
  } else {
    return doc.data();
  }
}

// Function to refresh the access token using the refresh token
async function refreshAccessToken(refreshToken) {
  try {
    const { tokens } = await oAuth2Client.refreshToken(refreshToken);
    oAuth2Client.setCredentials(tokens);
    console.log('New Access Token:', tokens.access_token);

    // Store new access token in Firestore
    await storeTokensInFirestore(tokens);

    return tokens.access_token;
  } catch (error) {
    console.error("Error refreshing token:", error);
    throw new Error("Failed to refresh access token.");
  }
}

// Retrieve and refresh access token
async function getValidAccessToken() {
  let tokens = await getTokensFromFirestore();

  // If no valid access token, refresh it
  if (!tokens || !tokens.access_token || tokens.access_token === 'your-access-token') {
    console.log("No valid access token found. Refreshing token...");
    tokens = await refreshAccessToken(tokens.refresh_token);
  }

  return tokens.access_token;
}

// POST route to handle user questions
app.post('/ask', async (req, res) => {
  try {
    const accessToken = await getValidAccessToken();
    console.log("Access Token being used:", accessToken);

    const answer = await askVertexAI(accessToken, req.body.question);

    res.status(200).json({ answer });
  } catch (error) {
    res.status(500).json({ error: `Failed to process the request: ${error.message}` });
  }
});

// OAuth2 callback route to get access token
app.get('/oauth2callback', async (req, res) => {
  const code = req.query.code;
  try {
    const { tokens } = await oAuth2Client.getToken(code);
    oAuth2Client.setCredentials(tokens);

    // Store tokens in Firestore
    await storeTokensInFirestore(tokens);

    res.send(`Access Token obtained.`);
  } catch (error) {
    res.status(500).send('Error obtaining access token: ' + error.message);
  }
});

// Route to start OAuth process
app.get('/auth', (req, res) => {
  const authUrl = oAuth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/cloud-platform']
  });
  res.redirect(authUrl);
});

// Export the Express app for use with Vercel serverless
export default app;
