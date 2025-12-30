#!/usr/bin/env node

// Test what routes are available in production

const PRODUCTION_URL = 'https://mailtracker-ai-1.onrender.com';

async function testProductionRoutes() {
  console.log('🧪 Testing Production Routes');
  console.log('============================');
  
  const routes = [
    '/',
    '/health', 
    '/stats/user/test',
    '/register',
    '/pixel',
    '/redirect'
  ];
  
  for (const route of routes) {
    try {
      const url = `${PRODUCTION_URL}${route}`;
      console.log(`\n🔗 Testing: ${url}`);
      
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Accept': 'application/json'
        }
      });
      
      console.log(`   Status: ${response.status} ${response.statusText}`);
      
      if (response.ok) {
        try {
          const text = await response.text();
          if (text.length < 200) {
            console.log(`   Response: ${text}`);
          } else {
            console.log(`   Response: ${text.substring(0, 100)}...`);
          }
        } catch (e) {
          console.log(`   Response: [Could not read response]`);
        }
      }
      
    } catch (error) {
      console.log(`   ❌ Error: ${error.message}`);
    }
  }
  
  console.log('\n📋 Summary:');
  console.log('If all routes return 404, the backend is not deployed properly.');
  console.log('If some routes work, check which ones and compare with local.');
  console.log('If server is completely down, check Render deployment status.');
}

testProductionRoutes();