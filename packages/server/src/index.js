require('dotenv').config({ path: require('path').join(__dirname, '../../../.env') });

const express = require('express');
const cors = require('cors');
const { pool } = require('./db');
const webhookRoutes = require('./routes/webhook');
const apiRoutes = require('./routes/api');

const app = express();
const PORT = process.env.PORT || 3456;

// Middleware
app.use(cors());
app.use(express.json());

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Routes
app.use('/webhook', webhookRoutes);
app.use('/api', apiRoutes);

// Error handler
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({ error: err.message });
});

// Start server
async function start() {
  try {
    // Test DB connection
    await pool.query('SELECT NOW()');
    console.log('✅ 数据库已连接');
    
    app.listen(PORT, () => {
      console.log(`🐰 Rabbit Lark Server 已启动: http://localhost:${PORT}`);
      console.log(`📌 Webhook: http://localhost:${PORT}/webhook/event`);
      console.log(`📊 API: http://localhost:${PORT}/api`);
    });
  } catch (err) {
    console.error('❌ 启动失败:', err);
    process.exit(1);
  }
}

start();
