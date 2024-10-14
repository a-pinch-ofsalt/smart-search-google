import express from 'express';
import fetch from 'node-fetch';
import { OAuth2Client } from 'google-auth-library';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
app.use(express.json());

const oAuth2Client = new OAuth2Client(
  process.env.CLIENT_ID,
  process.env.CLIENT_SECRET,
  process.env.REDIRECT_URI || 'https://smart-search-google.vercel.app/oauth2callback'
);

// Function to refresh the access token using the refresh token
async function refreshAccessToken(refreshToken) {
  try {
    const { tokens } = await oAuth2Client.refreshToken(refreshToken);
    oAuth2Client.setCredentials(tokens);
    return tokens.access_token;
  } catch (error) {
    throw new Error("Failed to refresh access token.");
  }
}

// Function to call Vertex AI
async function askVertexAI(accessToken, question) {
  const url = `https://${process.env.LOCATION}-aiplatform.googleapis.com/v1beta1/projects/${process.env.PROJECT_ID}/locations/${process.env.LOCATION}/publishers/google/models/${process.env.MODEL_ID}:generateContent`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: question }] }],
      tools: [{ googleSearchRetrieval: { dynamicRetrievalConfig: { mode: "MODE_DYNAMIC", dynamicThreshold: 0.7 } } }]
    })
  });

  const data = await response.json();
  return data.candidates[0]?.content?.parts[0]?.text || "No response";
}

// OAuth2 callback route to get access token
app.get('/oauth2callback', async (req, res) => {
  const code = req.query.code;
  try {
    const { tokens } = await oAuth2Client.getToken(code);
    oAuth2Client.setCredentials(tokens);
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

// POST route to handle user questions
app.post('/ask', async (req, res) => {
  try {
    let tokens = {
      access_token: process.env.ACCESS_TOKEN,
      refresh_token: process.env.REFRESH_TOKEN
    };
    
    if (!tokens.access_token) {
      tokens.access_token = await refreshAccessToken(tokens.refresh_token);
    }
    
    const answer = await askVertexAI(tokens.access_token, req.body.question);
    
    res.status(200).json({ answer });
  } catch (error) {
    res.status(500).json({ error: `Failed to process the request: ${error.message}` });
  }
});

// Export the Express app for use with Vercel serverless
export default app;
