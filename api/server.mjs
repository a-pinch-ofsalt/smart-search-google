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
  databaseURL: "https://vertexai-oauth-access-token.firebaseio.com"  // Replace with your Firebase project URL
});

const db = admin.firestore();

const oAuth2Client = new OAuth2Client(
  process.env.CLIENT_ID,
  process.env.CLIENT_SECRET,
  'https://smart-search-google.vercel.app/oauth2callback'
);

// Store tokens in Firestore
async function storeTokensInFirestore(tokens) {
  try {
    const tokensRef = db.collection('tokens').doc('userTokens');
    console.log('Tokens to be stored:', tokens);  // Log tokens to ensure they are correct
    if (tokens.access_token) {  // Ensure access_token is available before storing
      await tokensRef.set(tokens);
      console.log("Tokens successfully stored in Firestore.");
    } else {
      console.error("No access_token found in tokens:", tokens);
    }
  } catch (error) {
    console.error("Error storing tokens in Firestore:", error);
  }
}

// Retrieve tokens from Firestore
async function getTokensFromFirestore() {
  try {
    const tokensRef = db.collection('tokens').doc('userTokens');
    const doc = await tokensRef.get();
    if (!doc.exists) {
      console.log('No token data found in Firestore!');
      return null;
    } else {
      console.log('Tokens retrieved from Firestore:', doc.data());
      return doc.data();
    }
  } catch (error) {
    console.error("Error retrieving tokens from Firestore:", error);
    return null;
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

  if (!tokens) {
    throw new Error("No tokens found in Firestore.");
  }

  // If no valid access token, refresh it
  if (!tokens.access_token || tokens.access_token === 'your-access-token') {
    if (!tokens.access_token) {
      throw new Error("No access_token found. Cannot refresh access token.");
    }
    console.log("No valid access token found. Refreshing token...");
    tokens.access_token = await refreshAccessToken(tokens.access_token);
  }

  return tokens.access_token;
}

// Define the askVertexAI function to interact with Vertex AI
async function askVertexAI(accessToken, context, questions) {
  const url = `https://${process.env.LOCATION}-aiplatform.googleapis.com/v1beta1/projects/${process.env.PROJECT_ID}/locations/${process.env.LOCATION}/publishers/google/models/${process.env.MODEL_ID}:generateContent`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: `Context: ${context}\n\nQuestions: ${questions}` }] }],
      tools: [{ googleSearchRetrieval: { dynamicRetrievalConfig: { mode: "MODE_DYNAMIC", dynamicThreshold: 0.7 } } }]
    })
  });

  const data = await response.json();
  console.log("Response from Vertex AI:", data); // Log the response to check the result

  // Safely access the response and return the answer
  if (data.candidates && data.candidates.length > 0) {
    return data.candidates[0]?.content?.parts[0]?.text || "No response found";
  } else {
    throw new Error("Invalid response from Vertex AI");
  }
}


// POST route to handle user questions
app.post('/ask', async (req, res) => {
  try {
    const accessToken = await getValidAccessToken();
    console.log("Access Token being used:", accessToken);

    const { context, questions } = req.body;

    const answer = await askVertexAI(accessToken, context, questions);

    res.status(200).json({ answer });
  } catch (error) {
    res.status(500).json({ error: `Failed to process the request: ${error.message}` });
  }
});

// OAuth2 callback route to get access token
app.get('/oauth2callback', async (req, res) => {
  const code = req.query.code;
  console.log("Got something back!")
  try {
    const { tokens } = await oAuth2Client.getToken(code);
    oAuth2Client.setCredentials(tokens);
    
    console.log("Tokens received from OAuth:", tokens);  // Log tokens to check structure

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
