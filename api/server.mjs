import express from 'express';
import fetch from 'node-fetch';
import { OAuth2Client } from 'google-auth-library';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const app = express();
app.use(express.json());

// OAuth2 Client setup
const oAuth2Client = new OAuth2Client(
  process.env.CLIENT_ID,
  process.env.CLIENT_SECRET,
  process.env.REDIRECT_URI
);

// Function to generate an access token
async function getAccessToken(code) {
  try {
    const { tokens } = await oAuth2Client.getToken(code);
    oAuth2Client.setCredentials(tokens);
    console.log("Tokens:", tokens); // Log tokens to check if access_token is available
    return tokens.access_token;
  } catch (error) {
    console.error("Error retrieving access token:", error);
    throw new Error("Failed to retrieve access token");
  }
}

// Function to call Vertex AI with Google Search Grounding
async function makeVertexAIRequest(accessToken, question) {
  const url = `https://${process.env.LOCATION}-aiplatform.googleapis.com/v1beta1/projects/${process.env.PROJECT_ID}/locations/${process.env.LOCATION}/publishers/google/models/${process.env.MODEL_ID}:generateContent`;

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        contents: [{
          role: "user",
          parts: [{ text: question }]
        }],
        tools: [{
          googleSearchRetrieval: {
            dynamicRetrievalConfig: {
              mode: "MODE_DYNAMIC",
              dynamicThreshold: 0.7
            }
          }
        }]
      })
    });

    if (!response.ok) {
      const errorMessage = await response.text();
      throw new Error(`API error: ${errorMessage}`);
    }

    const data = await response.json();
    return data.candidates[0]?.content?.parts[0]?.text || "No response";
  } catch (error) {
    console.error("Error processing request:", error);
    throw new Error(`Failed to process the request: ${error.message}`);
  }
}

// OAuth2 callback route to get access token
app.get('/oauth2callback', async (req, res) => {
  const code = req.query.code;
  try {
    const accessToken = await getAccessToken(code);
    res.send(`Access Token obtained! You can now send requests: ${accessToken}`);
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
    const { question } = req.body;

    // Check if access token exists
    if (!oAuth2Client.credentials.access_token) {
      return res.status(401).json({ error: "No access token found. Please authenticate via /auth" });
    }

    const accessToken = oAuth2Client.credentials.access_token;
    const answer = await makeVertexAIRequest(accessToken, question);
    res.status(200).json({ answer });
  } catch (error) {
    res.status(500).json({ error: `Failed to process the request: ${error.message}` });
  }
});

// Start the server
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
