const express = require('express');
const cors = require('cors');
const { google } = require('googleapis');

const app = express();
const PORT = process.env.PORT || 3001; // Railway環境変数対応

app.use(cors());
app.use(express.json());

// 認証関連の設定
let oauth2Client = null;
let credentials = null;

// スコープ設定
const SCOPES = [
  'https://www.googleapis.com/auth/drive.scripts',
  'https://www.googleapis.com/auth/drive',
  'https://www.googleapis.com/auth/spreadsheets',
  'https://www.googleapis.com/auth/script.projects'
];

// 認証情報の初期化（クラウド対応）
async function initializeAuth() {
  try {
    // 環境変数から認証情報を取得
    const credentialsEnv = process.env.GOOGLE_CREDENTIALS_JSON;
    
    if (credentialsEnv) {
      // 環境変数から認証情報を読み込み
      credentials = JSON.parse(credentialsEnv);
      console.log('✅ Credentials loaded from environment variables');
    } else {
      // ローカル開発用フォールバック
      console.log('⚠️ GOOGLE_CREDENTIALS_JSON not found, checking local file...');
      const fs = require('fs').promises;
      const path = require('path');
      const credentialsPath = path.join(__dirname, 'client_credentials.json');
      const credentialsContent = await fs.readFile(credentialsPath, 'utf8');
      credentials = JSON.parse(credentialsContent);
      console.log('✅ Credentials loaded from local file');
    }
    
    console.log('📋 Credentials info:', {
      type: credentials.type || 'Not specified',
      clientId: credentials.installed?.client_id || credentials.web?.client_id || 'Not found',
      hasClientSecret: !!(credentials.installed?.client_secret || credentials.web?.client_secret)
    });

    // OAuth2クライアントの設定
    const clientConfig = credentials.installed || credentials.web;
    if (!clientConfig) {
      throw new Error('Invalid credentials format. Expected "installed" or "web" configuration.');
    }

    // クラウド環境対応のリダイレクトURI設定
    const baseUrl = process.env.RAILWAY_STATIC_URL 
      ? `https://${process.env.RAILWAY_STATIC_URL}`
      : process.env.RENDER_EXTERNAL_URL
      ? process.env.RENDER_EXTERNAL_URL
      : `http://localhost:${PORT}`;

    oauth2Client = new google.auth.OAuth2(
      clientConfig.client_id,
      clientConfig.client_secret,
      `${baseUrl}/oauth/callback`
    );

    console.log(`🔗 OAuth2 client initialized with redirect: ${baseUrl}/oauth/callback`);
    
    // 保存されたトークンの読み込み試行
    await loadSavedTokens();
    
  } catch (error) {
    console.error('❌ Failed to initialize auth:', error.message);
    throw error;
  }
}

// 保存されたトークンの読み込み（クラウド対応）
async function loadSavedTokens() {
  try {
    // 環境変数からトークンを取得
    const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;
    const accessToken = process.env.GOOGLE_ACCESS_TOKEN;
    
    if (refreshToken) {
      const tokens = {
        refresh_token: refreshToken,
        ...(accessToken && { access_token: accessToken })
      };
      
      oauth2Client.setCredentials(tokens);
      console.log('✅ Tokens loaded from environment variables');
      return true;
    } else {
      // ローカル開発用フォールバック
      const fs = require('fs').promises;
      const path = require('path');
      const tokensPath = path.join(__dirname, 'tokens.json');
      const tokensContent = await fs.readFile(tokensPath, 'utf8');
      const tokens = JSON.parse(tokensContent);
      oauth2Client.setCredentials(tokens);
      console.log('✅ Tokens loaded from local file');
      return true;
    }
  } catch (error) {
    console.log('⚠️ No saved tokens found:', error.message);
    return false;
  }
}

// 認証URL生成
app.get('/mcp/authorize', async (req, res) => {
  try {
    if (!oauth2Client) {
      await initializeAuth();
    }

    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: SCOPES,
      response_type: 'code',
      prompt: 'consent'
    });

    console.log('🔗 Generated auth URL:', authUrl);
    
    res.json({
      success: true,
      authUrl: authUrl,
      message: 'Please visit this URL to complete OAuth authorization',
      instructions: 'Copy the authorization code from the callback and use /oauth/token endpoint'
    });
  } catch (error) {
    console.error('❌ Auth URL generation error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// OAuth コールバック処理
app.get('/oauth/callback', async (req, res) => {
  try {
    const { code } = req.query;
    
    if (!code) {
      return res.status(400).send(`
        <html>
          <body style="font-family: Arial, sans-serif; padding: 40px; background: #f5f5f5;">
            <div style="background: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
              <h2 style="color: #d32f2f;">❌ Authorization Failed</h2>
              <p>Authorization code not provided. Please try the authorization process again.</p>
              <a href="/mcp/authorize" style="color: #1976d2; text-decoration: none;">🔄 Retry Authorization</a>
            </div>
          </body>
        </html>
      `);
    }

    const { tokens } = await oauth2Client.getToken(code);
    oauth2Client.setCredentials(tokens);

    console.log('✅ OAuth tokens received successfully');
    console.log('🔑 Refresh Token:', tokens.refresh_token ? 'Present' : 'Missing');
    
    res.send(`
      <html>
        <body style="font-family: Arial, sans-serif; padding: 40px; background: #f5f5f5;">
          <div style="background: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
            <h2 style="color: #388e3c;">✅ Authorization Successful!</h2>
            <p>MCP Server is now authorized to access your Google account.</p>
            <div style="background: #f8f9fa; padding: 15px; border-radius: 4px; margin: 15px 0;">
              <strong>🔑 Refresh Token:</strong><br>
              <code style="word-break: break-all; font-size: 12px;">${tokens.refresh_token || 'Not provided'}</code>
            </div>
            <p><small>Save this refresh token as GOOGLE_REFRESH_TOKEN environment variable for production use.</small></p>
            <button onclick="window.close()" style="background: #1976d2; color: white; border: none; padding: 10px 20px; border-radius: 4px; cursor: pointer;">Close Window</button>
          </div>
        </body>
      </html>
    `);
  } catch (error) {
    console.error('❌ OAuth callback error:', error);
    res.status(500).send(`
      <html>
        <body style="font-family: Arial, sans-serif; padding: 40px; background: #f5f5f5;">
          <div style="background: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1);">
            <h2 style="color: #d32f2f;">❌ OAuth Error</h2>
            <p><strong>Error:</strong> ${error.message}</p>
            <a href="/mcp/authorize" style="color: #1976d2; text-decoration: none;">🔄 Retry Authorization</a>
          </div>
        </body>
      </html>
    `);
  }
});

// スプレッドシート作成エンドポイント
app.post('/create_spreadsheet', async (req, res) => {
  try {
    const { title } = req.body;
    
    if (!oauth2Client || !oauth2Client.credentials) {
      return res.status(401).json({
        success: false,
        error: 'OAuth authorization required. Please call /mcp/authorize first.'
      });
    }

    const sheets = google.sheets({ version: 'v4', auth: oauth2Client });
    
    const resource = {
      properties: {
        title: title || 'New Spreadsheet'
      }
    };

    const response = await sheets.spreadsheets.create({ resource });
    
    console.log(`✅ Spreadsheet created: ${response.data.spreadsheetId}`);
    
    res.json({
      success: true,
      spreadsheetId: response.data.spreadsheetId,
      url: response.data.spreadsheetUrl
    });
    
  } catch (error) {
    console.error('❌ Spreadsheet creation error:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// 🔧 修正版: コンテナバインドスクリプト作成
app.post('/create_container_bound_script', async (req, res) => {
  try {
    // 🎯 修正: parentId と spreadsheetId の両方をサポート
    const { parentId, spreadsheetId, title } = req.body;
    const targetSpreadsheetId = parentId || spreadsheetId;
    
    console.log('🔍 Debug - Request body:', req.body);
    console.log('🎯 Target spreadsheet ID:', targetSpreadsheetId);
    
    if (!targetSpreadsheetId) {
      return res.status(400).json({
        success: false,
        error: 'Missing required parameter. Please provide either "parentId" or "spreadsheetId".',
        hint: 'Use "parentId" for container-bound script creation'
      });
    }
    
    if (!oauth2Client || !oauth2Client.credentials) {
      return res.status(401).json({
        success: false,
        error: 'OAuth authorization required. Please call /mcp/authorize first.'
      });
    }

    const script = google.script({ version: 'v1', auth: oauth2Client });
    
    const request = {
      resource: {
        title: title || 'Container Bound Script',
        parentId: targetSpreadsheetId  // 🎯 修正: 正しくparentIdを設定
      }
    };

    console.log('📤 Google Apps Script API request:', JSON.stringify(request, null, 2));

    const response = await script.projects.create(request);
    
    console.log(`✅ Container bound script created: ${response.data.scriptId}`);
    console.log('📊 Parent container:', targetSpreadsheetId);

    res.json({
      success: true,
      scriptId: response.data.scriptId,
      url: `https://script.google.com/d/${response.data.scriptId}/edit`,
      parentId: targetSpreadsheetId,
      containerBound: true
    });
    
  } catch (error) {
    console.error('❌ Script creation error:', error);
    console.error('🔍 Error details:', error.response?.data || error.message);
    res.status(500).json({
      success: false,
      error: error.message,
      details: error.response?.data || null
    });
  }
});

// スクリプトコンテンツ更新
app.put('/update_script_content', async (req, res) => {
  try {
    const { scriptId, files } = req.body;
    
    if (!oauth2Client || !oauth2Client.credentials) {
      return res.status(401).json({
        success: false,
        error: 'OAuth authorization required'
      });
    }

    const script = google.script({ version: 'v1', auth: oauth2Client });
    
    const request = {
      scriptId: scriptId,
      resource: {
        files: files
      }
    };

    const response = await script.projects.updateContent(request);
    
    console.log(`✅ Script content updated: ${scriptId}`);

    res.json({
      success: true,
      data: response.data
    });
    
  } catch (error) {
    console.error('❌ Script update error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      details: error.response?.data || null
    });
  }
});

// スクリプト実行
app.post('/run_script', async (req, res) => {
  try {
    const { scriptId, function: functionName, parameters = [] } = req.body;
    
    if (!oauth2Client || !oauth2Client.credentials) {
      return res.status(401).json({
        success: false,
        error: 'OAuth authorization required'
      });
    }

    const script = google.script({ version: 'v1', auth: oauth2Client });
    
    const request = {
      scriptId: scriptId,
      resource: {
        function: functionName,
        parameters: parameters
      }
    };

    const response = await script.scripts.run(request);
    
    console.log(`✅ Script executed: ${scriptId}.${functionName}`);

    res.json({
      success: true,
      response: response.data.response
    });
    
  } catch (error) {
    console.error('❌ Script execution error:', error);
    res.status(500).json({
      success: false,
      error: error.message,
      details: error.response?.data || null
    });
  }
});

// ヘルスチェック
app.get('/health', (req, res) => {
  const hasCredentials = !!(oauth2Client && oauth2Client.credentials);
  const hasRefreshToken = !!(oauth2Client && oauth2Client.credentials && oauth2Client.credentials.refresh_token);
  
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    port: PORT,
    hasAuth: hasCredentials,
    hasRefreshToken: hasRefreshToken,
    authStatus: hasRefreshToken ? 'Ready' : hasCredentials ? 'Partial' : 'Not Authenticated',
    version: 'v2-fixed'
  });
});

// ルートエンドポイント（ダッシュボード）
app.get('/', (req, res) => {
  const hasAuth = !!(oauth2Client && oauth2Client.credentials);
  const hasRefreshToken = !!(oauth2Client && oauth2Client.credentials && oauth2Client.credentials.refresh_token);
  
  res.send(`
    <html>
      <head>
        <title>GAS MCP Server v2 (Fixed) Dashboard</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 40px; background: #f5f5f5; }
          .container { background: white; padding: 30px; border-radius: 8px; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
          .status { padding: 10px; border-radius: 4px; margin: 10px 0; }
          .ready { background: #e8f5e8; color: #2e7d32; }
          .warning { background: #fff3e0; color: #ef6c00; }
          .error { background: #ffebee; color: #c62828; }
          .endpoint { background: #f8f9fa; padding: 10px; margin: 5px 0; border-radius: 4px; font-family: monospace; }
          .fix { background: #e3f2fd; padding: 15px; border-radius: 4px; margin: 15px 0; }
          a { color: #1976d2; text-decoration: none; }
          a:hover { text-decoration: underline; }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>🚀 GAS MCP Server v2 (Fixed)</h1>
          <div class="status ${hasRefreshToken ? 'ready' : hasAuth ? 'warning' : 'error'}">
            <strong>Status:</strong> ${hasRefreshToken ? '✅ Ready' : hasAuth ? '⚠️ Partial Auth' : '❌ Not Authenticated'}
          </div>
          
          <div class="fix">
            <strong>🔧 Container Bind Fix Applied:</strong><br>
            ✅ Supports both "parentId" and "spreadsheetId" parameters<br>
            ✅ Enhanced debugging and error handling<br>
            ✅ Proper container-bound script creation
          </div>
          
          <h2>📡 Available Endpoints</h2>
          <div class="endpoint">GET  <a href="/health">/health</a> - Health check</div>
          <div class="endpoint">GET  <a href="/mcp/authorize">/mcp/authorize</a> - OAuth authorization URL</div>
          <div class="endpoint">POST /oauth/token - Set OAuth token manually</div>
          <div class="endpoint">POST /create_spreadsheet - Create spreadsheet</div>
          <div class="endpoint">POST /create_container_bound_script - Create container bound script (FIXED)</div>
          <div class="endpoint">PUT  /update_script_content - Update script content</div>
          <div class="endpoint">POST /run_script - Execute script function</div>
          
          <h2>🔧 Setup Instructions</h2>
          <ol>
            <li>Visit <a href="/mcp/authorize">/mcp/authorize</a> to get OAuth URL</li>
            <li>Complete OAuth flow in browser</li>
            <li>Save refresh token to GOOGLE_REFRESH_TOKEN environment variable</li>
            <li>Start using the API endpoints</li>
          </ol>
          
          <h2>🌐 Environment</h2>
          <div class="endpoint">Port: ${PORT}</div>
          <div class="endpoint">Version: v2-fixed</div>
          <div class="endpoint">Environment: ${process.env.NODE_ENV || 'development'}</div>
          <div class="endpoint">Platform: ${process.env.RAILWAY_STATIC_URL ? 'Railway' : process.env.RENDER_EXTERNAL_URL ? 'Render' : 'Local'}</div>
        </div>
      </body>
    </html>
  `);
});

// サーバー起動
app.listen(PORT, async () => {
  console.log(`🚀 MCP Server v2 (Fixed) running on port ${PORT}`);
  console.log(`🌐 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log('🔧 Container Bind Fix: Applied');
  console.log('📝 Available endpoints:');
  console.log('  GET  / - Dashboard');
  console.log('  GET  /health - Health check');
  console.log('  GET  /mcp/authorize - OAuth authorization');
  console.log('  POST /create_spreadsheet - Create spreadsheet');
  console.log('  POST /create_container_bound_script - Create container bound script (FIXED)');
  console.log('  PUT  /update_script_content - Update script content');
  console.log('  POST /run_script - Run script function');
  
  try {
    await initializeAuth();
    console.log('✅ Server initialization completed');
  } catch (error) {
    console.log('⚠️ Authentication not ready. Please complete OAuth flow via /mcp/authorize');
  }
});

module.exports = app;