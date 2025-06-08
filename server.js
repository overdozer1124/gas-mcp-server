const express = require('express');
const { google } = require('googleapis');
const cors = require('cors');
const bodyParser = require('body-parser');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3001;

// Middleware
app.use(cors());
app.use(bodyParser.json());

// Google Auth Setup
const CREDENTIALS_PATH = path.join(__dirname, 'client_credentials.json');
const TOKEN_PATH = path.join(__dirname, 'token.json');

// Required scopes for full automation
const SCOPES = [
  'https://www.googleapis.com/auth/drive.scripts',
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/script.projects'
];

// OAuth redirect URI for local development
const REDIRECT_URI = 'http://localhost';

let auth = null;

// Initialize Google Auth
async function initializeAuth() {
  console.log('🔧 Starting authentication initialization...');
  console.log('📁 Looking for credentials at:', CREDENTIALS_PATH);
  
  try {
    // Check if credentials file exists
    if (!fs.existsSync(CREDENTIALS_PATH)) {
      console.error('❌ client_credentials.json not found!');
      console.log('📁 Expected location:', CREDENTIALS_PATH);
      console.log('🔧 Please download OAuth 2.0 credentials from Google Cloud Console');
      return;
    }

    console.log('✅ Credentials file found');
    const credentialsContent = fs.readFileSync(CREDENTIALS_PATH, 'utf8');
    console.log('📄 Credentials file size:', credentialsContent.length, 'bytes');
    
    const credentials = JSON.parse(credentialsContent);
    console.log('✅ Credentials parsed successfully');
    
    const { client_secret, client_id, redirect_uris } = credentials.installed || credentials.web;
    
    if (!client_secret || !client_id || !redirect_uris) {
      console.error('❌ Invalid credentials format');
      console.log('Expected fields: client_secret, client_id, redirect_uris');
      console.log('Found keys:', Object.keys(credentials.installed || credentials.web || {}));
      return;
    }
    
    console.log('✅ Credentials validation passed');
    console.log('🔑 Client ID:', client_id.substring(0, 20) + '...');
    console.log('🔄 Redirect URI from credentials:', redirect_uris[0]);
    console.log('🔄 Using redirect URI:', REDIRECT_URI);
    
    // Use consistent redirect URI
    auth = new google.auth.OAuth2(client_id, client_secret, REDIRECT_URI);
    console.log('✅ OAuth2 client initialized');
    
    // Try to load existing token
    if (fs.existsSync(TOKEN_PATH)) {
      try {
        const token = JSON.parse(fs.readFileSync(TOKEN_PATH, 'utf8'));
        auth.setCredentials(token);
        console.log('✅ Existing token loaded successfully');
        
        // Verify token is still valid
        try {
          await auth.getAccessToken();
          console.log('✅ Token is valid and ready');
        } catch (tokenError) {
          console.log('⚠️ Token exists but may be expired, reauthorization may be needed');
        }
      } catch (tokenParseError) {
        console.log('❌ Error parsing existing token:', tokenParseError.message);
        console.log('🔧 Will need fresh authorization');
      }
    } else {
      console.log('❌ No existing token found. Authorization needed.');
    }
  } catch (error) {
    console.error('❌ Error during authentication initialization:', error.message);
    console.log('🔧 Please check if client_credentials.json is valid JSON');
    console.error('Full error:', error);
  }
}

// OAuth Authorization Endpoint
app.get('/authorize', async (req, res) => {
  console.log('📞 Authorization request received');
  
  if (!auth) {
    console.log('❌ Auth not initialized');
    return res.status(500).json({ error: 'Auth not initialized' });
  }
  
  try {
    const authUrl = auth.generateAuthUrl({
      access_type: 'offline',
      scope: SCOPES,
      response_type: 'code',
      include_granted_scopes: true
    });
    
    console.log('✅ Authorization URL generated');
    console.log('🔗 Auth URL:', authUrl.substring(0, 100) + '...');
    
    res.json({ 
      authUrl,
      message: 'Visit this URL to authorize the application',
      instructions: 'After authorization, call /callback with the code parameter'
    });
  } catch (error) {
    console.error('❌ Error generating auth URL:', error);
    res.status(500).json({ error: 'Failed to generate auth URL', details: error.message });
  }
});

// OAuth Callback Endpoint
app.post('/callback', async (req, res) => {
  const { code } = req.body;
  console.log('📞 Callback request received');
  console.log('🔍 Code length:', code ? code.length : 'undefined');
  
  if (!code) {
    console.log('❌ No authorization code provided');
    return res.status(400).json({ error: 'Authorization code required' });
  }
  
  try {
    console.log('🔄 Exchanging code for tokens...');
    
    // Use getToken instead of getAccessToken for proper token exchange
    const tokenResponse = await auth.getToken(code);
    console.log('✅ Token response received');
    console.log('🔍 Token response keys:', Object.keys(tokenResponse));
    
    const tokens = tokenResponse.tokens;
    if (!tokens) {
      console.error('❌ No tokens in response:', tokenResponse);
      return res.status(500).json({ 
        error: 'Invalid token response', 
        details: 'No tokens received from Google OAuth' 
      });
    }
    
    console.log('✅ Tokens extracted successfully');
    console.log('🔑 Token types:', Object.keys(tokens));
    
    auth.setCredentials(tokens);
    
    // Save token for future use
    fs.writeFileSync(TOKEN_PATH, JSON.stringify(tokens, null, 2));
    console.log('✅ Tokens saved to:', TOKEN_PATH);
    
    res.json({ 
      success: true, 
      message: 'Authorization successful',
      tokenSaved: true,
      tokenTypes: Object.keys(tokens)
    });
  } catch (error) {
    console.error('❌ Error during token exchange:', error);
    console.error('❌ Error stack:', error.stack);
    res.status(500).json({ 
      error: 'Failed to get access token', 
      details: error.message,
      errorType: error.constructor.name
    });
  }
});

// Create Container Bound Script
app.post('/create_container_bound_script', async (req, res) => {
  const { spreadsheetId, title } = req.body;
  console.log('📞 Create container bound script request:', { spreadsheetId, title });
  
  if (!spreadsheetId || !title) {
    return res.status(400).json({ error: 'spreadsheetId and title are required' });
  }
  
  try {
    const script = google.script({ version: 'v1', auth });
    
    // Create a new Apps Script project
    const projectResponse = await script.projects.create({
      requestBody: {
        title: title,
        parentId: spreadsheetId
      }
    });
    
    const scriptId = projectResponse.data.scriptId;
    const url = `https://script.google.com/d/${scriptId}/edit`;
    
    console.log('✅ Container bound script created:', scriptId);
    
    res.json({
      scriptId,
      url,
      success: true
    });
  } catch (error) {
    console.error('❌ Error creating container bound script:', error);
    res.status(500).json({ 
      error: 'Failed to create container bound script', 
      details: error.message 
    });
  }
});

// Update Script Content
app.put('/update_script_content', async (req, res) => {
  const { scriptId, files } = req.body;
  console.log('📞 Update script content request:', { scriptId, filesCount: files?.length });
  
  if (!scriptId || !files) {
    return res.status(400).json({ error: 'scriptId and files are required' });
  }
  
  try {
    const script = google.script({ version: 'v1', auth });
    
    const updateResponse = await script.projects.updateContent({
      scriptId: scriptId,
      requestBody: {
        files: files
      }
    });
    
    console.log('✅ Script content updated successfully');
    
    res.json({
      success: true,
      updatedFiles: updateResponse.data.files.length
    });
  } catch (error) {
    console.error('❌ Error updating script content:', error);
    res.status(500).json({ 
      error: 'Failed to update script content', 
      details: error.message 
    });
  }
});

// Run Script Function
app.post('/run_script', async (req, res) => {
  const { scriptId, function: functionName, parameters = [] } = req.body;
  console.log('📞 Run script request:', { scriptId, functionName, parametersCount: parameters.length });
  
  if (!scriptId || !functionName) {
    return res.status(400).json({ error: 'scriptId and function are required' });
  }
  
  try {
    const script = google.script({ version: 'v1', auth });
    
    const executionResponse = await script.scripts.run({
      scriptId: scriptId,
      requestBody: {
        function: functionName,
        parameters: parameters,
        devMode: true
      }
    });
    
    console.log('✅ Script executed successfully');
    
    res.json({
      response: executionResponse.data.response,
      success: true
    });
  } catch (error) {
    console.error('❌ Error running script:', error);
    res.status(500).json({ 
      error: 'Failed to run script', 
      details: error.message 
    });
  }
});

// Health Check
app.get('/health', (req, res) => {
  console.log('📞 Health check request');
  
  const healthStatus = {
    status: 'OK', 
    timestamp: new Date().toISOString(),
    authInitialized: !!auth,
    hasToken: auth && !!auth.credentials.access_token,
    credentialsFileExists: fs.existsSync(CREDENTIALS_PATH),
    tokenFileExists: fs.existsSync(TOKEN_PATH)
  };
  
  console.log('📊 Health status:', healthStatus);
  res.json(healthStatus);
});

// Server startup
app.listen(PORT, async () => {
  console.log(`🚀 MCP Server running on http://localhost:${PORT}`);
  console.log(`🔗 Health check: http://localhost:${PORT}/health`);
  console.log(`🔗 Authorization: http://localhost:${PORT}/authorize`);
  
  await initializeAuth();
  
  if (!auth || !auth.credentials.access_token) {
    console.log(`\n🔐 Authorization needed:`);
    console.log(`1. GET http://localhost:${PORT}/authorize`);
    console.log(`2. Visit the returned URL to authorize`);
    console.log(`3. POST the code to http://localhost:${PORT}/callback`);
  } else {
    console.log('✅ Ready for Apps Script automation!');
  }
});

module.exports = app;