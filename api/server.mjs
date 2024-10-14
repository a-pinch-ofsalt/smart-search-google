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

// Get refresh token or access token from Vercel’s environment variables (or database)
async function getStoredTokens() {
  const tokens = {
    access_token: process.env.ACCESS_TOKEN,
    refresh_token: process.env.REFRESH_TOKEN,
  };
  return tokens;
}

// Function to refresh the access token using the refresh token
async function refreshAccessToken(refreshToken) {
  try {
    const { tokens } = await oAuth2Client.refreshToken(refreshToken);
    oAuth2Client.setCredentials(tokens);
    // Update environment variables or database with new access token
    console.log('New Access Token:', tokens.access_token);
    return tokens.access_token;
  } catch (error) {
    console.error("Error refreshing token:", error);
    throw new Error("Failed to refresh access token.");
  }
}

// Fetch questions from Google Sheets
async function getQuestionsFromSheet(accessToken) {
  const sheetId = 'YOUR_GOOGLE_SHEET_ID';
  const url = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Sheet1!A1:A5`;
  
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${accessToken}`
    }
  });
  
  const data = await response.json();
  return data.values || [];
}

// Function to call Vertex AI with a list of questions
async function askVertexAI(accessToken, questions) {
  const url = `https://${process.env.LOCATION}-aiplatform.googleapis.com/v1beta1/projects/${process.env.PROJECT_ID}/locations/${process.env.LOCATION}/publishers/google/models/${process.env.MODEL_ID}:generateContent`;

  const responses = [];
  for (let question of questions) {
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
    responses.push(data.candidates[0]?.content?.parts[0]?.text || "No response");
  }
  
  return responses;
}

// OAuth2 callback route to get access token
app.get('/oauth2callback', async (req, res) => {
  const code = req.query.code;
  try {
    const { tokens } = await oAuth2Client.getToken(code);
    oAuth2Client.setCredentials(tokens);
    // Store access_token and refresh_token in environment variables or a database
    res.send(`Access Token and Refresh Token obtained.`);
  } catch (error) {
    res.status(500).send('Error obtaining access token: ' + error.message);
  }
});

// POST route to answer questions
app.post('/ask', async (req, res) => {
  try {
    let tokens = await getStoredTokens();
    
    // Refresh access token if necessary
    if (!tokens.access_token) {
      tokens.access_token = await refreshAccessToken(tokens.refresh_token);
    }
    
    const questions = await getQuestionsFromSheet(tokens.access_token);
    const answers = await askVertexAI(tokens.access_token, questions);
    
    res.status(200).json({ answers });
  } catch (error) {
    res.status(500).json({ error: `Failed to process the request: ${error.message}` });
  }
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
